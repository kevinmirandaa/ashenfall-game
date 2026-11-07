import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { MatchEngine } from './match-engine.js';

const BATCH_SIZE = 200;
/** Salas abiertas sin iniciar más tiempo que esto se cierran y liberan a sus miembros. */
const ROOM_MAX_AGE = '1 hour';
/**
 * La limpieza de cola y salas no tiene prisa: la cola ya filtra por `expires_at` y las salas caducan a la hora.
 * Hacerla cada 30 s y no en cada barrido deja en reposo 2 consultas por segundo en vez de 4.
 */
const HOUSEKEEPING_INTERVAL_MS = 30_000;

/**
 * Barre plazos vencidos. No hay réplica líder: si dos barren la misma partida, el dominio rechaza el
 * comando repetido y la clave (match_id, seq) deja confirmar uno solo. Como el plazo está en PostgreSQL,
 * un reinicio no pierde temporizadores.
 */
export class MatchSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastHousekeepingMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly pool: pg.Pool,
    private readonly engine: MatchEngine,
    private readonly logger: FastifyBaseLogger,
  ) {}

  start(intervalMs: number): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.runOnce(Date.now())
        .catch((error: unknown) => {
          this.logger.error({ err: error }, 'Fallo en el barrido de plazos');
        })
        .finally(() => {
          this.running = false;
        });
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  async runOnce(nowMs: number): Promise<void> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM matches WHERE status = 'in_progress' AND next_deadline_ms <= $1
       ORDER BY next_deadline_ms LIMIT $2`,
      [nowMs, BATCH_SIZE],
    );
    for (const { id } of rows) {
      // Aislamiento: el fallo de una partida no detiene a las demás.
      try {
        await this.sweepMatch(id, nowMs);
      } catch (error) {
        this.logger.error({ err: error, matchId: id }, 'Fallo al aplicar un plazo vencido');
      }
    }
    await this.runBotTurns(nowMs);
    if (nowMs - this.lastHousekeepingMs < HOUSEKEEPING_INTERVAL_MS) return;
    this.lastHousekeepingMs = nowMs;
    await this.pool.query('DELETE FROM matchmaking_queue WHERE expires_at <= now()');
    await this.pool.query(
      `WITH stale AS (
         UPDATE rooms SET status = 'closed'
         WHERE status = 'open' AND created_at < now() - $1::interval
         RETURNING id
       )
       DELETE FROM room_members WHERE room_id IN (SELECT id FROM stale)`,
      [ROOM_MAX_AGE],
    );
  }

  /** Turnos de bots vencidos: la misma jugada con el mismo id se descarta como duplicada si otra réplica ya la hizo. */
  private async runBotTurns(nowMs: number): Promise<void> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM matches WHERE status = 'in_progress' AND bot_due_ms IS NOT NULL AND bot_due_ms <= $1
       ORDER BY bot_due_ms LIMIT $2`,
      [nowMs, BATCH_SIZE],
    );
    for (const { id } of rows) {
      try {
        await this.engine.botTurn(id, nowMs);
      } catch (error) {
        this.logger.error({ err: error, matchId: id }, 'Fallo en el turno del bot');
      }
    }
  }

  private async sweepMatch(matchId: string, nowMs: number): Promise<void> {
    const state = await this.engine.state(matchId);
    // La gracia va primero: quien abandonó pierde por abandono aunque también haya vencido su turno.
    for (const player of state.players) {
      if (player.graceDeadlineMs !== null && player.graceDeadlineMs <= nowMs) {
        const decision = await this.engine.execute(matchId, { type: 'grace_expired', playerId: player.playerId, nowMs });
        if (decision.kind === 'applied') return;
      }
    }
    if (state.turn !== null && state.turn.deadlineMs <= nowMs) {
      await this.engine.execute(matchId, { type: 'turn_timeout', expectedVersion: state.version, nowMs });
    }
  }
}
