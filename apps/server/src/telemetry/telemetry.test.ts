import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../app.js';
import { registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import { WsTestClient } from '../test-support/ws-client.js';
import { startAzureTelemetry } from './azure.js';
import { createTelemetry } from './telemetry.js';

const ANGLE = 43.21;
const POWER = 56.78;
let db: TestDatabase;
let redis: Redis;
let app: FastifyInstance;
let wsUrl: string;
const logs: string[] = [];
const spans = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 3_600_000 });
const meterProvider = new MeterProvider({ readers: [reader] });
const tracerProvider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });

beforeAll(async () => {
  db = await createTestDatabase();
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379');
  app = buildApp({
    pool: db.pool,
    logger: {
      level: 'debug',
      stream: new Writable({
        write(chunk: Buffer, _encoding, done) {
          logs.push(chunk.toString());
          done();
        },
      }),
    },
    auth: { jwtSecret: 'x'.repeat(40), accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 },
    rateLimit: { globalPerMinute: 100_000, authPerMinute: 100_000, loginPerAccountPerMinute: 100_000 },
    telemetry: createTelemetry(meterProvider.getMeter('test'), tracerProvider.getTracer('test')),
    realtime: { redis, namespace: `test-${randomUUID()}-`, gateway: { allowedOrigins: [] }, sweepIntervalMs: 3_600_000 },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  wsUrl = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
});
afterAll(async () => {
  await app.close();
  await meterProvider.shutdown();
  redis.disconnect();
  await db.destroy();
});

async function connect(user: TestUser): Promise<WsTestClient> {
  const { ticket } = (await user.request('POST', '/v1/ws-ticket')).json<{ ticket: string }>();
  const client = new WsTestClient(new WebSocket(`${wsUrl}?ticket=${ticket}`));
  await client.until((messages) => messages.find((message) => message.type === 'welcome'));
  return client;
}

function metricValue(name: string): { value: unknown } | undefined {
  const points = metricExporter
    .getMetrics()
    .at(-1)
    ?.scopeMetrics.flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === name)?.dataPoints;
  return points?.[0];
}

describe('observabilidad de una jugada real', () => {
  let a: TestUser;
  let b: TestUser;
  let matchId: string;
  let shooterId: string;
  const actionId = randomUUID();

  beforeAll(async () => {
    a = await registerUser(app);
    b = await registerUser(app);
    const clientA = await connect(a);
    const clientB = await connect(b);
    const room = (await a.request('POST', '/v1/rooms', { visibility: 'private' })).json<{ id: string; inviteCode: string }>();
    await b.request('POST', '/v1/rooms/join-by-code', { inviteCode: room.inviteCode });
    await a.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
    await b.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
    const started = await clientA.untilEvent('match_started');
    if (started.type !== 'match_started') throw new Error('Evento inesperado');
    matchId = started.view.matchId;
    shooterId = started.view.turn?.playerId ?? '';
    await clientB.untilEvent('match_started');
    const shooter = shooterId === a.id ? clientA : clientB;
    const rival = shooter === clientA ? clientB : clientA;
    shooter.send({ type: 'shoot', matchId, actionId, expectedVersion: 1, weaponId: 'dagger', angleDeg: ANGLE, power: POWER });
    await shooter.until((messages) => messages.find((message) => message.type === 'ack' && message.actionId === actionId));
    await rival.untilEvent('shot_resolved');
    await reader.forceFlush();
  });

  it('cuenta la jugada, mide la latencia y lee conexiones y partidas activas', () => {
    expect(metricValue('ashenfall.shots')?.value).toBe(1);
    const latency = metricValue('ashenfall.shot.latency')?.value as { count: number; sum: number };
    expect(latency.count).toBe(1);
    expect(latency.sum).toBeGreaterThanOrEqual(0);
    expect(latency.sum).toBeLessThan(5000);
    expect(metricValue('ashenfall.connections')?.value).toBe(2);
    expect(metricValue('ashenfall.matches.active')?.value).toBe(1);
  });

  it('crea un span del comando con matchId y playerId', () => {
    const span = spans.getFinishedSpans().find((candidate) => candidate.name === 'match.shoot');
    expect(span?.attributes).toMatchObject({ 'ashenfall.match_id': matchId, 'ashenfall.player_id': shooterId });
  });

  it('los logs de partida llevan matchId y playerId, y no revelan datos de la jugada', () => {
    const entries = logs.flatMap((line) => {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return parsed['matchId'] === matchId ? [parsed] : [];
    });
    expect(entries.map((entry) => entry['msg'])).toEqual(expect.arrayContaining(['Partida iniciada', 'Jugada confirmada']));
    expect(entries.find((entry) => entry['msg'] === 'Jugada confirmada')?.['playerId']).toBe(shooterId);
    const output = logs.join('');
    for (const secret of [actionId, String(ANGLE), String(POWER), a.email, a.password, a.authorization.slice(7)]) {
      expect(output).not.toContain(secret);
    }
  });
});

describe('sin Azure', () => {
  it('no activa la exportación sin cadena de conexión', () => {
    expect(startAzureTelemetry(undefined)).toBeNull();
    expect(startAzureTelemetry('')).toBeNull();
  });

  it('una consulta fallida de partidas activas no rompe la exportación', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const localReader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
    const provider = new MeterProvider({ readers: [localReader] });
    const telemetry = createTelemetry(provider.getMeter('t'), tracerProvider.getTracer('t'));
    telemetry.observeActiveMatches(() => Promise.reject(new Error('base caída')));
    telemetry.observeConnections(() => 7);
    await localReader.forceFlush();
    const names = exporter.getMetrics().at(-1)?.scopeMetrics.flatMap((scope) => scope.metrics.filter((metric) => metric.dataPoints.length > 0).map((metric) => metric.descriptor.name));
    expect(names).toContain('ashenfall.connections');
    expect(names).not.toContain('ashenfall.matches.active');
    await provider.shutdown();
  });

  it('un error dentro de un span se propaga sin registrar su mensaje', async () => {
    const telemetry = createTelemetry(meterProvider.getMeter('e'), tracerProvider.getTracer('e'));
    await expect(telemetry.inSpan('falla', {}, () => Promise.reject(new TypeError('dato sensible')))).rejects.toThrow('dato sensible');
    const span = spans.getFinishedSpans().find((candidate) => candidate.name === 'falla');
    expect(span?.attributes['error.type']).toBe('TypeError');
    expect(JSON.stringify(span?.attributes)).not.toContain('dato sensible');
  });
});
