import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';

/**
 * Prueba de publicación con partidas abiertas. Mantiene varias partidas jugándose mientras se publica una revisión
 * nueva (o se cambia el número de réplicas) y comprueba que ninguna se corte: cada cliente se reconecta solo con un
 * ticket nuevo, reenvía la jugada pendiente con el MISMO `actionId` (idempotencia) y al final se contrasta, con el
 * `replay` del servidor, que cada jugada confirmada figura una sola vez en la partida.
 */
const { values } = parseArgs({
  allowNegative: true,
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:8080' },
    matches: { type: 'string', default: '6' },
    minutes: { type: 'string', default: '8' },
    'think-ms': { type: 'string', default: '10000' },
    out: { type: 'string', default: 'load-results/redeploy.json' },
    label: { type: 'string', default: '' },
  },
});

const BASE = values.url;
const WS_BASE = `${BASE.replace(/^http/, 'ws')}/ws`;
const THINK_MS = Number(values['think-ms']);
const DEADLINE = Date.now() + Number(values.minutes) * 60_000;
const ACK_TIMEOUT_MS = 6_000;
const MAX_ATTEMPTS = 12;

interface View {
  matchId: string;
  status: string;
  seq: number;
  version: number;
  turn: { playerId: string } | null;
}
interface WireMessage {
  type: string;
  code?: string;
  actionId?: string;
  duplicate?: boolean;
  view?: View;
  event?: { seq: number; payload: { type: string; playerId?: string; view?: View } };
}
interface ReplayBody {
  events: { payload: { type: string } }[];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

const stats = { reconnections: 0, resends: 0, ackedShots: 0, duplicateAcks: 0, ambiguousShots: 0, shotsSent: 0, matchesFinished: 0, matchesStarted: 0, errors: 0 };
const errorKinds = new Map<string, number>();
const countError = (kind: string): void => {
  stats.errors += 1;
  errorKinds.set(kind, (errorKinds.get(kind) ?? 0) + 1);
};

class Client {
  id = '';
  token = '';
  refreshToken = '';
  private socket: WebSocket | null = null;
  private open = false;
  private version = 0;
  private lastSeq = 0;
  private readonly listeners: ((message: WireMessage) => void)[] = [];
  turn = '';
  finished = false;
  matchId = '';
  ackedActions = new Set<string>();
  ambiguousActions = new Set<string>();

  async register(): Promise<void> {
    const body = await request<{ accessToken: string; refreshToken: string }>('POST', '/v1/auth/register', null, {
      email: `${randomUUID()}@redeploy.invalid`,
      password: 'clave-de-prueba-de-publicacion',
      displayName: 'Bot',
    });
    this.token = body.accessToken;
    this.refreshToken = body.refreshToken;
    this.id = (await request<{ id: string }>('GET', '/v1/me', this.token)).id;
  }

  async connect(): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const { ticket } = await request<{ ticket: string }>('POST', '/v1/ws-ticket', this.token);
        const socket = new WebSocket(`${WS_BASE}?ticket=${ticket}`);
        this.socket = socket;
        socket.on('message', (data: Buffer) => {
          const message = JSON.parse(data.toString()) as WireMessage;
          this.onMessage(message);
          for (const listener of [...this.listeners]) listener(message);
        });
        socket.on('close', () => {
          if (this.socket !== socket) return;
          this.open = false;
          if (!this.finished) void this.reconnect();
        });
        socket.on('error', () => undefined);
        await this.waitFor((message) => message.type === 'welcome', 10_000);
        this.open = true;
        return;
      } catch (error) {
        // Mientras la revisión nueva arranca, el ticket o el socket pueden fallar: se reintenta.
        if (attempt >= 30) throw error;
        await sleep(Math.min(500 * attempt, 3_000));
      }
    }
  }

  private async reconnect(): Promise<void> {
    stats.reconnections += 1;
    await sleep(300);
    try {
      await this.connect();
    } catch {
      countError('reconexion');
    }
  }

  private onMessage(message: WireMessage): void {
    if (message.type === 'snapshot' && message.view !== undefined) {
      this.applyView(message.view);
      return;
    }
    if (message.type === 'event' && message.event !== undefined) {
      const { seq, payload } = message.event;
      this.version += seq - this.lastSeq;
      this.lastSeq = seq;
      if (payload.type === 'match_started' && payload.view !== undefined) this.applyView(payload.view);
      else if (payload.type === 'turn_started' && payload.playerId !== undefined) this.turn = payload.playerId;
      else if (payload.type === 'match_finished') this.finished = true;
    }
  }

  private applyView(view: View): void {
    this.matchId = view.matchId;
    this.version = view.version;
    this.lastSeq = view.seq;
    this.turn = view.turn?.playerId ?? '';
    if (view.status === 'finished') this.finished = true;
  }

  waitFor(match: (message: WireMessage) => boolean, timeoutMs: number): Promise<WireMessage> {
    return new Promise((resolve, reject) => {
      const listener = (message: WireMessage): void => {
        if (!match(message)) return;
        clearTimeout(timer);
        this.listeners.splice(this.listeners.indexOf(listener), 1);
        resolve(message);
      };
      const timer = setTimeout(() => {
        this.listeners.splice(this.listeners.indexOf(listener), 1);
        reject(new Error('tiempo agotado'));
      }, timeoutMs);
      this.listeners.push(listener);
    });
  }

  /** Una jugada lógica: se reenvía con el mismo `actionId` hasta que el servidor la confirme o diga que ya no procede. */
  async shoot(): Promise<void> {
    const actionId = randomUUID();
    stats.shotsSent += 1;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (this.finished) return;
      // Sin conexión no se gasta un intento: se espera a que la revisión nueva acepte la reconexión (hasta 90 s).
      for (let waited = 0; (!this.open || this.socket === null) && waited < 90_000; waited += 250) await sleep(250);
      if (!this.open || this.socket === null) break;
      if (attempt > 1) stats.resends += 1;
      const answer = this.waitFor((message) => (message.type === 'ack' || message.type === 'error') && message.actionId === actionId, ACK_TIMEOUT_MS);
      this.socket.send(
        JSON.stringify({ v: 1, type: 'shoot', matchId: this.matchId, actionId, expectedVersion: this.version, weaponId: 'dagger', angleDeg: 45, power: 10 }),
      );
      try {
        const message = await answer;
        if (process.env.BOT_DEBUG !== undefined) console.error('respuesta', attempt, JSON.stringify(message).slice(0, 160));
        if (message.type === 'ack') {
          this.ackedActions.add(actionId);
          stats.ackedShots += 1;
          if (message.duplicate === true) stats.duplicateAcks += 1;
          return;
        }
        if (message.code === 'STALE_VERSION') {
          this.socket.send(JSON.stringify({ v: 1, type: 'sync', matchId: this.matchId }));
          await sleep(500);
          continue;
        }
        // Otro rechazo (por ejemplo, ya no es su turno): puede que un envío anterior sí se aplicara.
        this.ambiguousActions.add(actionId);
        stats.ambiguousShots += 1;
        return;
      } catch {
        // Sin respuesta: la conexión pudo caer; se reintenta con el mismo actionId.
        if (process.env.BOT_DEBUG !== undefined) console.error('sin respuesta', attempt, this.open, this.version);
      }
    }
    this.ambiguousActions.add(actionId);
    stats.ambiguousShots += 1;
    countError('sin-confirmacion');
  }
}

interface PlayedMatch {
  matchId: string;
  token: string;
  acked: number;
  ambiguous: number;
}

async function playSlot(): Promise<PlayedMatch[]> {
  const a = new Client();
  const b = new Client();
  await a.register();
  await b.register();
  await a.connect();
  await b.connect();
  const played: PlayedMatch[] = [];
  while (Date.now() < DEADLINE) {
    a.finished = false;
    b.finished = false;
    a.ackedActions = new Set();
    a.ambiguousActions = new Set();
    b.ackedActions = new Set();
    b.ambiguousActions = new Set();
    const room = await request<{ id: string; inviteCode: string }>('POST', '/v1/rooms', a.token, { visibility: 'private' });
    await request('POST', '/v1/rooms/join-by-code', b.token, { inviteCode: room.inviteCode });
    const started = Promise.all([
      a.waitFor((message) => message.type === 'event' && message.event?.payload.type === 'match_started', 15_000),
      b.waitFor((message) => message.type === 'event' && message.event?.payload.type === 'match_started', 15_000),
    ]);
    await request('POST', `/v1/rooms/${room.id}/ready`, a.token, { ready: true });
    await request('POST', `/v1/rooms/${room.id}/ready`, b.token, { ready: true });
    await started;
    stats.matchesStarted += 1;
    const matchId = a.matchId;
    while (!a.finished && !b.finished && Date.now() < DEADLINE) {
      const shooter = a.turn === a.id ? a : b.turn === b.id ? b : null;
      if (shooter === null) {
        await sleep(200);
        continue;
      }
      await sleep(THINK_MS * (0.7 + Math.random() * 0.6));
      await shooter.shoot();
      await sleep(300);
    }
    if (a.finished || b.finished) {
      stats.matchesFinished += 1;
      played.push({ matchId, token: a.token, acked: a.ackedActions.size + b.ackedActions.size, ambiguous: a.ambiguousActions.size + b.ambiguousActions.size });
      await sleep(500);
    }
    // Si se acabó el tiempo a medias, la partida queda abierta y el barrido la termina al cerrar.
    if (!a.finished && !b.finished) break;
  }
  return played;
}

async function verify(played: PlayedMatch[]): Promise<{ lost: number; duplicated: number; checked: number }> {
  let lost = 0;
  let duplicated = 0;
  for (const { matchId, token, acked, ambiguous: maybe } of played) {
    try {
      const replay = await request<ReplayBody>('GET', `/v1/matches/${matchId}/replay`, token);
      const applied = replay.events.filter((event) => event.payload.type === 'shot_resolved').length;
      if (applied < acked) lost += acked - applied;
      if (applied > acked + maybe) duplicated += applied - acked - maybe;
    } catch {
      countError('replay');
    }
  }
  return { lost, duplicated, checked: played.length };
}

const slots = Number(values.matches);
const startedAt = Date.now();
const results = await Promise.allSettled(Array.from({ length: slots }, () => playSlot()));
const played = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
for (const result of results) if (result.status === 'rejected') countError(`partida:${String(result.reason)}`.slice(0, 80));
const verdict = await verify(played);
const summary = {
  label: values.label,
  url: BASE,
  slots,
  minutes: (Date.now() - startedAt) / 60_000,
  ...stats,
  errorKinds: Object.fromEntries(errorKinds),
  replayChecked: verdict.checked,
  lost: verdict.lost,
  duplicated: verdict.duplicated,
  ok: verdict.lost === 0 && verdict.duplicated === 0 && stats.errors === 0,
};
console.log(JSON.stringify(summary, null, 2));
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, `${JSON.stringify(summary, null, 2)}\n`);
process.exit(summary.ok ? 0 : 1);
