import type { PlayerEventPayload, PlayerMatchView, WeaponId } from '@ashenfall/domain';
import Phaser from 'phaser';
import { ArenaScene } from './arena.js';
import { ApiError, GameSocket, Session, type ServerMessage } from './net.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Falta #${id}`);
  return found as T;
}

const panel = element('panel');
const hud = element('hud');
const controls = element('controls');
const toast = element('toast');
const weapon = element<HTMLSelectElement>('weapon');
const power = element<HTMLInputElement>('power');
const fire = element<HTMLButtonElement>('fire');

const session = new Session();
const arena = new ArenaScene();
new Phaser.Game({
  // Canvas: más ligero y compatible que WebGL para un juego 2D de este tamaño.
  type: Phaser.CANVAS,
  parent: 'game',
  backgroundColor: '#17191b',
  scale: { mode: Phaser.Scale.RESIZE, width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) },
  pixelArt: true,
  scene: arena,
});

let socket: GameSocket | null = null;
let view: PlayerMatchView | null = null;
let myId = '';
let inMatch = false;
let pendingResult: PlayerMatchView['result'] = null;
let lastSeq = 0;
let awaitingAck = false;
let toastTimer = 0;

function notify(message: string): void {
  toast.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.textContent = '';
  }, 4000);
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const known: Record<string, string> = {
      INVALID_CREDENTIALS: 'Correo o contraseña incorrectos.',
      EMAIL_TAKEN: 'Ese correo ya está registrado.',
      VALIDATION_FAILED: 'Revisa los datos: la contraseña necesita al menos 10 caracteres.',
      RATE_LIMITED: 'Demasiados intentos. Espera un momento.',
      AUTH_BUSY: 'El servidor está ocupado. Inténtalo de nuevo.',
      ROOM_NOT_FOUND: 'No existe una sala con ese código.',
      ROOM_FULL: 'La sala está llena.',
      ALREADY_IN_ROOM: 'Ya estás en una sala.',
    };
    return known[error.code] ?? error.message;
  }
  return 'No se pudo conectar con el servidor.';
}

async function guarded(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    notify(errorText(error));
  }
}

// ---------- Pantallas ----------
function showLogin(): void {
  panel.innerHTML = `
    <h1>ASHENFALL</h1>
    <p class="tagline">Aim true. Survive the ashes.</p>
    <form id="auth">
      <input name="displayName" placeholder="Nombre de mercenario (solo registro)" maxlength="32" autocomplete="nickname" />
      <input name="email" type="email" placeholder="Correo" required autocomplete="email" />
      <input name="password" type="password" placeholder="Contraseña (mínimo 10)" required minlength="10" maxlength="128" autocomplete="current-password" />
      <div class="row">
        <button type="submit" name="mode" value="login">Entrar</button>
        <button type="submit" name="mode" value="register" class="secondary">Crear cuenta</button>
      </div>
    </form>`;
  element<HTMLFormElement>('auth').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const mode = (event.submitter as HTMLButtonElement | null)?.value === 'register' ? 'register' : 'login';
    const credentials = { email: String(data.get('email')), password: String(data.get('password')) };
    void guarded(async () => {
      if (mode === 'register') {
        await session.authenticate('register', { ...credentials, displayName: String(data.get('displayName')) || 'Mercenario' });
      } else {
        await session.authenticate('login', credentials);
      }
      await enterLobby();
    });
  });
}

async function enterLobby(): Promise<void> {
  socket ??= new GameSocket(session, onServerMessage, (connected) => {
    if (!connected && inMatch) notify('Conexión perdida. Reconectando…');
  });
  const profile = await session.call<{ id: string; displayName: string; balance: number }>('GET', '/v1/me');
  myId = profile.id;
  await socket.connect();
  showLobby(profile.displayName, profile.balance);
}

function showLobby(name: string, balance: number): void {
  inMatch = false;
  hud.hidden = true;
  controls.hidden = true;
  panel.innerHTML = `
    <h2>La Taberna</h2>
    <p class="muted">${escapeHtml(name)} · ${String(balance)} Marcas de Ceniza</p>
    <div class="stack">
      <button id="quick">Buscar partida</button>
      <button id="create" class="secondary">Crear sala privada</button>
      <form id="join" class="row">
        <input name="code" placeholder="Código" maxlength="8" required style="text-transform:uppercase" />
        <button class="secondary">Unirse</button>
      </form>
      <button id="logout" class="secondary">Cerrar sesión</button>
    </div>`;
  element('quick').addEventListener('click', () => void guarded(searchMatch));
  element('create').addEventListener('click', () => {
    void guarded(async () => {
      showRoom(await session.call<Room>('POST', '/v1/rooms', { visibility: 'private' }));
    });
  });
  element<HTMLFormElement>('join').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget as HTMLFormElement).get('code')).toUpperCase();
    void guarded(async () => {
      showRoom(await session.call<Room>('POST', '/v1/rooms/join-by-code', { inviteCode: code }));
    });
  });
  element('logout').addEventListener('click', () => {
    void guarded(async () => {
      socket?.close();
      socket = null;
      await session.logout();
      showLogin();
    });
  });
}

interface Room {
  id: string;
  inviteCode?: string;
  members: { userId: string; displayName: string; ready: boolean }[];
}

function showRoom(room: Room): void {
  panel.innerHTML = `
    <h2>Sala privada</h2>
    ${room.inviteCode === undefined ? '' : `<p class="code">${escapeHtml(room.inviteCode)}</p><p class="muted">Comparte este código con tu rival.</p>`}
    <div class="stack">
      <button id="ready">Estoy listo</button>
      <button id="leave" class="secondary">Salir</button>
    </div>`;
  element('ready').addEventListener('click', () => {
    void guarded(async () => {
      await session.call('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
      element<HTMLButtonElement>('ready').disabled = true;
      element('ready').textContent = 'Esperando al rival…';
    });
  });
  element('leave').addEventListener('click', () => {
    void guarded(async () => {
      await session.call('POST', `/v1/rooms/${room.id}/leave`);
      await enterLobby();
    });
  });
}

async function searchMatch(): Promise<void> {
  const result = await session.call<{ status: string }>('POST', '/v1/matchmaking');
  if (result.status === 'matched') return;
  panel.innerHTML = `
    <h2>Buscando rival…</h2>
    <p class="muted">La espera máxima es de un minuto.</p>
    <button id="cancel" class="secondary">Cancelar</button>`;
  const timeout = window.setTimeout(() => {
    if (inMatch) return;
    void guarded(async () => {
      await session.call('DELETE', '/v1/matchmaking');
      notify('No se encontró rival. Inténtalo de nuevo.');
      await enterLobby();
    });
  }, 60_000);
  element('cancel').addEventListener('click', () => {
    window.clearTimeout(timeout);
    void guarded(async () => {
      await session.call('DELETE', '/v1/matchmaking');
      await enterLobby();
    });
  });
}

function escapeHtml(text: string): string {
  const holder = document.createElement('span');
  holder.textContent = text;
  return holder.innerHTML;
}

// ---------- Partida ----------
function onServerMessage(message: ServerMessage): void {
  switch (message.type) {
    case 'snapshot':
      if (message.view.status === 'in_progress') beginMatch(message.view, false);
      break;
    case 'event':
      onMatchEvent(message.matchId, message.event.seq, message.event.payload);
      break;
    case 'ack':
      awaitingAck = false;
      break;
    case 'error':
      awaitingAck = false;
      if (inMatch) notify(`Jugada rechazada: ${message.code}`);
      if (message.code === 'STALE_VERSION' && view !== null) socket?.send({ type: 'sync', matchId: view.matchId });
      refreshHud();
      break;
    case 'welcome':
      break;
  }
}

function beginMatch(next: PlayerMatchView, intro: boolean): void {
  if (intro || !inMatch || view?.matchId !== next.matchId) {
    arena.loadMatch(next, intro);
  } else {
    arena.updateView(next);
  }
  view = next;
  lastSeq = next.seq;
  inMatch = true;
  pendingResult = null;
  panel.innerHTML = '';
  hud.hidden = false;
  controls.hidden = false;
  refreshHud();
}

function onMatchEvent(matchId: string, seq: number, payload: PlayerEventPayload): void {
  if (payload.type === 'match_started') {
    beginMatch(payload.view, true);
    return;
  }
  if (view === null || view.matchId !== matchId || seq <= lastSeq) return;
  // Hueco de secuencia: se perdió un mensaje, se recupera el estado completo.
  if (seq !== lastSeq + 1) {
    socket?.send({ type: 'sync', matchId });
    return;
  }
  lastSeq = seq;
  view = applyToView(view, seq, payload);
  arena.updateView(view);
  arena.applyEvent(payload);
  if (payload.type === 'match_finished') pendingResult = payload.result;
  refreshHud();
  if (pendingResult !== null && !arena.busy) showResult();
}

/** Espejo de los campos visibles. El estado autoritativo siempre es el del servidor. */
function applyToView(current: PlayerMatchView, seq: number, payload: PlayerEventPayload): PlayerMatchView {
  const base = { ...current, seq };
  switch (payload.type) {
    case 'shot_resolved': {
      const target = payload.shooterId === current.you.playerId ? 'opponent' : 'you';
      return { ...base, version: current.version + 1, [target]: { ...current[target], hp: payload.targetHpAfter } };
    }
    case 'turn_timed_out':
      return { ...base, version: current.version + 1 };
    case 'turn_started':
      return {
        ...base,
        version: current.version + 1,
        round: payload.round,
        turn: { playerId: payload.playerId, round: payload.round, deadlineMs: payload.deadlineMs },
      };
    case 'player_disconnected':
    case 'player_reconnected': {
      const side = payload.playerId === current.you.playerId ? 'you' : 'opponent';
      return { ...base, [side]: { ...current[side], connected: payload.type === 'player_reconnected' } };
    }
    case 'match_finished':
      return { ...base, version: current.version + 1, status: 'finished', turn: null, result: payload.result };
    default:
      return base;
  }
}

function refreshHud(): void {
  if (view === null) return;
  const mine = view.turn?.playerId === myId;
  const canShoot = mine && !arena.busy && !awaitingAck && view.status === 'in_progress';
  arena.canAim = canShoot;
  arena.drawGuide();
  fire.disabled = !canShoot;
  element('turn').textContent = view.status === 'finished' ? 'Fin' : mine ? 'Tu turno' : 'Turno del rival';
  const wind = Math.round(view.windAccel);
  element('wind').textContent = `Viento ${wind === 0 ? '—' : wind > 0 ? '→' : '←'} ${String(Math.abs(wind))}`;
  element('round').textContent = `Ronda ${String(view.round)}/${String(view.maxRounds)}`;
  element('you-hp').style.width = `${String(view.you.hp)}%`;
  element('rival-hp').style.width = `${String(view.opponent.hp)}%`;
  element('you-hp-text').textContent = String(view.you.hp);
  element('rival-hp-text').textContent = String(view.opponent.hp);
  element('rival-status').textContent = view.opponent.connected ? '' : '(desconectado)';
  element('power-text').textContent = power.value;
  element('angle-text').textContent = `Ángulo ${String(arena.angleDeg)}°`;
}

function shoot(): void {
  if (view === null || fire.disabled) return;
  awaitingAck = true;
  socket?.send({
    type: 'shoot',
    matchId: view.matchId,
    actionId: crypto.randomUUID(),
    expectedVersion: view.version,
    weaponId: weapon.value,
    angleDeg: arena.angleDeg,
    power: Number(power.value),
  });
  refreshHud();
}

function showResult(): void {
  const result = pendingResult;
  if (result === null) return;
  pendingResult = null;
  inMatch = false;
  controls.hidden = true;
  const title = result.winnerId === null ? 'Empate' : result.winnerId === myId ? 'Victoria' : 'Derrota';
  const reward = result.winnerId === myId ? '<p class="muted">+100 Marcas de Ceniza</p>' : '';
  panel.innerHTML = `<h2>${title}</h2>${reward}<button id="back">Volver a la Taberna</button>`;
  element('back').addEventListener('click', () => void guarded(enterLobby));
}

arena.setHooks({
  onAnimationsIdle: () => {
    refreshHud();
    if (pendingResult !== null) showResult();
  },
  onAim: refreshHud,
});
fire.addEventListener('click', shoot);
power.addEventListener('input', () => {
  arena.power = Number(power.value);
  refreshHud();
});
weapon.addEventListener('change', () => {
  arena.weaponId = weapon.value as WeaponId;
  arena.drawGuide();
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && inMatch && document.activeElement?.tagName !== 'INPUT') {
    event.preventDefault();
    shoot();
  }
});
window.setInterval(() => {
  if (view?.turn === null || view === null || !inMatch) return;
  element('timer').textContent = `${String(Math.max(0, Math.ceil((view.turn.deadlineMs - Date.now()) / 1000)))} s`;
}, 250);

showLogin();
