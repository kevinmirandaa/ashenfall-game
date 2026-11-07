import { randomInt, randomUUID } from 'node:crypto';
import {
  CHARACTER_IDS,
  createMatchSetup,
  isCharacterId,
  startMatch,
  type FighterId,
  type MatchConfig,
  type MonsterProfile,
  type RandomSource,
  type WeaponId,
} from '@ashenfall/domain';
import type pg from 'pg';
import { isUniqueViolation } from '../db/transaction.js';
import { ProblemError } from '../problem.js';
import { botThinkMs } from './bots.js';
import { WIN_REWARD } from './event-store.js';

/** Azar criptográficamente seguro para arena, posiciones, viento y primer turno. */
export const cryptoRandom: RandomSource = { intBelow: (exclusiveMax) => randomInt(exclusiveMax) };

export interface BotMatch {
  readonly mode: 'story';
  readonly monster: MonsterProfile;
  readonly reward: number;
}

/**
 * Crea la partida dentro de la transacción de quien la origina (sala, cola o bot), para que ambas cosas
 * se confirmen juntas. El índice único de partidas activas es la última garantía contra la doble asignación.
 * En una partida contra bot, `playerIds[1]` es la cuenta del monstruo.
 */
export async function createMatchInTransaction(
  client: pg.ClientBase,
  playerIds: readonly [string, string],
  nowMs: number,
  config?: MatchConfig,
  bot?: BotMatch,
): Promise<string> {
  const matchId = randomUUID();
  const { rows } = await client.query<{ id: string; display_name: string; character_id: string }>(
    'SELECT id, display_name, character_id FROM users WHERE id = ANY($1::uuid[])',
    [[...playerIds]],
  );
  const profiles: Record<string, { characterId: FighterId; displayName: string; weaponId?: WeaponId }> = {};
  for (const row of rows) {
    if (bot !== undefined && row.id === playerIds[1]) {
      profiles[row.id] = { characterId: bot.monster.id, displayName: bot.monster.name, weaponId: bot.monster.weaponId };
      continue;
    }
    // Cada personaje usa siempre la misma arma, la de su familia: no hay cambio de armas.
    profiles[row.id] = { characterId: isCharacterId(row.character_id) ? row.character_id : CHARACTER_IDS[0], displayName: row.display_name };
  }
  const setup = createMatchSetup({ matchId, playerIds, profiles, ...(config === undefined ? {} : { config }) }, cryptoRandom);
  const first = startMatch(setup, nowMs);
  // El bot piensa antes de mover si le toca abrir la partida.
  const botFirst = bot !== undefined && setup.firstPlayerId === playerIds[1];
  try {
    await client.query(
      `INSERT INTO matches (id, status, next_deadline_ms, mode, monster_id, reward, bot_due_ms) VALUES ($1, 'in_progress', $2, $3, $4, $5, $6)`,
      [matchId, nowMs + setup.config.turnDurationMs, bot?.mode ?? 'pvp', bot?.monster.id ?? null, bot?.reward ?? WIN_REWARD, botFirst ? nowMs + botThinkMs(matchId, 1) + 4000 : null],
    );
    for (const playerId of playerIds) {
      await client.query('INSERT INTO match_players (match_id, user_id, is_bot) VALUES ($1, $2, $3)', [matchId, playerId, bot !== undefined && playerId === playerIds[1]]);
    }
    await client.query('INSERT INTO match_events (match_id, seq, at_ms, payload) VALUES ($1, $2, $3, $4)', [
      matchId,
      first.seq,
      first.atMs,
      JSON.stringify(first.payload),
    ]);
  } catch (error) {
    if (isUniqueViolation(error, 'match_players_one_active')) {
      throw new ProblemError(409, 'ALREADY_IN_MATCH', 'Un jugador ya está en una partida activa');
    }
    throw error;
  }
  return matchId;
}

export async function activeMatchOf(client: pg.ClientBase | pg.Pool, userId: string): Promise<string | null> {
  const { rows } = await client.query<{ match_id: string }>(
    'SELECT match_id FROM match_players WHERE user_id = $1 AND active',
    [userId],
  );
  return rows[0]?.match_id ?? null;
}
