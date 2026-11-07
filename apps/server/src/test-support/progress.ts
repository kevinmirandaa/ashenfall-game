import { randomUUID } from 'node:crypto';
import { progressFor } from '@ashenfall/domain';
import type { TestDatabase } from './database.js';
import { botUserId } from '../matches/bots.js';

/** Da al usuario las victorias necesarias para llegar al nivel pedido, con partidas terminadas de verdad en la base. */
export async function grantLevel(db: TestDatabase, userId: string, level: number): Promise<void> {
  let wins = 0;
  while (progressFor(wins, wins).level < level) wins += 1;
  for (let index = 0; index < wins; index += 1) {
    const matchId = randomUUID();
    await db.pool.query(`INSERT INTO matches (id, status, ended_at, mode) VALUES ($1, 'finished', now(), 'story')`, [matchId]);
    await db.pool.query('INSERT INTO match_players (match_id, user_id, active, is_bot) VALUES ($1, $2, false, false), ($1, $3, false, true)', [matchId, userId, botUserId('skeleton')]);
    await db.pool.query('INSERT INTO match_results (match_id, winner_id, loser_id, reason, result) VALUES ($1, $2, $3, $4, $5)', [
      matchId,
      userId,
      botUserId('skeleton'),
      'knockout',
      JSON.stringify({ winnerId: userId, loserId: botUserId('skeleton'), reason: 'knockout', finalHp: [100, 0], rounds: 1 }),
    ]);
  }
}
