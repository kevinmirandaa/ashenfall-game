import { isWeaponId, WEAPON_IDS, type PlayerEventPayload, type PlayerMatchView, type ShotView, type WeaponId } from '@ashenfall/domain';
import Phaser from 'phaser';
import { ArenaScene } from './arena.js';
import { baseLook, CHARACTERS, DEFAULT_WEAPON, frameUrl, icon, type CharacterId, type Look } from './art.js';
import { ApiError, GameSocket, Session, type ServerMessage } from './net.js';
import { biomeCard, closeModal, el, END_REASON, escapeHtml, lookFrom, openArsenal, openBrotherhood, openModal, openShop, portrait, type Profile, type Room, type ShopActions } from './screens.js';

const STAGE_W = 1280;
const STAGE_H = 720;
const ROOM_POLL_MS = 2000;
const ANGLE_STEP = 1;
const POWER_STEP = 2;

const screen = el('screen');
const toast = el('toast');
const ui = el('ui');

document.documentElement.style.setProperty('--frame', `url(${frameUrl()})`);

// La interfaz se diseña sobre 1280×720 y se escala completa: siempre 16:9 y sin recolocar nada.
function fitStage(): void {
  const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  ui.style.transform = `translate(-50%, -50%) scale(${String(scale)})`;
}
window.addEventListener('resize', fitStage);
fitStage();

const session = new Session();
let booted = false;
const arena = new ArenaScene(() => {
  booted = true;
  syncLoop();
});
const game = new Phaser.Game({
  // Canvas: más ligero y compatible que WebGL para un juego 2D de este tamaño.
  type: Phaser.CANVAS,
  parent: 'game',
  backgroundColor: '#0d0b10',
  width: STAGE_W,
  height: STAGE_H,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  pixelArt: true,
  banner: false,
  scene: arena,
});

let socket: GameSocket | null = null;
let profile: Profile = { id: '', displayName: '', balance: 0 };
let view: PlayerMatchView | null = null;
let inMatch = false;
let pendingResult: PlayerMatchView['result'] = null;
let lastSeq = 0;
let awaitingAck = false;
let toastTimer = 0;
let introActive = false;
let roomPoll = 0;
let searchTimeout = 0;
let rivalName = 'Rival';
let lastRoomId: string | null = null;
let shownHp = { you: 100, rival: 100 };
let look: Look = baseLook('edrik');
let ownedCache: Parameters<typeof lookFrom>[1] = [];

/** Fuera de la arena el bucle de Phaser se detiene: el pueblo no consume CPU en cada fotograma. */
function syncLoop(): void {
  if (!booted) return;
  if (inMatch) {
    game.loop.wake();
    // Dormido, Phaser no procesa cambios de tamaño: la ventana pudo cambiar mientras tanto.
    game.scale.refresh();
  } else {
    game.loop.sleep();
  }
}
document.addEventListener('visibilitychange', () => {
  // Phaser reanuda su bucle al volver a la pestaña; aquí se mantiene dormido si no hay partida.
  window.setTimeout(syncLoop, 0);
});

// ---------- Preferencia local ----------
// El contrato del servidor no tiene personaje: la elección se recuerda en este navegador.
function loadCharacter(userId: string): CharacterId {
  try {
    const stored = localStorage.getItem(`ashenfall.character.${userId}`);
    return CHARACTERS.find((hero) => hero.id === stored)?.id ?? 'edrik';
  } catch {
    return 'edrik';
  }
}
function saveCharacter(userId: string, id: CharacterId): void {
  try {
    localStorage.setItem(`ashenfall.character.${userId}`, id);
  } catch {
    // Sin almacenamiento la elección dura hasta recargar.
  }
}
/** El servidor no publica el personaje del rival: se deriva de su id para que sea estable durante la partida. */
function rivalCharacter(playerId: string): CharacterId {
  let hash = 0;
  for (const char of playerId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return CHARACTERS[Math.abs(hash) % CHARACTERS.length]?.id ?? 'edrik';
}

// ---------- Avisos y errores ----------
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
      INSUFFICIENT_FUNDS: 'No tienes suficientes Marcas de Ceniza.',
      ALREADY_OWNED: 'Ya tienes este artículo.',
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

const shopActions: ShopActions = {
  session,
  guarded,
  notify,
  profile: () => profile,
  setBalance: (balance) => {
    profile = { ...profile, balance };
    const purse = document.getElementById('purse-value');
    if (purse !== null) purse.textContent = String(balance);
  },
  character: () => look.character,
  setCharacter: (id) => {
    saveCharacter(profile.id, id);
    look = lookFrom(id, ownedCache);
    paintPlayerCard();
  },
  refreshLook: (items) => {
    ownedCache = [...items];
    look = lookFrom(look.character, ownedCache);
    paintPlayerCard();
  },
};

// ---------- Acceso ----------
function showLogin(): void {
  screen.className = 'login';
  screen.innerHTML = `
    <img class="px backdrop" src="/art/castle.png" alt="" />
    <img class="logo" src="/art/logo.png" alt="Ashenfall, The Last Mercenary Guild" />
    <section class="panel login-box">
      <form id="auth">
        <label>Nombre de mercenario <small>(solo al crear cuenta)</small><input name="displayName" maxlength="32" autocomplete="nickname" /></label>
        <label>Correo<input name="email" type="email" required autocomplete="email" /></label>
        <label>Contraseña <small>(mínimo 10 caracteres)</small><input name="password" type="password" required minlength="10" maxlength="128" autocomplete="current-password" /></label>
        <div class="row">
          <button class="primary" type="submit" value="login">Entrar</button>
          <button type="submit" value="register">Crear cuenta</button>
        </div>
      </form>
    </section>
    <p class="motto">Apunta. Dispara. Sobrevive.</p>`;
  el<HTMLFormElement>('auth').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const mode = (event.submitter as HTMLButtonElement | null)?.value === 'register' ? 'register' : 'login';
    const credentials = { email: String(data.get('email')), password: String(data.get('password')) };
    void guarded(async () => {
      if (mode === 'register') {
        await session.authenticate('register', { ...credentials, displayName: String(data.get('displayName')) || 'Mercenario' });
      } else {
        await session.authenticate('login', credentials);
      }
      await enterTown();
    });
  });
}

// ---------- Pueblo ----------
async function enterTown(): Promise<void> {
  socket ??= new GameSocket(session, onServerMessage, (connected) => {
    if (!connected && inMatch) notify('Conexión perdida. Reconectando…');
  });
  const [me, inventory] = await Promise.all([
    session.call<Profile>('GET', '/v1/me'),
    session.call<{ items: Parameters<typeof lookFrom>[1] }>('GET', '/v1/me/inventory'),
  ]);
  profile = me;
  ownedCache = inventory.items;
  look = lookFrom(loadCharacter(me.id), ownedCache);
  await socket.ensureConnected();
  // Al reconectar con una partida activa, el servidor ya pudo enviar su estado.
  if (!inMatch) showTown();
}

interface Hotspot {
  id: string;
  name: string;
  hint: string;
  area: readonly [number, number, number, number];
  plaque: readonly [number, number];
  open(): void;
}

const HOTSPOTS: readonly Hotspot[] = [
  { id: 'tavern', name: 'Taberna', hint: 'Partidas', area: [60, 180, 460, 400], plaque: [262, 150], open: () => { showTavern(); } },
  { id: 'brotherhood', name: 'Hermandad', hint: 'Perfil', area: [515, 10, 320, 270], plaque: [670, 120], open: () => void guarded(() => openBrotherhood(shopActions)) },
  { id: 'arsenal', name: 'Arsenal', hint: 'Personajes', area: [850, 240, 195, 260], plaque: [948, 228], open: () => void guarded(() => openArsenal(shopActions)) },
  { id: 'forge', name: 'Forja', hint: 'Armas', area: [1020, 370, 260, 340], plaque: [1150, 352], open: () => void guarded(() => openShop('Forja', 'Armas y armaduras', ['weapon_skin', 'helmet'], shopActions)) },
  { id: 'cauldron', name: 'Caldero', hint: 'Efectos', area: [40, 520, 260, 195], plaque: [165, 500], open: () => void guarded(() => openShop('Caldero', 'Efectos cosméticos', ['projectile_effect'], shopActions)) },
];

function paintPlayerCard(): void {
  const card = document.getElementById('player-card');
  if (card === null) return;
  card.innerHTML = `${portrait(look.character, look.frame)}
    <div><b>${escapeHtml(profile.displayName)}</b>
    <span class="purse">${icon('coin', 20)} <span id="purse-value">${String(profile.balance)}</span></span></div>`;
}

function showTown(): void {
  stopRoomPoll();
  window.clearTimeout(searchTimeout);
  inMatch = false;
  syncLoop();
  closeModal();
  screen.className = 'town';
  screen.innerHTML = `
    <img class="px backdrop" src="/art/town.png" alt="Pueblo de Ashenfall" />
    <i class="glow g1"></i><i class="glow g2"></i><i class="glow g3"></i>
    ${HOTSPOTS.map((spot) => `
      <button class="hotspot" data-spot="${spot.id}" aria-label="${spot.name}: ${spot.hint}"
        style="left:${String(spot.area[0])}px;top:${String(spot.area[1])}px;width:${String(spot.area[2])}px;height:${String(spot.area[3])}px"></button>
      <button class="plaque" data-spot="${spot.id}" tabindex="-1" style="left:${String(spot.plaque[0])}px;top:${String(spot.plaque[1])}px">
        <b>${spot.name}</b><small>(${spot.hint})</small></button>`).join('')}
    <div class="panel-mini" id="player-card"></div>
    <button class="gear" id="settings" aria-label="Ajustes">${icon('gear', 32)}</button>`;
  paintPlayerCard();
  for (const node of screen.querySelectorAll<HTMLElement>('[data-spot]')) {
    const spot = HOTSPOTS.find((candidate) => candidate.id === node.dataset.spot);
    if (spot === undefined) continue;
    node.addEventListener('click', spot.open);
    node.addEventListener('pointerenter', () => {
      screen.querySelector(`.plaque[data-spot="${spot.id}"]`)?.classList.add('lit');
      screen.querySelector(`.hotspot[data-spot="${spot.id}"]`)?.classList.add('lit');
    });
    node.addEventListener('pointerleave', () => {
      screen.querySelector(`.plaque[data-spot="${spot.id}"]`)?.classList.remove('lit');
      screen.querySelector(`.hotspot[data-spot="${spot.id}"]`)?.classList.remove('lit');
    });
  }
  el('settings').addEventListener('click', () => {
    openModal('Ajustes', escapeHtml(profile.displayName), `<div class="stack"><button id="logout">Cerrar sesión</button></div>`);
    el('logout').addEventListener('click', () => {
      void guarded(async () => {
        socket?.close();
        socket = null;
        await session.logout();
        closeModal();
        showLogin();
      });
    });
  });
}

// ---------- Taberna ----------
function showTavern(): void {
  openModal('Taberna', 'Busca rival o reúne a un amigo', `
    <div class="stack tavern">
      <button class="primary" id="quick">${icon('swords', 24)} Buscar partida</button>
      <button id="create">Crear sala privada</button>
      <form id="join" class="row">
        <input name="code" placeholder="Código de invitación" maxlength="8" required aria-label="Código de invitación" />
        <button>Unirse</button>
      </form>
    </div>`);
  el('quick').addEventListener('click', () => void guarded(searchMatch));
  el('create').addEventListener('click', () => {
    void guarded(async () => {
      showRoom(await session.call<Room>('POST', '/v1/rooms', { visibility: 'private' }));
    });
  });
  el<HTMLFormElement>('join').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget as HTMLFormElement).get('code')).trim().toUpperCase();
    void guarded(async () => {
      showRoom(await session.call<Room>('POST', '/v1/rooms/join-by-code', { inviteCode: code }));
    });
  });
}

function stopRoomPoll(): void {
  window.clearInterval(roomPoll);
  roomPoll = 0;
}

function showRoom(room: Room): void {
  lastRoomId = room.id;
  const inviteCode = room.inviteCode;
  openModal('Sala privada', 'Comparte el código con tu rival', `
    ${inviteCode === undefined ? '' : `<p class="code">${escapeHtml(inviteCode)}</p>`}
    <ul class="members" id="members"></ul>
    <div class="stack"><button class="primary" id="ready">Estoy listo</button><button id="leave">Salir de la sala</button></div>`);
  const paint = (current: Room): void => {
    const members = document.getElementById('members');
    if (members === null) return;
    rivalName = current.members.find((member) => member.userId !== profile.id)?.displayName ?? 'Rival';
    const seats = current.members.map((member) => `<li>${icon(member.ready ? 'check' : 'swords', 20)} <b>${escapeHtml(member.displayName)}</b> <span>${member.ready ? 'Listo' : 'Preparándose'}</span></li>`);
    if (current.members.length < 2) seats.push('<li class="muted">Esperando a un rival…</li>');
    members.innerHTML = seats.join('');
  };
  paint(room);
  stopRoomPoll();
  // El contrato no emite eventos de sala: se consulta con un intervalo moderado.
  roomPoll = window.setInterval(() => {
    void session.call<Room>('GET', `/v1/rooms/${room.id}`).then(paint).catch(() => undefined);
  }, ROOM_POLL_MS);
  el('ready').addEventListener('click', () => {
    void guarded(async () => {
      const button = el<HTMLButtonElement>('ready');
      await session.call('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
      if (button.isConnected) {
        button.disabled = true;
        button.textContent = 'Esperando al rival…';
      }
    });
  });
  el('leave').addEventListener('click', () => {
    void guarded(async () => {
      stopRoomPoll();
      await session.call('POST', `/v1/rooms/${room.id}/leave`);
      rivalName = 'Rival';
      showTavern();
    });
  });
  el('modal-close').addEventListener('click', () => {
    stopRoomPoll();
    void session.call('POST', `/v1/rooms/${room.id}/leave`).catch(() => undefined);
  });
}

/** Si ambos se marcan listos entre dos consultas, el nombre del rival aún no se conocía. */
function resolveRivalName(): void {
  if (rivalName !== 'Rival' || lastRoomId === null) return;
  void session.call<Room>('GET', `/v1/rooms/${lastRoomId}`).then((room) => {
    const name = room.members.find((member) => member.userId !== profile.id)?.displayName;
    if (name === undefined) return;
    rivalName = name;
    arena.setRivalName(name);
    setText('rival-name', name);
  }).catch(() => undefined);
}

async function searchMatch(): Promise<void> {
  lastRoomId = null;
  rivalName = 'Rival';
  const result = await session.call<{ status: string }>('POST', '/v1/matchmaking');
  if (result.status === 'matched') return;
  openModal('Buscando rival…', 'La espera máxima es de un minuto', `<div class="stack"><p class="dots">Preguntando por la taberna</p><button id="cancel">Cancelar</button></div>`);
  const cancel = (): Promise<void> => session.call('DELETE', '/v1/matchmaking');
  searchTimeout = window.setTimeout(() => {
    if (inMatch) return;
    void guarded(async () => {
      await cancel();
      notify('No se encontró rival. Inténtalo de nuevo.');
      showTavern();
    });
  }, 60_000);
  const leave = (): void => {
    window.clearTimeout(searchTimeout);
    void guarded(cancel);
  };
  el('cancel').addEventListener('click', () => {
    leave();
    showTavern();
  });
  el('modal-close').addEventListener('click', leave);
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
      refreshHud();
      break;
    case 'error':
      awaitingAck = false;
      if (message.code === 'STALE_VERSION' && view !== null) socket?.send({ type: 'sync', matchId: view.matchId });
      else if (inMatch) notify(`Jugada rechazada (${message.code}).`);
      refreshHud();
      break;
    case 'welcome':
      break;
  }
}

function beginMatch(next: PlayerMatchView, intro: boolean): void {
  const fresh = intro || !inMatch || view?.matchId !== next.matchId;
  view = next;
  lastSeq = next.seq;
  pendingResult = null;
  awaitingAck = false;
  shownHp = { you: next.you.hp, rival: next.opponent.hp };
  if (fresh) {
    inMatch = true;
    stopRoomPoll();
    window.clearTimeout(searchTimeout);
    closeModal();
    syncLoop();
    arena.weaponId = DEFAULT_WEAPON[look.character];
    showHud(next);
    arena.loadMatch(next, intro, {
      you: look,
      rival: baseLook(rivalCharacter(next.opponent.playerId)),
      youName: profile.displayName,
      rivalName,
    });
    resolveRivalName();
  } else {
    arena.updateView(next);
  }
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
  if (payload.type === 'turn_timed_out') notify(payload.playerId === view.you.playerId ? 'Se agotó tu tiempo: pierdes el turno.' : 'El rival agotó su tiempo.');
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

function showHud(match: PlayerMatchView): void {
  screen.className = 'hud';
  const rival = rivalCharacter(match.opponent.playerId);
  screen.innerHTML = `
    <header class="hud-top">
      <div class="fighter">
        ${portrait(look.character, look.frame)}
        <div><b>${escapeHtml(profile.displayName)}</b>
        <div class="hp"><i id="you-hp"></i><span id="you-hp-text"></span></div></div>
      </div>
      <div class="turn-box">
        <small id="turn"></small><b id="timer">30</b>
        <span id="wind"></span><small id="round"></small>
      </div>
      <div class="fighter right">
        <div><b><span id="rival-name">${escapeHtml(rivalName)}</span><em id="rival-status"></em></b>
        <div class="hp"><i id="rival-hp"></i><span id="rival-hp-text"></span></div></div>
        ${portrait(rival, false)}
      </div>
    </header>
    <div id="intro" hidden>${biomeCard(match.arenaId)}</div>
    <footer class="controls" id="controls">
      <div class="weapons" role="radiogroup" aria-label="Arma">
        ${WEAPON_IDS.map((id, index) => `<button class="weapon" data-weapon="${id}" role="radio" title="${WEAPON_LABEL[id]} (${String(index + 1)})">${icon(id, 40)}<small>${WEAPON_LABEL[id]}</small></button>`).join('')}
      </div>
      <label class="slider"><span>Ángulo: <b id="angle-text"></b></span><input id="angle" type="range" min="0" max="90" /></label>
      <label class="slider"><span>Potencia: <b id="power-text"></b></span><input id="power" type="range" min="10" max="100" /></label>
      <button class="primary fire" id="fire">Disparar</button>
    </footer>`;
  const angle = el<HTMLInputElement>('angle');
  const power = el<HTMLInputElement>('power');
  angle.addEventListener('input', () => {
    arena.angleDeg = Number(angle.value);
    refreshHud();
  });
  power.addEventListener('input', () => {
    arena.power = Number(power.value);
    refreshHud();
  });
  // Tras soltar, las flechas y Espacio deben volver al juego y no al control enfocado.
  for (const input of [angle, power]) input.addEventListener('pointerup', () => { input.blur(); });
  for (const node of screen.querySelectorAll<HTMLElement>('[data-weapon]')) {
    node.addEventListener('click', () => {
      const { weapon } = node.dataset;
      if (weapon !== undefined && isWeaponId(weapon)) selectWeapon(weapon);
      node.blur();
    });
  }
  el('fire').addEventListener('click', shoot);
}

const WEAPON_LABEL: Readonly<Record<WeaponId, string>> = { bow: 'Arco', spear: 'Lanza', axe: 'Hacha', dagger: 'Daga' };

function selectWeapon(id: WeaponId): void {
  arena.setWeapon(id);
  refreshHud();
}

function setText(id: string, text: string): void {
  const node = document.getElementById(id);
  if (node !== null && node.textContent !== text) node.textContent = text;
}

function setBar(id: string, hp: number): void {
  const node = document.getElementById(id);
  if (node !== null) node.style.width = `${String(Math.max(0, hp))}%`;
}

function refreshHud(): void {
  if (view === null) return;
  const mine = view.turn?.playerId === view.you.playerId;
  const canShoot = mine && !arena.busy && !awaitingAck && view.status === 'in_progress';
  arena.canAim = canShoot;
  arena.drawGuide();
  const fire = document.getElementById('fire') as HTMLButtonElement | null;
  if (fire === null) return;
  fire.disabled = !canShoot;
  el('controls').classList.toggle('idle', !canShoot);
  setText('turn', view.status === 'finished' ? 'Fin del duelo' : mine ? 'Tu turno' : 'Turno del rival');
  if (view.status === 'finished') setText('timer', '—');
  const wind = Math.round(view.windAccel);
  setText('wind', `Viento ${wind === 0 ? '—' : wind > 0 ? '→' : '←'} ${String(Math.abs(wind))}`);
  setText('round', `Ronda ${String(view.round)}/${String(view.maxRounds)}`);
  setBar('you-hp', shownHp.you);
  setBar('rival-hp', shownHp.rival);
  setText('you-hp-text', `${String(shownHp.you)} / 100`);
  setText('rival-hp-text', `${String(shownHp.rival)} / 100`);
  setText('rival-status', view.opponent.connected ? '' : ' (desconectado)');
  setText('angle-text', `${String(arena.angleDeg)}°`);
  setText('power-text', `${String(arena.power)}%`);
  const angle = el<HTMLInputElement>('angle');
  const power = el<HTMLInputElement>('power');
  angle.value = String(arena.angleDeg);
  power.value = String(arena.power);
  angle.disabled = !canShoot;
  power.disabled = !canShoot;
  angle.style.setProperty('--fill', `${String((arena.angleDeg / 90) * 100)}%`);
  power.style.setProperty('--fill', `${String(((arena.power - 10) / 90) * 100)}%`);
  for (const node of screen.querySelectorAll<HTMLButtonElement>('[data-weapon]')) {
    node.classList.toggle('on', node.dataset.weapon === arena.weaponId);
    node.setAttribute('aria-checked', String(node.dataset.weapon === arena.weaponId));
  }
}

function shoot(): void {
  const fire = document.getElementById('fire') as HTMLButtonElement | null;
  if (view === null || fire === null || fire.disabled) return;
  awaitingAck = true;
  socket?.send({
    type: 'shoot',
    matchId: view.matchId,
    actionId: crypto.randomUUID(),
    expectedVersion: view.version,
    weaponId: arena.weaponId,
    angleDeg: arena.angleDeg,
    power: arena.power,
  });
  refreshHud();
}

function showResult(): void {
  const result = pendingResult;
  if (result === null || view === null) return;
  pendingResult = null;
  const won = result.winnerId === view.you.playerId;
  const title = result.winnerId === null ? 'Empate' : won ? '¡Victoria!' : 'Derrota';
  el('controls').hidden = true;
  const modal = el('modal');
  modal.hidden = false;
  modal.innerHTML = `
    <section class="panel result ${won ? 'won' : 'lost'}" role="dialog" aria-label="Resultado">
      <h2>${title}</h2>
      <p class="reason">${END_REASON[result.reason] ?? ''}</p>
      <p class="reward">${icon('coin', 40)} <b>+${won ? '100' : '0'}</b></p>
      <p class="muted" id="result-balance">Marcas de Ceniza</p>
      <button class="primary" id="back">Volver al pueblo</button>
    </section>`;
  el('back').addEventListener('click', () => {
    void guarded(async () => {
      inMatch = false;
      view = null;
      rivalName = 'Rival';
      await enterTown();
    });
  });
  // El saldo mostrado es siempre el del servidor, no una suma local.
  void session.call<Profile>('GET', '/v1/me').then((me) => {
    profile = me;
    setText('result-balance', `Tu bolsa: ${String(me.balance)} Marcas de Ceniza`);
  }).catch(() => undefined);
}

arena.setHooks({
  onAnimationsIdle: () => {
    refreshHud();
    if (pendingResult !== null) showResult();
  },
  onAim: refreshHud,
  onImpact: (shot: ShotView) => {
    if (view === null) return;
    if (shot.shooterId === view.you.playerId) shownHp = { ...shownHp, rival: shot.targetHpAfter };
    else shownHp = { ...shownHp, you: shot.targetHpAfter };
    refreshHud();
  },
  onIntro: (active) => {
    introActive = active;
    const node = document.getElementById('intro');
    if (node !== null) node.hidden = !introActive;
  },
});

window.addEventListener('keydown', (event) => {
  if (!inMatch || view === null) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const canAim = arena.canAim;
  const weaponIndex = Number(event.key) - 1;
  const chosen = WEAPON_IDS[weaponIndex];
  if (event.code === 'Space') shoot();
  else if (event.code === 'ArrowUp' && canAim) arena.angleDeg = Math.min(90, arena.angleDeg + ANGLE_STEP);
  else if (event.code === 'ArrowDown' && canAim) arena.angleDeg = Math.max(0, arena.angleDeg - ANGLE_STEP);
  else if (event.code === 'ArrowRight' && canAim) arena.power = Math.min(100, arena.power + POWER_STEP);
  else if (event.code === 'ArrowLeft' && canAim) arena.power = Math.max(10, arena.power - POWER_STEP);
  else if (chosen !== undefined) selectWeapon(chosen);
  else return;
  event.preventDefault();
  refreshHud();
});

window.setInterval(() => {
  if (view?.turn === null || view === null || !inMatch) return;
  const left = Math.max(0, Math.ceil((view.turn.deadlineMs - Date.now()) / 1000));
  setText('timer', String(left));
  document.getElementById('timer')?.classList.toggle('urgent', left <= 5);
}, 250);

showLogin();
