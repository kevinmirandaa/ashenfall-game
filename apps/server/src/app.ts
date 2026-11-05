import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { AuthService, type AuthConfig } from './auth/auth-service.js';
import { registerAuthRoutes } from './auth/routes.js';
import { problemBody, ProblemError } from './problem.js';

export interface AppDependencies {
  readonly pool: pg.Pool;
  readonly auth: AuthConfig;
  readonly logger?: boolean;
}

const PROBLEM_JSON = 'application/problem+json';

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: dependencies.logger ?? false, bodyLimit: 16 * 1024 });

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

  registerAuthRoutes(app, new AuthService(dependencies.pool, dependencies.auth));
  return app;
}
