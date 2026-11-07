import { powerTier, WEAPONS, type PlayerEventPayload, type PlayerMatchView, type ShotView } from '@ashenfall/domain';
import Phaser from 'phaser';
import { ArenaScene } from './arena.js';
import { audio } from './audio.js';
import { baseLook, bodyFilter, frameUrl, icon, type Look } from './art.js';
import { ApiError, GameSocket, Session, type ServerMessage } from './net.js';
import { biomeCard, closeModal, el, END_REASON, escapeHtml, lookFrom, openBrotherhood, openModal, openRoster, openShop, portrait, type Profile, type Room, type ShopActions } from './screens.js';

const STAGE_W = 1280;
const STAGE_H = 720;
const ROOM_POLL_MS = 2000;

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
// El navegador solo permite sonido tras un gesto: el primero lo desbloquea.
window.addEventListener('pointerdown', () => { audio.unlock(); });
window.addEventListener('keydown', () => { audio.unlock(); });
document.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement | null)?.closest('button');
  if (button === null || button === undefined || button.disabled) return;
  audio.sfx(button.classList.contains('primary') || button.id === 'settings' ? 'open' : 'click');
});
fitStage();

const session = new Session();
let booted = false;
const arena = new ArenaScene(() => {
  booted = true;
  syncLoop();
});
const game = new Phaser.Game({
  // WebGL: tintes del impacto y capas grandes por GPU. Sin él, Phaser cae a Canvas sin tintes.
  type: Phaser.AUTO,
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
let profile: Profile = { id: '', displayName: '', balance: 0, characterId: 'edrik' };
let view: PlayerMatchView | null = null;
let inMatch = false;
let pendingResult: PlayerMatchView['result'] = null;
let lastSeq = 0;
let awaitingAck = false;
let toastTimer = 0;
let introActive = false;
let roomPoll = 0;
let searchTimeout = 0;
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
    look = lookFrom(id, ownedCache);
    paintPlayerCard();
    void guarded(() => session.call('POST', '/v1/me/character', { characterId: id }));
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
    <img class="backdrop" src="/art/castle.webp" alt="" />
    <img class="logo" src="/art/logo.webp" alt="Ashenfall, The Last Mercenary Guild" />
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
  look = lookFrom(me.characterId, ownedCache);
  await socket.ensureConnected();
  // Al reconectar con una partida activa, el servidor ya pudo enviar su estado.
  if (!inMatch) showTown();
}

interface Hotspot {
  id: string;
  label: string;
  /** x, y, ancho y alto sobre la imagen del pueblo a 1280×720. */
  area: readonly [number, number, number, number];
  open(): void;
}

const shop = (title: string, subtitle: string, kinds: readonly string[]) => (): void => void guarded(() => openShop(title, subtitle, kinds, shopActions));

// Los rótulos y botones forman parte de la imagen; aquí se les da su función.
const HOTSPOTS: readonly Hotspot[] = [
  { id: 'arsenal', label: 'Arsenal: yelmos y capas', area: [342, 258, 192, 224], open: shop('Arsenal', 'Yelmos y capas', ['helmet', 'cloak']) },
  { id: 'alchemist', label: 'Alquimista: efectos', area: [770, 276, 172, 214], open: shop('Alquimista', 'Efectos cosméticos', ['projectile_effect']) },
  { id: 'profile', label: 'Perfil', area: [28, 498, 76, 84], open: () => void guarded(() => openBrotherhood(shopActions, 'Perfil', false)) },
  { id: 'history', label: 'Historial', area: [28, 584, 76, 84], open: () => void guarded(() => openBrotherhood(shopActions, 'Historial', false)) },
];

/** La barra inferior es una pieza de la interfaz, no del fondo, para poder arrastrarla. */
const DOCK_SIZE = { width: 380, height: 104 } as const;
const DOCK_HOME = { x: 450, y: 590 } as const;
interface DockItem {
  id: string;
  label: string;
  icon: string;
  primary?: boolean;
  open(): void;
}
const DOCK_ITEMS: readonly DockItem[] = [
  { id: 'characters', label: 'Personajes', icon: 'helm', open: () => void guarded(() => openRoster(shopActions)) },
  { id: 'play', label: 'Jugar', icon: 'swords', primary: true, open: () => { showPlay(); } },
];
let dockPos: { x: number; y: number } = loadDock();

function clampDock(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.round(Math.min(Math.max(point.x, 0), STAGE_W - DOCK_SIZE.width)),
    y: Math.round(Math.min(Math.max(point.y, 0), STAGE_H - DOCK_SIZE.height)),
  };
}

function loadDock(): { x: number; y: number } {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem('ashenfall.dock') ?? 'null') as { x?: unknown; y?: unknown } | null;
    if (saved !== null && typeof saved.x === 'number' && typeof saved.y === 'number') return clampDock({ x: saved.x, y: saved.y });
  } catch {
    // sin almacenamiento disponible: se usa la posición original
  }
  return { ...DOCK_HOME };
}

function saveDock(): void {
  try {
    window.sessionStorage.setItem('ashenfall.dock', JSON.stringify(dockPos));
  } catch {
    // no es imprescindible recordar la posición
  }
}

/** Arrastrar mueve la barra; un clic sin desplazamiento sigue activando sus botones. */
function enableDockDrag(dock: HTMLElement): void {
  let drag: { px: number; py: number; x: number; y: number; moved: boolean } | null = null;
  let suppressClick = false;
  dock.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { px: event.clientX, py: event.clientY, x: dockPos.x, y: dockPos.y, moved: false };
  });
  dock.addEventListener('pointermove', (event) => {
    if (drag === null) return;
    const scale = ui.getBoundingClientRect().width / STAGE_W || 1;
    const dx = (event.clientX - drag.px) / scale;
    const dy = (event.clientY - drag.py) / scale;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      dock.setPointerCapture(event.pointerId);
      dock.classList.add('dragging');
    }
    dockPos = clampDock({ x: drag.x + dx, y: drag.y + dy });
    dock.style.left = `${String(dockPos.x)}px`;
    dock.style.top = `${String(dockPos.y)}px`;
  });
  const end = (): void => {
    if (drag?.moved === true) {
      // El clic que sigue a un arrastre se descarta; si no llega ninguno, la marca caduca sola.
      suppressClick = true;
      window.setTimeout(() => {
        suppressClick = false;
      }, 0);
      saveDock();
    }
    drag = null;
    dock.classList.remove('dragging');
  };
  dock.addEventListener('pointerup', end);
  dock.addEventListener('pointercancel', end);
  dock.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
}

function paintPlayerCard(): void {
  const card = document.getElementById('player-card');
  if (card === null) return;
  card.innerHTML = `
    <img class="medal-face${look.frame ? ' ornate' : ''}" src="/art/portrait-${look.character}.webp" alt="" />
    <b class="town-name">${escapeHtml(profile.displayName)}</b>`;
  const coins = document.getElementById('purse-value');
  if (coins !== null) coins.textContent = String(profile.balance);
  const hero = document.getElementById('town-hero') as HTMLImageElement | null;
  if (hero !== null) {
    hero.src = `/art/body-${look.character}.webp`;
    hero.style.setProperty('filter', bodyFilter(look));
  }
}

/** El servidor no tiene niveles: es un distintivo visual a partir de las partidas jugadas. */
async function paintLevel(): Promise<void> {
  const { total } = await session.call<{ total: number }>('GET', '/v1/me/matches?limit=1&offset=0');
  const level = document.getElementById('town-level');
  if (level === null) return;
  level.innerHTML = `Lv. ${String(1 + Math.floor(total / 5))} <i class="xp"><u style="width:${String(((total % 5) + 0.15) * 20)}%"></u></i>`;
}

function showTown(): void {
  stopRoomPoll();
  window.clearTimeout(searchTimeout);
  inMatch = false;
  syncLoop();
  closeModal();
  audio.setScene('town');
  screen.className = 'town';
  const lanterns = [[126, 262, 60], [250, 306, 70], [430, 440, 110], [830, 432, 80], [1096, 440, 90], [790, 182, 90]] as const;
  screen.innerHTML = `
    <img class="backdrop" src="/art/town.webp" alt="Pueblo de Ashenfall" />
    <i class="moon-glow"></i>
    ${lanterns.map(([x, y, size], index) => `<i class="glow" style="left:${String(x - size)}px;top:${String(y - size)}px;width:${String(size * 2)}px;height:${String(size * 2)}px;animation-delay:-${String(index * 0.7)}s"></i>`).join('')}
    ${Array.from({ length: 14 }, (_, index) => `<i class="ember" style="left:${String(60 + ((index * 97) % 1160))}px;top:${String(360 + ((index * 53) % 240))}px;animation-delay:-${String(index * 1.3)}s"></i>`).join('')}
    <img class="town-hero" id="town-hero" alt="" />
    ${HOTSPOTS.map((spot) => `<button class="hotspot" data-spot="${spot.id}" title="${spot.label}" aria-label="${spot.label}"
        style="left:${String(spot.area[0])}px;top:${String(spot.area[1])}px;width:${String(spot.area[2])}px;height:${String(spot.area[3])}px"></button>`).join('')}
    <nav class="dock" id="dock" style="left:${String(dockPos.x)}px;top:${String(dockPos.y)}px;width:${String(DOCK_SIZE.width)}px;height:${String(DOCK_SIZE.height)}px" title="Arrastra la barra para moverla">
      <i class="dock-grip" aria-hidden="true"></i>
      ${DOCK_ITEMS.map((item) => `<button class="dock-btn${item.primary === true ? ' primary' : ''}" data-dock="${item.id}" aria-label="${item.label}">
        <img src="/art/icon-${item.icon}.webp" alt="" draggable="false" /><span>${item.label}</span></button>`).join('')}
    </nav>
    <div id="player-card"></div>
    <div id="town-level"></div>
    <b class="purse" id="purse-value"></b>
    <button class="hotspot" id="settings" aria-label="Ajustes" title="Ajustes" style="left:1160px;top:22px;width:46px;height:44px"></button>
`;
  for (const node of screen.querySelectorAll<HTMLElement>('[data-dock]')) {
    const item = DOCK_ITEMS.find((candidate) => candidate.id === node.dataset.dock);
    if (item !== undefined) node.addEventListener('click', item.open);
  }
  enableDockDrag(el('dock'));
  paintPlayerCard();
  void paintLevel().catch(() => undefined);
  for (const node of screen.querySelectorAll<HTMLElement>('[data-spot]')) {
    const spot = HOTSPOTS.find((candidate) => candidate.id === node.dataset.spot);
    if (spot !== undefined) node.addEventListener('click', spot.open);
  }
  const logout = (): void => {
    void guarded(async () => {
      socket?.close();
      socket = null;
      await session.logout();
      closeModal();
      showLogin();
    });
  };
  el('settings').addEventListener('click', () => {
    openModal('Ajustes', profile.displayName, `<div class="stack">
      <label class="slider">Música <input type="range" id="vol-music" min="0" max="100" value="${String(Math.round(audio.music * 100))}" /></label>
      <label class="slider">Efectos <input type="range" id="vol-sfx" min="0" max="100" value="${String(Math.round(audio.sfxVolume * 100))}" /></label>
      <button id="logout">Cerrar sesión</button></div>`);
    el<HTMLInputElement>('vol-music').addEventListener('input', (event) => {
      audio.setVolumes({ music: Number((event.currentTarget as HTMLInputElement).value) / 100 });
    });
    el<HTMLInputElement>('vol-sfx').addEventListener('change', (event) => {
      audio.setVolumes({ sfx: Number((event.currentTarget as HTMLInputElement).value) / 100 });
      audio.sfx('coin');
    });
    el('logout').addEventListener('click', logout);
  });
}

// ---------- Jugar ----------
function showPlay(): void {
  openModal('Jugar', 'Busca rival o reúne a un amigo', `
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
  const inviteCode = room.inviteCode;
  openModal('Sala privada', 'Comparte el código con tu rival', `
    ${inviteCode === undefined ? '' : `<p class="code">${escapeHtml(inviteCode)}</p>`}
    <ul class="members" id="members"></ul>
    <div class="stack"><button class="primary" id="ready">Estoy listo</button><button id="leave">Salir de la sala</button></div>`);
  const paint = (current: Room): void => {
    const members = document.getElementById('members');
    if (members === null) return;
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
      showPlay();
    });
  });
  el('modal-close').addEventListener('click', () => {
    stopRoomPoll();
    void session.call('POST', `/v1/rooms/${room.id}/leave`).catch(() => undefined);
  });
}

async function searchMatch(): Promise<void> {
  const result = await session.call<{ status: string }>('POST', '/v1/matchmaking');
  if (result.status === 'matched') return;
  openModal('Buscando rival…', 'La espera máxima es de un minuto', `<div class="stack"><p class="dots">Preguntando por la taberna</p><button id="cancel">Cancelar</button></div>`);
  const cancel = (): Promise<void> => session.call('DELETE', '/v1/matchmaking');
  searchTimeout = window.setTimeout(() => {
    if (inMatch) return;
    void guarded(async () => {
      await cancel();
      notify('No se encontró rival. Inténtalo de nuevo.');
      showPlay();
    });
  }, 60_000);
  const leave = (): void => {
    window.clearTimeout(searchTimeout);
    void guarded(cancel);
  };
  el('cancel').addEventListener('click', () => {
    leave();
    showPlay();
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
    audio.setScene('battle');
    audio.sfx('match_start');
    inMatch = true;
    stopRoomPoll();
    window.clearTimeout(searchTimeout);
    closeModal();
    syncLoop();
    arena.weaponId = next.you.weaponId;
    showHud(next);
    arena.loadMatch(next, intro, {
      you: { ...look, character: next.you.characterId },
      rival: baseLook(next.opponent.characterId),
      youName: next.you.displayName,
      rivalName: next.opponent.displayName,
    });
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
      return { ...base, version: current.version + 1, [target]: { ...current[target], hp: payload.targetHpAfter, position: payload.targetPosition } };
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
  const rival = match.opponent.characterId;
  screen.innerHTML = `
    <header class="hud-top">
      <div class="fighter">
        ${portrait(match.you.characterId, look.frame)}
        <div><b>${escapeHtml(match.you.displayName)}</b>
        <div class="hp"><i id="you-hp"></i><span id="you-hp-text"></span></div></div>
      </div>
      <div class="turn-box">
        <small id="turn"></small><b id="timer">30</b>
        <span id="wind"></span><small id="round"></small>
      </div>
      <div class="fighter right">
        <div><b><span id="rival-name">${escapeHtml(match.opponent.displayName)}</span><em id="rival-status"></em></b>
        <div class="hp"><i id="rival-hp"></i><span id="rival-hp-text"></span></div></div>
        ${portrait(rival, false)}
      </div>
    </header>
    <div id="intro" hidden>${biomeCard(match.arenaId)}</div>
    <footer class="controls" id="controls">
      <div class="own-weapon"><img class="wpn" src="/art/icon-${WEAPONS[match.you.weaponId].family}.webp" alt="" /><small>${escapeHtml(WEAPONS[match.you.weaponId].name)}</small></div>
      <div class="readout"><span>Ángulo</span><b id="angle-text"></b></div>
      <div class="charge"><span>Potencia: <b id="power-text"></b> <em id="tier"></em></span><i class="meter"><u id="power-bar"></u></i></div>
      <p class="hint" id="hint"></p>
    </footer>`;
}

const TIER_LABEL = { weak: 'Débil', medium: 'Media', strong: 'Fuerte' } as const;

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
  if (document.getElementById('controls') === null) return;
  el('controls').classList.toggle('idle', !canShoot);
  setText('hint', canShoot ? 'Mantén pulsado y arrastra hacia atrás: la distancia es la potencia y subir o bajar el cursor, el ángulo · suelta para disparar · Esc cancela' : 'Esperando…');
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
  setText('tier', TIER_LABEL[powerTier(arena.power)]);
  const bar = document.getElementById('power-bar');
  if (bar !== null) bar.style.width = `${String(((arena.power - 10) / 90) * 100)}%`;
}

function shoot(): void {
  if (view === null || !arena.canAim) return;
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
  audio.setScene('off');
  if (result.winnerId !== null) audio.sfx(won ? 'victory' : 'defeat');
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
  onRelease: shoot,
  onImpact: (shot: ShotView) => {
    if (view === null) return;
    if (shot.impactKind === 'player') {
      const side = shot.shooterId === view.you.playerId ? '.fighter.right' : '.fighter:not(.right)';
      const node = document.querySelector(side);
      node?.classList.remove('struck');
      void (node as HTMLElement | null)?.offsetWidth;
      node?.classList.add('struck');
    }
    const side = shot.shooterId === view.you.playerId ? 'rival' : 'you';
    const { effect } = shot;
    // El servidor ya descontó el veneno o el fuego: la barra baja primero el golpe y luego un tramo por segundo.
    const afterHit = Math.min(shownHp[side], shot.targetHpAfter + (effect === null ? 0 : effect.perSecond * effect.seconds));
    shownHp = { ...shownHp, [side]: afterHit };
    if (effect !== null) {
      const matchId = view.matchId;
      for (let tick = 1; tick <= effect.seconds; tick += 1) {
        window.setTimeout(() => {
          if (view?.matchId !== matchId) return;
          shownHp = { ...shownHp, [side]: Math.max(shot.targetHpAfter, afterHit - tick * effect.perSecond) };
          refreshHud();
        }, tick * 1000);
      }
    }
    refreshHud();
  },
  onIntro: (active) => {
    introActive = active;
    const node = document.getElementById('intro');
    if (node !== null) node.hidden = !introActive;
  },
});

window.setInterval(() => {
  if (view?.turn === null || view === null || !inMatch) return;
  const left = Math.max(0, Math.ceil((view.turn.deadlineMs - Date.now()) / 1000));
  setText('timer', String(left));
  document.getElementById('timer')?.classList.toggle('urgent', left <= 5);
}, 250);

showLogin();
