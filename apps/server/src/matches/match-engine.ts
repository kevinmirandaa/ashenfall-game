import { decide, evolve, nextDeadline, replay, type Decision, type MatchCommand, type MatchEvent, type MatchState } from '@ashenfall/domain';
import { MatchEventStore, SequenceConflictError } from './event-store.js';

export class MatchNotFoundError extends Error {
  override readonly name = 'MatchNotFoundError';
}

export interface PublishedEvent {
  readonly event: MatchEvent;
  readonly stateAfter: MatchState;
}

/** Difunde eventos ya confirmados a quien tenga conectados a los jugadores. */
export type EventPublisher = (matchId: string, events: readonly PublishedEvent[]) => void;

const MAX_CONFLICT_RETRIES = 5;

export function withStates(state: MatchState, events: readonly MatchEvent[]): readonly PublishedEvent[] {
  let current = state;
  return events.map((event) => {
    current = evolve(current, event);
    return { event, stateAfter: current };
  });
}

/**
 * Orden por partida: en esta réplica las jugadas de una partida esperan en fila, y entre réplicas
 * la clave (match_id, seq) deja ganar a una sola; la perdedora relee el log y vuelve a decidir.
 * El estado siempre se reconstruye desde PostgreSQL, así que un reinicio no pierde nada confirmado.
 */
export class MatchEngine {
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: MatchEventStore,
    private readonly publish: EventPublisher,
  ) {}

  async state(matchId: string): Promise<MatchState> {
    const events = await this.store.load(matchId);
    if (events.length === 0) throw new MatchNotFoundError(matchId);
    return replay(events);
  }

  execute(matchId: string, command: MatchCommand): Promise<Decision> {
    const previous = this.tails.get(matchId) ?? Promise.resolve();
    // Un fallo en una jugada no bloquea la fila de esa partida ni afecta a las demás.
    const run = previous.catch(() => undefined).then(() => this.decideAndPersist(matchId, command));
    this.tails.set(matchId, run);
    void run
      .catch(() => undefined)
      .finally(() => {
        if (this.tails.get(matchId) === run) this.tails.delete(matchId);
      });
    return run;
  }

  private async decideAndPersist(matchId: string, command: MatchCommand): Promise<Decision> {
    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
      const state = await this.state(matchId);
      const decision = decide(state, command);
      if (decision.kind !== 'applied' || decision.events.length === 0) return decision;
      const published = withStates(state, decision.events);
      const finalState = published.at(-1)?.stateAfter ?? state;
      try {
        await this.store.append(matchId, decision.events, nextDeadline(finalState));
      } catch (error) {
        if (error instanceof SequenceConflictError) continue;
        throw error;
      }
      // Se difunde solo después de confirmar en PostgreSQL.
      this.publish(matchId, published);
      return decision;
    }
    throw new Error(`Demasiados conflictos de secuencia en la partida ${matchId}`);
  }
}
