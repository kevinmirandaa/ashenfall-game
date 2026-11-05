import { describe, expect, it } from 'vitest';
import { createMatchSetup, decide, evolve, initialState, startMatch, type MatchState } from './match.js';
import { toPlayerEvent, toPlayerView, type ShotView } from './view.js';

const T0 = 1_000_000;
const A = 'player-a';
const B = 'player-b';
const SECRET_ACTION_ID = '11111111-2222-4333-8444-555555555555';
const SECRET_ANGLE = 43.21;
const SECRET_POWER = 56.78;

function begin(): MatchState {
  const setup = createMatchSetup({ matchId: 'm1', playerIds: [A, B] }, { intBelow: () => 0 });
  return initialState(startMatch(setup, T0));
}

function shotByA() {
  const state = begin();
  const decision = decide(state, {
    type: 'shoot',
    playerId: A,
    actionId: SECRET_ACTION_ID,
    expectedVersion: state.version,
    weaponId: 'bow',
    angleDeg: SECRET_ANGLE,
    power: SECRET_POWER,
    nowMs: T0 + 1,
  });
  if (decision.kind !== 'applied') throw new Error('La jugada debía aplicarse');
  const [event] = decision.events;
  if (event === undefined) throw new Error('Faltan eventos');
  const after = decision.events.reduce(evolve, state);
  return { event, after };
}

describe('vista por jugador', () => {
  it('cada jugador se ve a sí mismo como "you" y al otro como "opponent"', () => {
    const state = begin();
    expect(toPlayerView(state, A)).toMatchObject({ you: { playerId: A }, opponent: { playerId: B } });
    expect(toPlayerView(state, B)).toMatchObject({ you: { playerId: B }, opponent: { playerId: A } });
  });

  it('la posición del rival es pública en la partida, para el paneo inicial de cámara', () => {
    const state = begin();
    expect(toPlayerView(state, A)?.opponent.position).toEqual(state.setup.players[1].position);
  });

  it('un tercero no recibe vista ni eventos', () => {
    const { event, after } = shotByA();
    expect(toPlayerView(after, 'intruso')).toBeNull();
    expect(toPlayerEvent(event, after, 'intruso')).toBeNull();
  });

  it('el snapshot no incluye campos internos', () => {
    const { after } = shotByA();
    const serialized = JSON.stringify(toPlayerView(after, B));
    for (const internal of ['appliedActions', 'consecutiveTimeouts', 'graceDeadlineMs', 'config', 'actionId']) {
      expect(serialized).not.toContain(internal);
    }
  });
});

describe('no-filtración hacia el rival', () => {
  it('el evento de disparo que recibe el rival no revela actionId, ángulo ni potencia', () => {
    const { event, after } = shotByA();
    const serialized = JSON.stringify(toPlayerEvent(event, after, B));
    expect(serialized).not.toContain(SECRET_ACTION_ID);
    expect(serialized).not.toContain(String(SECRET_ANGLE));
    expect(serialized).not.toContain(String(SECRET_POWER));
    expect(serialized).not.toContain('angleDeg');
    expect(serialized).not.toContain('"power"');
  });

  it('el snapshot de reconexión del rival tampoco revela esos datos', () => {
    const { after } = shotByA();
    const serialized = JSON.stringify(toPlayerView(after, B));
    expect(serialized).not.toContain(SECRET_ACTION_ID);
    expect(serialized).not.toContain(String(SECRET_ANGLE));
    expect(serialized).not.toContain(String(SECRET_POWER));
  });

  it('quien disparó recibe la confirmación de su propia jugada', () => {
    const { event, after } = shotByA();
    const payload = toPlayerEvent(event, after, A)?.payload as ShotView;
    expect(payload.own).toEqual({ actionId: SECRET_ACTION_ID, angleDeg: SECRET_ANGLE, power: SECRET_POWER });
  });

  it('ambos jugadores reciben la misma trayectoria e impacto, para que la cámara siga el disparo', () => {
    const { event, after } = shotByA();
    const forShooter = toPlayerEvent(event, after, A)?.payload as ShotView;
    const forRival = toPlayerEvent(event, after, B)?.payload as ShotView;
    expect(forRival.path).toEqual(forShooter.path);
    expect(forRival.impact).toEqual(forShooter.impact);
    expect(forRival.path.length).toBeGreaterThan(1);
  });
});
