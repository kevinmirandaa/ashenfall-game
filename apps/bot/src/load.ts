import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';

/**
 * Prueba de carga con partidas reales. Por escalones de partidas simultáneas mide el tiempo desde que se
 * envía una jugada hasta que AMBOS jugadores reciben su resultado, y comprueba que toda jugada se confirme
 * y que los eventos recibidos no tengan duplicados ni huecos de secuencia.
 */
const { values } = parseArgs({
  allowNegative: true,
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:8080' },
    steps: { type: 'string', default: '25,50,100,200,400' },
    'think-ms': { type: 'string', default: '1000' },
    shots: { type: 'string', default: '12', short: 's' },
    container: { type: 'string', default: '' },
    'db-container': { type: 'string', default: '' },
    'login-storm': { type: 'string', default: '0' },
    out: { type: 'string', default: 'load-results/result.json' },
    label: { type: 'string', default: '' },
    'stop-on-breach': { type: 'boolean', default: true },
  },
});

const BASE = values.url;
const WS_BASE = `${BASE.replace(/^http/, 'ws')}/ws`;
const THINK_MS = Number(values['think-ms']);
const SHOTS_PER_MATCH = Number(values.shots);
const TIMEOUT_MS = 15_000;
const P95_TARGET_MS = 200;
const ERROR_TARGET = 0.01;
const SETUP_CONCURRENCY = 8;
const START_CONCURRENCY = 50;

interface WireMessage {
  type: string;
  code?: string;
  actionId?: string;
  event?: { seq: number; payload: { type: string; playerId?: string; shooterId?: string; view?: { matchId: string; version: number; turn: { playerId: string } | null } } };
}

class Metrics {
  latencies: number[] = [];
  shotsSent = 0;
  shotsConfirmed = 0;
  errors = 0;
  errorKinds = new Map<string, number>();
  duplicatedOrGapped = 0;
  bytesReceived = 0;
  messagesReceived = 0;

  error(kind: string): void {
    this.errors += 1;
    this.errorKinds.set(kind, (this.errorKinds.get(kind) ?? 0) + 1);
  }
}

async function request<T>(method: string, path: string, token: string | null, body?: object): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path} → ${String(response.status)}`);
  return (response.status === 204 ? null : await response.json()) as T;
}

class Player {
  readonly waiters: { match: (message: WireMessage) => boolean; resolve: (message: WireMessage) => void }[] = [];
  readonly seqs: number[] = [];
  socket!: WebSocket;
  id = '';
  token = '';

  constructor(private readonly metrics: Metrics) {}

  async connect(): Promise<void> {
    const email = `${randomUUID()}@load.invalid`;
    const { accessToken } = await request<{ accessToken: string }>('POST', '/v1/auth/register', null, {
      email,
      password: 'clave-de-carga-solo-para-bots',
      displayName: 'Bot',
    });
    this.token = accessToken;
    this.id = (await request<{ id: string }>('GET', '/v1/me', accessToken)).id;
    const { ticket } = await request<{ ticket: string }>('POST', '/v1/ws-ticket', accessToken);
    this.socket = new WebSocket(`${WS_BASE}?ticket=${ticket}`);
    this.socket.on('message', (data: Buffer) => {
      this.metrics.bytesReceived += data.length;
      this.metrics.messagesReceived += 1;
      this.onMessage(JSON.parse(data.toString()) as WireMessage);
    });
    this.socket.on('error', () => {
      this.metrics.error('socket');
    });
    await this.waitFor((message) => message.type === 'welcome');
  }

  private onMessage(message: WireMessage): void {
    if (message.type === 'event' && message.event !== undefined) this.seqs.push(message.event.seq);
    if (message.type === 'error') this.metrics.error(`ws:${message.code ?? 'desconocido'}`);
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter?.match(message) === true) {
        this.waiters.splice(index, 1);
        waiter.resolve(message);
      }
    }
  }

  waitFor(match: (message: WireMessage) => boolean): Promise<WireMessage> {
    const waiting = new Promise<WireMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('tiempo agotado'));
      }, TIMEOUT_MS);
      this.waiters.push({
        match,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
    // Si otra espera de la misma jugada falla antes, este rechazo no debe tumbar el proceso.
    waiting.catch(() => undefined);
    return waiting;
  }
}

const isEvent = (type: string) => (message: WireMessage): boolean => message.type === 'event' && message.event?.payload.type === type;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function connectPair(metrics: Metrics): Promise<{ a: Player; b: Player }> {
  const a = new Player(metrics);
  const b = new Player(metrics);
  await a.connect();
  await b.connect();
  return { a, b };
}

async function startMatch({ a, b }: { a: Player; b: Player }): Promise<{ a: Player; b: Player; matchId: string; version: number; turn: string }> {
  const room = await request<{ id: string; inviteCode: string }>('POST', '/v1/rooms', a.token, { visibility: 'private' });
  await request('POST', '/v1/rooms/join-by-code', b.token, { inviteCode: room.inviteCode });
  const started = a.waitFor(isEvent('match_started'));
  const startedB = b.waitFor(isEvent('match_started'));
  await request('POST', `/v1/rooms/${room.id}/ready`, a.token, { ready: true });
  await request('POST', `/v1/rooms/${room.id}/ready`, b.token, { ready: true });
  const [event] = await Promise.all([started, startedB]);
  const view = event.event?.payload.view;
  if (view?.turn === null || view?.turn === undefined) throw new Error('Partida sin turno');
  return { a, b, matchId: view.matchId, version: view.version, turn: view.turn.playerId };
}

async function playMatch(
  match: { a: Player; b: Player; matchId: string; version: number; turn: string },
  metrics: Metrics,
): Promise<void> {
  let { version, turn } = match;
  // Reparte los disparos en el tiempo, como jugadores reales que no actúan a la vez.
  await sleep(Math.random() * THINK_MS);
  for (let shot = 0; shot < SHOTS_PER_MATCH; shot += 1) {
    const shooter = turn === match.a.id ? match.a : match.b;
    const actionId = randomUUID();
    const nextTurnA = match.a.waitFor(isEvent('turn_started'));
    const nextTurnB = match.b.waitFor(isEvent('turn_started'));
    const shotA = match.a.waitFor(isEvent('shot_resolved'));
    const shotB = match.b.waitFor(isEvent('shot_resolved'));
    const ack = shooter.waitFor((message) => message.type === 'ack' && message.actionId === actionId);
    const startedAt = performance.now();
    shooter.socket.send(
      JSON.stringify({ v: 1, type: 'shoot', matchId: match.matchId, actionId, expectedVersion: version, weaponId: 'bow', angleDeg: 45, power: 10 }),
    );
    metrics.shotsSent += 1;
    await Promise.all([shotA, shotB, ack]);
    metrics.latencies.push(performance.now() - startedAt);
    metrics.shotsConfirmed += 1;
    const [turnEvent] = await Promise.all([nextTurnA, nextTurnB]);
    version += 2;
    turn = turnEvent.event?.payload.playerId ?? '';
    await sleep(THINK_MS);
  }
}

function verify(match: { a: Player; b: Player }, metrics: Metrics): void {
  for (const player of [match.a, match.b]) {
    const unique = new Set(player.seqs);
    const ordered = [...player.seqs].sort((x, y) => x - y);
    const gap = ordered.some((seq, index) => index > 0 && seq !== (ordered[index - 1] ?? 0) + 1);
    if (unique.size !== player.seqs.length || gap) metrics.duplicatedOrGapped += 1;
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? Number.NaN;
}

interface ContainerSample {
  cpuPercent: number;
  memoryMb: number;
}

function sampleContainer(container: string): Promise<ContainerSample | null> {
  return new Promise((resolve) => {
    execFile('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}', container], (error, stdout) => {
      if (error !== null) {
        resolve(null);
        return;
      }
      const [cpu, memory] = stdout.trim().split('|');
      const usage = memory?.split('/')[0]?.trim() ?? '';
      const amount = Number.parseFloat(usage);
      resolve({ cpuPercent: Number.parseFloat(cpu ?? ''), memoryMb: usage.includes('GiB') ? amount * 1024 : amount });
    });
  });
}

async function inBatches<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...(await Promise.allSettled(items.slice(index, index + size).map(work))));
  }
  return results;
}

async function runStep(matches: number): Promise<Record<string, unknown>> {
  const metrics = new Metrics();
  const idle = values.container === '' ? null : await sampleContainer(values.container);
  const setupStart = performance.now();
  // Primero las cuentas, que son lentas por Argon2; las partidas se inician juntas para que ningún turno venza esperando.
  const pairs = await inBatches(Array.from({ length: matches }, (_, index) => index), SETUP_CONCURRENCY, () => connectPair(metrics));
  const connected = pairs.flatMap((result) => {
    if (result.status === 'fulfilled') return [result.value];
    metrics.error(`conexion:${String(result.reason)}`.slice(0, 80));
    return [];
  });
  const setupSeconds = (performance.now() - setupStart) / 1000;
  const setups = await inBatches(connected, START_CONCURRENCY, startMatch);
  const ready = setups.flatMap((result) => {
    if (result.status === 'fulfilled') return [result.value];
    metrics.error(`preparacion:${String(result.reason)}`.slice(0, 80));
    return [];
  });

  const samples: ContainerSample[] = [];
  const dbSamples: ContainerSample[] = [];
  const storm = { sent: 0, ok: 0, busy: 0, limited: 0, other: 0 };
  const stormWorkers = Number(values['login-storm']);
  let sampling = true;
  const sampler = (async () => {
    while (sampling && values.container !== '') {
      const sample = await sampleContainer(values.container);
      if (sample !== null) samples.push(sample);
      await sleep(1000);
    }
  })();

  // Pico de logins fallidos durante la partida, el peor caso para Argon2.
  const stormLoops = Array.from({ length: stormWorkers }, async () => {
    while (sampling) {
      storm.sent += 1;
      try {
        const response = await fetch(`${BASE}/v1/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: `${randomUUID()}@storm.invalid`, password: 'clave-incorrecta-de-carga' }),
        });
        if (response.status === 401) storm.ok += 1;
        else if (response.status === 503) storm.busy += 1;
        else if (response.status === 429) storm.limited += 1;
        else storm.other += 1;
        await response.arrayBuffer();
      } catch {
        storm.other += 1;
      }
    }
  });
  const dbSampler = (async () => {
    while (sampling && values['db-container'] !== '') {
      const sample = await sampleContainer(values['db-container']);
      if (sample !== null) dbSamples.push(sample);
      await sleep(1000);
    }
  })();

  const playStart = performance.now();
  const outcomes = await Promise.allSettled(ready.map((match) => playMatch(match, metrics)));
  const playSeconds = (performance.now() - playStart) / 1000;
  sampling = false;
  await Promise.all([sampler, dbSampler, ...stormLoops]);
  for (const outcome of outcomes) if (outcome.status === 'rejected') metrics.error(`partida:${String(outcome.reason)}`.slice(0, 80));

  await sleep(200);
  for (const match of ready) verify(match, metrics);
  for (const match of ready) {
    match.a.socket.close();
    match.b.socket.close();
  }
  // Las partidas quedan a medias: al cerrar, el barrido del servidor las termina por abandono.

  const sorted = [...metrics.latencies].sort((x, y) => x - y);
  const operations = metrics.shotsSent + (matches - ready.length);
  const avgCpu = samples.length === 0 ? null : samples.reduce((sum, sample) => sum + sample.cpuPercent, 0) / samples.length;
  const maxMemory = samples.length === 0 ? null : Math.max(...samples.map((sample) => sample.memoryMb));
  const result = {
    matches,
    matchesStarted: ready.length,
    connections: ready.length * 2,
    shotsSent: metrics.shotsSent,
    shotsConfirmed: metrics.shotsConfirmed,
    lost: metrics.shotsSent - metrics.shotsConfirmed,
    duplicatedOrGapped: metrics.duplicatedOrGapped,
    errors: metrics.errors,
    errorRate: operations === 0 ? 0 : metrics.errors / operations,
    errorKinds: Object.fromEntries(metrics.errorKinds),
    shotsPerSecond: metrics.shotsConfirmed / playSeconds,
    latencyMs: {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted.at(-1) ?? Number.NaN,
    },
    bytesPerMessage: metrics.messagesReceived === 0 ? 0 : metrics.bytesReceived / metrics.messagesReceived,
    setupSeconds,
    playSeconds,
    cpuPercentAvg: avgCpu,
    dbCpuPercentAvg: dbSamples.length === 0 ? null : dbSamples.reduce((sum, sample) => sum + sample.cpuPercent, 0) / dbSamples.length,
    loginStorm: storm,
    memoryMbIdle: idle?.memoryMb ?? null,
    memoryMbMax: maxMemory,
    cpuPercentPerMatch: avgCpu === null || ready.length === 0 ? null : avgCpu / ready.length,
    memoryMbPerMatch: maxMemory === null || idle === null || ready.length === 0 ? null : (maxMemory - idle.memoryMb) / ready.length,
  };
  return result;
}

const results: Record<string, unknown>[] = [];
function saveReport(): void {
  const report = { label: values.label, url: BASE, thinkMs: THINK_MS, shotsPerMatch: SHOTS_PER_MATCH, date: new Date().toISOString(), results };
  mkdirSync(values.out.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
}

for (const step of values.steps.split(',').map(Number)) {
  console.log(`\nEscalón: ${String(step)} partidas simultáneas`);
  const result = await runStep(step);
  results.push(result);
  saveReport();
  console.log(JSON.stringify(result));
  const latency = result['latencyMs'] as { p95: number };
  const breached =
    !(latency.p95 < P95_TARGET_MS) || (result['errorRate'] as number) >= ERROR_TARGET || (result['lost'] as number) > 0 || (result['duplicatedOrGapped'] as number) > 0;
  if (breached) {
    console.log('Meta incumplida en este escalón');
    if (values['stop-on-breach']) break;
  }
  await sleep(3000);
}

console.log(`\nReporte en ${values.out}`);
process.exit(0);
