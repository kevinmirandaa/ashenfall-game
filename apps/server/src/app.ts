import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { AuthService, type AuthConfig } from './auth/auth-service.js';
import { registerAuthRoutes } from './auth/routes.js';
import { problemBody, ProblemError } from './problem.js';

export interface AppDependencies {
  readonly pool: pg.Pool;
  readonly auth: AuthConfig;
  readonly logger?: boolean;
  readonly rateLimit: RateLimitConfig;
  /** Activar detrás del proxy de Azure: sin esto todos los clientes comparten la IP del proxy. */
  readonly trustProxy?: boolean;
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
    registerAuthRoutes(api, new AuthService(dependencies.pool, dependencies.auth), limits);
  });
  return app;
}
