import { MONSTER_IDS, MONSTERS, monsterForLevel, STORY_LEVELS } from '@ashenfall/domain';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AuthService } from '../auth/auth-service.js';
import { inTransaction } from '../db/transaction.js';
import { ProblemError } from '../problem.js';
import { botUserId } from './bots.js';
import { createMatchInTransaction } from './start.js';

const StartBotMatch = Type.Object({ level: Type.Integer({ minimum: 1, maximum: STORY_LEVELS }) }, { additionalProperties: false });

/** Niveles del modo historia contra los monstruos. El PvP entre humanos no cambia. */
export function registerBotRoutes(app: FastifyInstance, auth: AuthService, pool: pg.Pool, announce: (matchId: string) => void): void {
  async function cleared(userId: string): Promise<number> {
    const { rows } = await pool.query<{ cleared: number }>('SELECT cleared FROM story_progress WHERE user_id = $1', [userId]);
    return rows[0]?.cleared ?? 0;
  }

  app.get('/v1/me/story', async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    const done = await cleared(userId);
    return {
      cleared: done,
      levels: MONSTER_IDS.map((id, index) => ({
        level: index + 1,
        monsterId: id,
        name: MONSTERS[id].name,
        title: MONSTERS[id].title,
        weaponId: MONSTERS[id].weaponId,
        reward: MONSTERS[id].reward,
        unlocked: index + 1 <= done + 1,
        cleared: index + 1 <= done,
      })),
    };
  });

  app.post<{ Body: Static<typeof StartBotMatch> }>('/v1/matches/bot', { schema: { body: StartBotMatch } }, async (request, reply) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    const { level } = request.body;
    if (level > (await cleared(userId)) + 1) throw new ProblemError(403, 'STORY_LEVEL_LOCKED', 'Vence antes el nivel anterior');
    const monster = monsterForLevel(level);
    if (monster === undefined) throw new ProblemError(404, 'LEVEL_NOT_FOUND', 'Ese nivel no existe');
    const profile = monster;
    const matchId = await inTransaction(pool, (client) =>
      createMatchInTransaction(client, [userId, botUserId(profile.id)], Date.now(), undefined, { mode: 'story', monster: profile, reward: profile.reward }),
    );
    announce(matchId);
    return reply.code(201).send({ matchId, monsterId: profile.id });
  });
}
