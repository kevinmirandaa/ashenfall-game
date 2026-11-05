import rateLimit from '@fastify/rate-limit';
import { initialState } from '@ashenfall/domain';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { AuthService, type AuthConfig } from './auth/auth-service.js';
import { registerAuthRoutes } from './auth/routes.js';
import { MatchmakingService } from './matchmaking/matchmaking-service.js';
import { registerMatchmakingRoutes } from './matchmaking/routes.js';
import { MatchEventStore } from './matches/event-store.js';
import { MatchEngine } from './matches/match-engine.js';
import { problemBody, ProblemError } from './problem.js';
import { MatchSweeper } from './matches/sweeper.js';
import { RedisEventBus } from './realtime/event-bus.js';
import { Presence } from './realtime/presence.js';
import { RealtimeGateway, type GatewayOptions } from './realtime/gateway.js';
import { WsTicketStore } from './realtime/tickets.js';
import { RoomService } from './rooms/room-service.js';
import { registerRoomRoutes } from './rooms/routes.js';

export interface AppDependencies {
  readonly pool: pg.Pool;
  readonly auth: AuthConfig;
  readonly logger?: boolean;
  readonly rateLimit: RateLimitConfig;
  /** Activar detrás del proxy de Azure: sin esto todos los clientes comparten la IP del proxy. */
  readonly trustProxy?: boolean;
  /** Espera máxima en la cola rápida. */
  readonly matchmakingMaxWaitMs?: number;
  /** Sin esto no se abre el WebSocket; las pruebas que solo usan REST no necesitan Redis. */
  readonly realtime?: RealtimeConfig;
}

export interface RealtimeConfig {
  readonly redis: Redis;
  readonly namespace?: string;
  readonly gateway: GatewayOptions;
  /** Cada cuánto esta réplica barre plazos vencidos. */
  readonly sweepIntervalMs?: number;
}

export interface RateLimitConfig {
  readonly globalPerMinute: number;
  readonly authPerMinute: number;
  readonly loginPerAccountPerMinute: number;
  /** Con Redis el contador es común a todas las réplicas. */
  readonly redis?: Redis;
  readonly namespace?: string;
}

const PROBLEM_JSON = 'application/problem+json';

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: dependencies.logger ?? false,
    bodyLimit: 16 * 1024,
    trustProxy: dependencies.trustProxy ?? false,
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ProblemError) {
      return reply
        .code(error.status)
        .headers(error.headers)
        .type(PROBLEM_JSON)
        .send(problemBody(error.status, error.code, error.title, request.url));
    }
    if (typeof error === 'object' && error !== null && 'validation' in error && Array.isArray(error.validation)) {
      const details: readonly unknown[] = error.validation.map((issue: { instancePath?: string; message?: string }) => ({
        path: issue.instancePath,
        message: issue.message,
      }));
      return reply
        .code(400)
        .type(PROBLEM_JSON)
        .send(problemBody(400, 'VALIDATION_FAILED', 'La petición no cumple el esquema', request.url, details));
    }
    const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).type(PROBLEM_JSON).send(problemBody(status, 'BAD_REQUEST', 'Petición inválida', request.url));
    }
    // El detalle queda en el log; el cliente nunca recibe mensajes internos.
    request.log.error({ err: error }, 'Error no controlado');
    return reply.code(500).type(PROBLEM_JSON).send(problemBody(500, 'INTERNAL_ERROR', 'Error interno', request.url));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).type(PROBLEM_JSON).send(problemBody(404, 'NOT_FOUND', 'Recurso no encontrado', request.url)),
  );

  const limits = dependencies.rateLimit;
  void app.register(async (api) => {
    await api.register(rateLimit, {
      global: true,
      max: limits.globalPerMinute,
      timeWindow: '1 minute',
      // En preHandler ya hay cuerpo validado, lo que permite limitar por cuenta antes de gastar CPU en Argon2.
      hook: 'preHandler',
      nameSpace: limits.namespace ?? 'ashenfall-rl-',
      ...(limits.redis === undefined ? {} : { redis: limits.redis, skipOnError: true }),
      errorResponseBuilder: () => new ProblemError(429, 'RATE_LIMITED', 'Demasiadas peticiones'),
    });
    const auth = new AuthService(dependencies.pool, dependencies.auth);
    registerAuthRoutes(api, auth, limits);

    const store = new MatchEventStore(dependencies.pool);
    const { realtime } = dependencies;
    const namespace = realtime?.namespace ?? 'ashenfall-';
    const bus = realtime === undefined ? null : new RedisEventBus(realtime.redis, namespace, app.log);
    const engine = new MatchEngine(store, (matchId, events) => bus?.publish(matchId, events));
    /** Tras confirmar la transacción, avisa a los jugadores sin que tengan que consultar. */
    const announceMatch = (matchId: string): void => {
      void (async () => {
        const [first] = await store.load(matchId);
        if (first !== undefined) bus?.publish(matchId, [{ event: first, stateAfter: initialState(first) }]);
      })().catch((error: unknown) => {
        api.log.error({ err: error, matchId }, 'No se pudo anunciar la partida');
      });
    };

    registerRoomRoutes(api, auth, new RoomService(dependencies.pool, announceMatch), dependencies.pool);
    registerMatchmakingRoutes(
      api,
      auth,
      new MatchmakingService(dependencies.pool, dependencies.matchmakingMaxWaitMs ?? 60_000, announceMatch),
    );

    if (realtime !== undefined && bus !== null) {
      const tickets = new WsTicketStore(realtime.redis, namespace);
      const heartbeatMs = realtime.gateway.heartbeatMs ?? 15_000;
      const presence = new Presence(realtime.redis, namespace, heartbeatMs * 3);
      const activeGateway = new RealtimeGateway(app.server, dependencies.pool, () => engine, tickets, presence, app.log, realtime.gateway);
      const sweeper = new MatchSweeper(dependencies.pool, engine, app.log);
      api.post('/v1/ws-ticket', async (request, reply) => {
        const { userId } = await auth.authenticate(request.headers.authorization);
        return reply.code(201).send(await tickets.issue(userId));
      });
      app.addHook('onReady', async () => {
        await bus.start((matchId, events) => {
          activeGateway.deliver(matchId, events);
        });
        sweeper.start(realtime.sweepIntervalMs ?? 1000);
      });
      app.addHook('preClose', () => {
        sweeper.stop();
        activeGateway.close();
        bus.stop();
        return Promise.resolve();
      });
    }
  });
  return app;
}
