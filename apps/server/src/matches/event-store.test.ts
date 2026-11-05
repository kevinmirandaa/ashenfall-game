import { randomUUID } from 'node:crypto';
import { createMatchSetup, decide, evolve, initialState, replay, startMatch, type MatchEvent, type MatchState } from '@ashenfall/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate.js';
import { createTestDatabase, insertUser, type TestDatabase } from '../test-support/database.js';
import { MatchEventStore, SequenceConflictError } from './event-store.js';

const T0 = 1_000_000;
let db: TestDatabase;
let store: MatchEventStore;

beforeAll(async () => {
  db = await createTestDatabase();
  store = new MatchEventStore(db.pool);
});
afterAll(() => db.destroy());

async function newMatch(): Promise<{ state: MatchState; first: MatchEvent; playerA: string; playerB: string }> {
  const playerA = await insertUser(db.pool);
  const playerB = await insertUser(db.pool);
  const setup = createMatchSetup({ matchId: randomUUID(), playerIds: [playerA, playerB] }, { intBelow: () => 0 });
  const first = startMatch(setup, T0);
  await store.create(setup, first);
  return { state: initialState(first), first, playerA, playerB };
}

function shot(state: MatchState): readonly MatchEvent[] {
  if (state.turn === null) throw new Error('Partida terminada');
  const decision = decide(state, {
    type: 'shoot',
    playerId: state.turn.playerId,
    actionId: randomUUID(),
    expectedVersion: state.version,
    weaponId: 'bow',
    angleDeg: 45,
    power: 10,
    nowMs: T0 + 1,
  });
  if (decision.kind !== 'applied') throw new Error('Jugada rechazada');
  return decision.events;
}

describe('migrate', () => {
  it('es idempotente', async () => {
    const client = await db.pool.connect();
    try {
      expect(await migrate(client)).toEqual([]);
    } finally {
      client.release();
    }
  });
});

describe('MatchEventStore', () => {
  it('reconstruye desde PostgreSQL exactamente el mismo estado, como tras un reinicio', async () => {
    const { state, first } = await newMatch();
    const events = shot(state);
    await store.append(state.setup.matchId, events);
    expect(replay(await store.load(state.setup.matchId))).toEqual(events.reduce(evolve, initialState(first)));
  });

  it('dos réplicas que escriben a la vez la misma secuencia: gana una y no se pierde ni duplica nada', async () => {
    const { state } = await newMatch();
    const matchId = state.setup.matchId;
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => store.append(matchId, shot(state))));
    const failures = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(attempts.length - failures.length).toBe(1);
    for (const failure of failures) expect(failure.reason).toBeInstanceOf(SequenceConflictError);
    expect((await store.load(matchId)).map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it('una transacción fallida no deja eventos a medias', async () => {
    const { state } = await newMatch();
    const [firstEvent] = shot(state);
    if (firstEvent === undefined) throw new Error('Faltan eventos');
    await expect(store.append(state.setup.matchId, [firstEvent, firstEvent])).rejects.toBeInstanceOf(SequenceConflictError);
    expect(await store.load(state.setup.matchId)).toHaveLength(1);
  });

  it('un jugador no puede estar en dos partidas activas', async () => {
    const { playerA } = await newMatch();
    const other = await insertUser(db.pool);
    const setup = createMatchSetup({ matchId: randomUUID(), playerIds: [playerA, other] }, { intBelow: () => 0 });
    await expect(store.create(setup, startMatch(setup, T0))).rejects.toThrow(/match_players_one_active/);
    expect(await store.load(setup.matchId)).toEqual([]);
  });

  it('al terminar, registra el resultado, libera a los jugadores y lo deja fuera de las activas', async () => {
    const { state, playerA, playerB } = await newMatch();
    const matchId = state.setup.matchId;
    const decision = decide(state, { type: 'admin_terminate', nowMs: T0 });
    if (decision.kind !== 'applied') throw new Error('Rechazada');
    await store.append(matchId, decision.events);

    expect(await store.listActiveMatchIds()).not.toContain(matchId);
    const { rows } = await db.pool.query('SELECT reason FROM match_results WHERE match_id = $1', [matchId]);
    expect(rows).toEqual([{ reason: 'admin_terminated' }]);

    const next = createMatchSetup({ matchId: randomUUID(), playerIds: [playerA, playerB] }, { intBelow: () => 0 });
    await expect(store.create(next, startMatch(next, T0))).resolves.toBeUndefined();
  });

  it('el resultado es inmutable: otra escritura tras el final no puede reemplazarlo', async () => {
    const { state } = await newMatch();
    const decision = decide(state, { type: 'admin_terminate', nowMs: T0 });
    if (decision.kind !== 'applied') throw new Error('Rechazada');
    await store.append(state.setup.matchId, decision.events);
    await expect(store.append(state.setup.matchId, decision.events)).rejects.toBeInstanceOf(SequenceConflictError);
  });
});
