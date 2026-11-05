import { randomInt, randomUUID } from 'node:crypto';
import { createMatchSetup, startMatch, type MatchConfig, type RandomSource } from '@ashenfall/domain';
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
  const setup = createMatchSetup({ matchId, playerIds, ...(config === undefined ? {} : { config }) }, cryptoRandom);
  const first = startMatch(setup, nowMs);
  // Un SAVEPOINT no hace falta: si falla, toda la transacción de origen se revierte.
  try {
    await client.query(`INSERT INTO matches (id, status) VALUES ($1, 'in_progress')`, [matchId]);
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
