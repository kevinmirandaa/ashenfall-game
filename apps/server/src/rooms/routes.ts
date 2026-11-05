import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/auth-service.js';
import { activeMatchOf } from '../matches/start.js';
import type pg from 'pg';
import type { RoomService } from './room-service.js';

const RoomParams = Type.Object({ roomId: Type.String({ format: 'uuid' }) });
const CreateRoom = Type.Object(
  { visibility: Type.Union([Type.Literal('public'), Type.Literal('private')]) },
  { additionalProperties: false },
);
const JoinByCode = Type.Object(
  { inviteCode: Type.String({ pattern: '^[A-HJ-NP-Z2-9]{8}$' }) },
  { additionalProperties: false },
);
const Ready = Type.Object({ ready: Type.Boolean() }, { additionalProperties: false });
const ListQuery = Type.Object({
  limit: Type.Integer({ minimum: 1, maximum: 50, default: 20 }),
  offset: Type.Integer({ minimum: 0, maximum: 10_000, default: 0 }),
});

export function registerRoomRoutes(app: FastifyInstance, auth: AuthService, rooms: RoomService, pool: pg.Pool): void {
  const userIdOf = async (authorization: string | undefined): Promise<string> =>
    (await auth.authenticate(authorization)).userId;

  app.post<{ Body: Static<typeof CreateRoom> }>('/v1/rooms', { schema: { body: CreateRoom } }, async (request, reply) => {
    const userId = await userIdOf(request.headers.authorization);
    return reply.code(201).send(await rooms.create(userId, request.body.visibility));
  });

  app.get<{ Querystring: Static<typeof ListQuery> }>('/v1/rooms', { schema: { querystring: ListQuery } }, async (request) => {
    await userIdOf(request.headers.authorization);
    return { items: await rooms.listPublic(request.query.limit, request.query.offset) };
  });

  app.get<{ Params: Static<typeof RoomParams> }>('/v1/rooms/:roomId', { schema: { params: RoomParams } }, async (request) =>
    rooms.get(request.params.roomId, await userIdOf(request.headers.authorization)),
  );

  app.post<{ Params: Static<typeof RoomParams> }>('/v1/rooms/:roomId/join', { schema: { params: RoomParams } }, async (request) =>
    rooms.joinPublic(request.params.roomId, await userIdOf(request.headers.authorization)),
  );

  app.post<{ Body: Static<typeof JoinByCode> }>('/v1/rooms/join-by-code', { schema: { body: JoinByCode } }, async (request) =>
    rooms.joinByCode(request.body.inviteCode, await userIdOf(request.headers.authorization)),
  );

  app.post<{ Params: Static<typeof RoomParams> }>(
    '/v1/rooms/:roomId/leave',
    { schema: { params: RoomParams } },
    async (request, reply) => {
      await rooms.leave(request.params.roomId, await userIdOf(request.headers.authorization));
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof RoomParams>; Body: Static<typeof Ready> }>(
    '/v1/rooms/:roomId/ready',
    { schema: { params: RoomParams, body: Ready } },
    async (request) =>
      rooms.setReady(request.params.roomId, await userIdOf(request.headers.authorization), request.body.ready, Date.now()),
  );

  app.get('/v1/me/match', async (request) => ({
    matchId: await activeMatchOf(pool, await userIdOf(request.headers.authorization)),
  }));
}
