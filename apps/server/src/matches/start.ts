import { randomInt, randomUUID } from 'node:crypto';
import { CHARACTER_FAMILY, CHARACTER_IDS, createMatchSetup, isCharacterId, isWeaponId, startMatch, WEAPONS, type CharacterId, type MatchConfig, type RandomSource, type WeaponId } from '@ashenfall/domain';
import type pg from 'pg';
import { isUniqueViolation } from '../db/transaction.js';
import { ProblemError } from '../problem.js';

/** Azar criptográficamente seguro para arena, posiciones, viento y primer turno. */
export const cryptoRandom: RandomSource = { intBelow: (exclusiveMax) => randomInt(exclusiveMax) };

/**
 * Crea la partida dentro de la transacción de quien la origina (sala o cola), para que ambas cosas
 * se confirmen juntas. El índice único de partidas activas es la última garantía contra la doble asignación.
 */
export async function createMatchInTransaction(
  client: pg.ClientBase,
  playerIds: readonly [string, string],
  nowMs: number,
  config?: MatchConfig,
): Promise<string> {
  const matchId = randomUUID();
  const { rows } = await client.query<{ id: string; display_name: string; character_id: string }>(
    'SELECT id, display_name, character_id FROM users WHERE id = ANY($1::uuid[])',
    [[...playerIds]],
  );
  // Arma equipada de cada jugador; solo cuenta si es de la familia de su personaje.
  const equipped = await client.query<{ user_id: string; cosmetic_id: string }>(
    `SELECT p.user_id, p.cosmetic_id FROM player_cosmetics p JOIN cosmetic_catalog c ON c.id = p.cosmetic_id
     WHERE p.user_id = ANY($1::uuid[]) AND p.equipped AND c.kind LIKE 'weapon\\_%'`,
    [[...playerIds]],
  );
  const profiles: Record<string, { characterId: CharacterId; displayName: string; weaponId?: WeaponId }> = {};
  for (const row of rows) {
    const characterId = isCharacterId(row.character_id) ? row.character_id : CHARACTER_IDS[0];
    const weapons = equipped.rows
      .filter((entry) => entry.user_id === row.id)
      .map((entry) => entry.cosmetic_id.replace(/^wpn-/, '').replace('-', '_'))
      .filter(isWeaponId)
      .filter((id) => WEAPONS[id].family === CHARACTER_FAMILY[characterId]);
    const weaponId = weapons[0];
    profiles[row.id] = { characterId, displayName: row.display_name, ...(weaponId === undefined ? {} : { weaponId }) };
  }
  const setup = createMatchSetup({ matchId, playerIds, profiles, ...(config === undefined ? {} : { config }) }, cryptoRandom);
  const first = startMatch(setup, nowMs);
  // Un SAVEPOINT no hace falta: si falla, toda la transacción de origen se revierte.
  try {
    await client.query(`INSERT INTO matches (id, status, next_deadline_ms) VALUES ($1, 'in_progress', $2)`, [
      matchId,
      nowMs + setup.config.turnDurationMs,
    ]);
    for (const playerId of playerIds) {
      await client.query('INSERT INTO match_players (match_id, user_id) VALUES ($1, $2)', [matchId, playerId]);
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
