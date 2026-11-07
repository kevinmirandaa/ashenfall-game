import { relative } from 'node:path';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import fastifyStatic from '@fastify/static';
import swaggerUi from '@fastify/swagger-ui';
import { DEFAULT_MATCH_CONFIG, initialState } from '@ashenfall/domain';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { contractSchema, REST_CONTRACT } from './contracts/rest.js';
import { registerAdminRoutes } from './admin/admin.js';
import { AuthService, type AuthConfig } from './auth/auth-service.js';
import { registerAuthRoutes } from './auth/routes.js';
import { MatchmakingService } from './matchmaking/matchmaking-service.js';
import { registerMatchmakingRoutes } from './matchmaking/routes.js';
import { registerHistoryRoutes } from './matches/history.js';
import { MatchEventStore } from './matches/event-store.js';
import { MatchEngine } from './matches/match-engine.js';
import { logMatchEvents } from './telemetry/match-logs.js';
import { defaultTelemetry, type Telemetry } from './telemetry/telemetry.js';
import { problemBody, ProblemError } from './problem.js';
import { registerBotRoutes } from './matches/bot-routes.js';
import { registerStatsRoute } from './matches/stats.js';
import { MatchSweeper } from './matches/sweeper.js';
import { RedisEventBus } from './realtime/event-bus.js';
import { Presence } from './realtime/presence.js';
import { RealtimeGateway, type GatewayOptions } from './realtime/gateway.js';
import { WsTicketStore } from './realtime/tickets.js';
import { registerShopRoutes } from './shop/shop.js';
import { RoomService } from './rooms/room-service.js';
import { registerRoomRoutes } from './rooms/routes.js';

export interface AppDependencies {
  readonly pool: pg.Pool;
  readonly auth: AuthConfig;
  readonly logger?: boolean | { readonly stream?: NodeJS.WritableStream; readonly level?: string; readonly mixin?: () => object };
  /** Sin esto, OpenTelemetry queda en modo no-op. */
  readonly telemetry?: Telemetry;
  /** Orígenes de navegador permitidos en CORS. */
  readonly allowedOrigins?: readonly string[];
  /** Activar solo detrás de HTTPS: añade upgrade-insecure-requests y prohíbe ws:// en la CSP. */
  readonly enforceHttps?: boolean;
  /** Carpeta con el cliente compilado. */
  readonly clientDir?: string | undefined;
  readonly rateLimit: RateLimitConfig;
  /** Activar detrás del proxy de Azure: sin esto todos los clientes comparten la IP del proxy. */
  readonly trustProxy?: boolean;
  /** Espera máxima en la cola rápida. */
  readonly matchmakingMaxWaitMs?: number;
  /** Periodo de gracia para reconectar antes de perder por abandono. Sin esto, el del dominio (60 s). */
  readonly reconnectGraceMs?: number;
  /** Sin esto no se abre el WebSocket; las pruebas que solo usan REST no necesitan Redis. */
  readonly realtime?: RealtimeConfig;
  readonly health?: { readonly redis: Pick<Redis, 'ping'> };
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

const READINESS_PER_MINUTE = 120;
const YEAR_SECONDS = 365 * 24 * 3600;
const ART_MAX_AGE_SECONDS = 3600;

/**
 * Caché del cliente estático. Vite pone un hash en cada nombre de /assets, así que nunca cambian:
 * el navegador no vuelve a pedirlos. El arte no lleva hash: una hora y luego revalida con ETag (304).
 * El HTML siempre se revalida para que un despliegue nuevo llegue en la siguiente carga.
 */
export function staticCacheControl(relativePath: string): string {
  const normalized = `/${relativePath.replaceAll('\\', '/')}`;
  if (normalized.startsWith('/assets/')) return `public, max-age=${String(YEAR_SECONDS)}, immutable`;
  if (normalized.startsWith('/art/')) return `public, max-age=${String(ART_MAX_AGE_SECONDS)}`;
  return 'no-cache';
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

  // Toda ruta debe tener contrato: si falta, el servidor no arranca.
  app.addHook('onRoute', (route) => {
    if (route.method === 'HEAD' || route.method === 'OPTIONS' || route.url.startsWith('/docs') || route.url === '*' || route.url === '/*') return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const contract = REST_CONTRACT[`${String(methods[0])} ${route.url}`];
    if (contract === undefined) throw new Error(`Ruta sin contrato: ${String(methods[0])} ${route.url}`);
    route.schema = { ...route.schema, ...contractSchema(contract) };
  });
  // El contrato documenta las respuestas; no debe recortarlas al serializar.
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  void app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Swagger UI inyecta estilos en línea en /docs; la API no sirve HTML propio.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        // Solo tras HTTPS: Safari no exime a localhost y en local convertiría los recursos a https, dejando la página en blanco.
        connectSrc: dependencies.enforceHttps === true ? ["'self'", 'wss:'] : ["'self'", 'ws:', 'wss:'],
        upgradeInsecureRequests: dependencies.enforceHttps === true ? [] : null,
      },
    },
  });
  void app.register(cors, {
    origin: [...(dependencies.allowedOrigins ?? [])],
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 600,
  });

  void app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'ASHENFALL API',
        version: '1.0.0',
        description: 'REST para todo lo que no es tiempo real. Errores en RFC 9457. El tiempo real se documenta en contracts/asyncapi.json.',
      },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    },
  });
  void app.register(swaggerUi, { routePrefix: '/docs' });
  // El cliente se sirve desde el mismo origen: sin otro servicio que pagar y sin CORS.
  const { clientDir } = dependencies;
  if (clientDir !== undefined) {
    void app.register(fastifyStatic, {
      root: clientDir,
      decorateReply: false,
      // El build deja .br y .gz junto a JS, CSS, HTML y JSON: se comprimen una vez y servirlos no cuesta CPU.
      preCompressed: true,
      // Una visita pide ~100 ficheros: registrar cada uno a info llenaría Log Analytics (se paga por GB) sin aportar.
      logLevel: 'warn',
      setHeaders: (reply, filePath) => {
        reply.header('cache-control', staticCacheControl(relative(clientDir, filePath)));
      },
    });
  }

  const limits = dependencies.rateLimit;
  const authService = new AuthService(dependencies.pool, dependencies.auth);
  const tokenSubject = (authorization: string | undefined): Promise<string | null> => authService.verifiedSubject(authorization);
  void app.register(async (api) => {
    await api.register(rateLimit, {
      global: true,
      max: limits.globalPerMinute,
      timeWindow: '1 minute',
      // En preHandler ya hay cuerpo validado, lo que permite limitar por cuenta antes de gastar CPU en Argon2.
      hook: 'preHandler',
      nameSpace: limits.namespace ?? 'ashenfall-rl-',
      ...(limits.redis === undefined ? {} : { redis: limits.redis, skipOnError: true }),
      // Una petición con token válido cuenta para su usuario en cualquier IP; las demás, para su IP.
      keyGenerator: async (request) => {
        const userId = await tokenSubject(request.headers.authorization);
        return userId === null ? `ip:${request.ip}` : `user:${userId}`;
      },
      errorResponseBuilder: () => new ProblemError(429, 'RATE_LIMITED', 'Demasiadas peticiones'),
    });
    // No toca dependencias, así que puede quedar fuera del límite de tasa.
    // Las sondas de la plataforma llegan cada pocos segundos: sus registros de petición (unos 0,3 GB al mes por
    // réplica) solo costarían dinero. Un fallo de disponibilidad se sigue registrando como warn.
    api.get('/health/live', { logLevel: 'warn', config: { rateLimit: false } }, () => ({ status: 'ok' }));

    // Consulta la base de datos: lleva límite propio, holgado para las sondas de la plataforma.
    api.get('/health/ready', { logLevel: 'warn', config: { rateLimit: { max: READINESS_PER_MINUTE, timeWindow: '1 minute' } } }, async (request, reply) => {
      try {
        await dependencies.pool.query('SELECT 1');
        await dependencies.health?.redis.ping();
        return { status: 'ok' };
      } catch (error) {
        request.log.warn({ err: error }, 'Sonda de disponibilidad fallida');
        return reply.code(503).send({ status: 'unavailable' });
      }
    });

    const auth = authService;
    registerAuthRoutes(api, auth, limits);

    const store = new MatchEventStore(dependencies.pool);
    const { realtime } = dependencies;
    const namespace = realtime?.namespace ?? 'ashenfall-';
    const bus = realtime === undefined ? null : new RedisEventBus(realtime.redis, namespace, app.log);
    const telemetry = dependencies.telemetry ?? defaultTelemetry();
    telemetry.observeActiveMatches(async () => {
      const { rows } = await dependencies.pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM matches WHERE status = 'in_progress'`);
      return rows[0]?.total ?? 0;
    });
    const engine = new MatchEngine(
      store,
      (matchId, events) => {
        logMatchEvents(api.log, matchId, events);
        bus?.publish(matchId, events);
      },
      telemetry,
    );
    /** Tras confirmar la transacción, avisa a los jugadores sin que tengan que consultar. */
    const announceMatch = (matchId: string): void => {
      void (async () => {
        const [first] = await store.load(matchId);
        if (first === undefined) return;
        const started = [{ event: first, stateAfter: initialState(first) }];
        logMatchEvents(api.log, matchId, started);
        bus?.publish(matchId, started);
      })().catch((error: unknown) => {
        api.log.error({ err: error, matchId }, 'No se pudo anunciar la partida');
      });
    };

    const matchConfig =
      dependencies.reconnectGraceMs === undefined ? undefined : { ...DEFAULT_MATCH_CONFIG, gracePeriodMs: dependencies.reconnectGraceMs };
    registerRoomRoutes(api, auth, new RoomService(dependencies.pool, announceMatch, matchConfig), dependencies.pool);
    registerMatchmakingRoutes(
      api,
      auth,
      new MatchmakingService(dependencies.pool, dependencies.matchmakingMaxWaitMs ?? 60_000, announceMatch, matchConfig),
    );

    registerHistoryRoutes(api, auth, dependencies.pool, store);
    registerBotRoutes(api, auth, dependencies.pool, announceMatch, matchConfig);
    registerStatsRoute(api, auth, dependencies.pool);
    registerShopRoutes(api, auth, dependencies.pool);
    registerAdminRoutes(api, auth, dependencies.pool, engine, (userId) => bus?.publishUserSuspended(userId));

    if (realtime !== undefined && bus !== null) {
      const tickets = new WsTicketStore(realtime.redis, namespace);
      const heartbeatMs = realtime.gateway.heartbeatMs ?? 15_000;
      const presence = new Presence(realtime.redis, namespace, heartbeatMs * 3);
      const activeGateway = new RealtimeGateway(app.server, dependencies.pool, () => engine, tickets, presence, app.log, realtime.gateway, telemetry);
      const sweeper = new MatchSweeper(dependencies.pool, engine, app.log);
      api.post('/v1/ws-ticket', async (request, reply) => {
        const { userId } = await auth.authenticate(request.headers.authorization);
        return reply.code(201).send(await tickets.issue(userId));
      });
      app.addHook('onReady', async () => {
        await bus.start(activeGateway);
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
