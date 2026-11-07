/** Pantallas del pueblo. Todo precio, saldo, nivel y propiedad viene del servidor; el cliente solo lo presenta. */
import { CHARACTER_FAMILY, CHARACTER_LEVEL, CHARACTER_PRICE, STARTER_CHARACTER, starterWeapon, WEAPONS, type ArenaId, type WeaponId } from '@ashenfall/domain';
import { audio } from './audio.js';
import { CHARACTERS, FAMILY_LABEL, icon, type CharacterId, type FighterId, type IconName } from './art.js';
import { BIOME_NAMES } from './biomes.js';
import type { Session } from './net.js';

export function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Falta #${id}`);
  return found as T;
}

export function escapeHtml(text: string): string {
  const holder = document.createElement('span');
  holder.textContent = text;
  return holder.innerHTML;
}

export interface Profile {
  characterId: CharacterId;
  id: string;
  displayName: string;
  balance: number;
}
export interface Room {
  id: string;
  inviteCode?: string;
  members: { userId: string; displayName: string; ready: boolean }[];
}
export interface Stats {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  level: number;
  xp: number;
  xpInLevel: number;
  xpForNext: number;
}
interface CatalogItem {
  id: string;
  name: string;
  kind: string;
  price: number;
}
interface OwnedItem {
  id: string;
}
interface MatchRow {
  matchId: string;
  outcome: 'win' | 'loss' | 'draw';
  opponent: string;
  reason: string;
  rounds: number;
  endedAt: string;
}

export interface ShopActions {
  session: Session;
  guarded(work: () => Promise<void>): Promise<void>;
  notify(message: string): void;
  profile(): Profile;
  setBalance(balance: number): void;
  /** Cambia el personaje en uso, ya comprado: el servidor lo vuelve a comprobar. */
  setCharacter(id: CharacterId): void;
}

export const portrait = (character: FighterId, ornate: boolean): string =>
  `<span class="portrait${ornate ? ' ornate' : ''}"><img src="/art/portrait-${character}.webp" alt="" /></span>`;

export function openModal(title: string, subtitle: string, body: string, wide = false): void {
  const modal = el('modal');
  modal.hidden = false;
  modal.innerHTML = `
    <section class="panel${wide ? ' wide' : ''}" role="dialog" aria-label="${escapeHtml(title)}">
      <header class="panel-head"><h2>${escapeHtml(title)}</h2><span class="sub">${escapeHtml(subtitle)}</span>
        <button class="close" id="modal-close" aria-label="Cerrar">✕</button></header>
      <div id="modal-body">${body}</div>
    </section>`;
  el('modal-close').addEventListener('click', closeModal);
}

export function closeModal(): void {
  const modal = el('modal');
  modal.hidden = true;
  modal.innerHTML = '';
}

const heroOf = (id: CharacterId) => CHARACTERS.find((hero) => hero.id === id) ?? CHARACTERS[0];

/** Arma fija de cada personaje: no se cambia ni se compra. */
const weaponLine = (id: CharacterId): string => `${icon(CHARACTER_FAMILY[id], 18)} ${FAMILY_LABEL[CHARACTER_FAMILY[id]]} · ${WEAPONS[starterWeapon(id)].name}`;

async function ownedHeroes(actions: ShopActions): Promise<Set<CharacterId>> {
  const { items } = await actions.session.call<{ items: OwnedItem[] }>('GET', '/v1/me/inventory');
  const owned = new Set<CharacterId>([STARTER_CHARACTER]);
  for (const item of items) {
    const hero = CHARACTERS.find((candidate) => `char-${candidate.id}` === item.id);
    if (hero !== undefined) owned.add(hero.id);
  }
  return owned;
}

/** Personajes desbloqueados: aquí se elige con cuál jugar. */
export async function openCharacters(actions: ShopActions): Promise<void> {
  const owned = await ownedHeroes(actions);
  const render = (): void => {
    const body = document.getElementById('modal-body');
    if (body === null) return;
    const mine = CHARACTERS.filter((hero) => owned.has(hero.id));
    const current = actions.profile().characterId;
    body.innerHTML = `
      <div class="cards">${mine.map((hero) => `
        <button class="card${hero.id === current ? ' on' : ''}" data-hero="${hero.id}">
          <img class="card-art" src="/art/body-${hero.id}.webp" alt="" />
          <b>${hero.name}</b><small>${hero.race}</small>
          <span class="family">${weaponLine(hero.id)}</span>
          <em>${hero.id === current ? 'En uso' : 'Usar'}</em>
        </button>`).join('')}</div>
      <p class="muted center">${String(mine.length)} de ${String(CHARACTERS.length)} personajes. El resto se compra en el Arsenal.</p>`;
    for (const node of body.querySelectorAll<HTMLElement>('[data-hero]')) {
      node.addEventListener('click', () => {
        const id = node.dataset.hero as CharacterId;
        void actions.guarded(async () => {
          await actions.session.call('POST', '/v1/me/character', { characterId: id });
          actions.setCharacter(id);
          audio.sfx('open');
          render();
        });
      });
    }
  };
  openModal('Personajes', 'Elige con cuál jugar', '', true);
  render();
}

/** Arsenal: aquí se compran personajes nuevos. Hacen falta el nivel y el dinero a la vez. */
export async function openStore(actions: ShopActions): Promise<void> {
  const [catalog, stats] = await Promise.all([
    actions.session.call<{ items: CatalogItem[] }>('GET', '/v1/shop/catalog'),
    actions.session.call<Stats>('GET', '/v1/me/stats'),
  ]);
  let owned = await ownedHeroes(actions);
  const purchaseIds = new Map<string, string>();
  const price = new Map(catalog.items.map((item) => [item.id, item.price]));
  const render = (): void => {
    const body = document.getElementById('modal-body');
    if (body === null) return;
    const balance = actions.profile().balance;
    const forSale = CHARACTERS.filter((hero) => hero.id !== STARTER_CHARACTER).sort((a, b) => CHARACTER_LEVEL[a.id] - CHARACTER_LEVEL[b.id]);
    body.innerHTML = `
      <div class="cards store">${forSale.map((hero) => {
        const have = owned.has(hero.id);
        const cost = price.get(`char-${hero.id}`) ?? CHARACTER_PRICE[hero.id];
        const needed = CHARACTER_LEVEL[hero.id];
        const levelOk = stats.level >= needed;
        const moneyOk = balance >= cost;
        const state = have ? 'Desbloqueado' : !levelOk ? `Nivel ${String(needed)}` : !moneyOk ? 'Marcas insuficientes' : 'Comprar';
        return `<button class="card${have ? ' owned' : ''}${!have && !levelOk ? ' locked' : ''}" data-buy="${hero.id}" ${have || !levelOk || !moneyOk ? 'disabled' : ''}>
          <img class="card-art" src="/art/body-${hero.id}.webp" alt="" />
          <b>${hero.name}</b><small>${hero.race}</small>
          <span class="family">${weaponLine(hero.id)}</span>
          <span class="req ${levelOk ? 'ok' : 'no'}">Nivel ${String(needed)}</span>
          <span class="cost ${moneyOk || have ? 'ok' : 'no'}">${icon('coin', 14)} ${String(cost)}</span>
          <em>${state}</em>
        </button>`;
      }).join('')}</div>
      <p class="wallet">Tu nivel: <b>${String(stats.level)}</b> · ${icon('coin', 20)} <b>${String(balance)}</b> Marcas de Ceniza</p>`;
    for (const node of body.querySelectorAll<HTMLElement>('[data-buy]')) {
      node.addEventListener('click', () => {
        const id = node.dataset.buy as CharacterId;
        void actions.guarded(async () => {
          // El mismo id hasta confirmar la compra: reintentar tras un fallo de red no cobra dos veces.
          const purchaseId = purchaseIds.get(id) ?? crypto.randomUUID();
          purchaseIds.set(id, purchaseId);
          const result = await actions.session.call<{ balance: number }>('POST', '/v1/shop/purchases', { cosmeticId: `char-${id}`, purchaseId });
          purchaseIds.delete(id);
          actions.setBalance(result.balance);
          owned = await ownedHeroes(actions);
          audio.sfx('buy');
          actions.notify(`${heroOf(id)?.name ?? 'El personaje'} ya es tuyo. Elígelo en Personajes.`);
          render();
        });
      });
    }
  };
  openModal('Arsenal', 'Nuevos personajes', '', true);
  render();
}

/** Perfil: tu personaje, tu nivel y cuántas veces has ganado, perdido y empatado. Nada más. */
export async function openProfile(actions: ShopActions): Promise<void> {
  const stats = await actions.session.call<Stats>('GET', '/v1/me/stats');
  const hero = heroOf(actions.profile().characterId);
  openModal('Perfil', actions.profile().displayName, `
    <div class="profile">
      <div class="profile-hero"><img src="/art/body-${hero?.id ?? STARTER_CHARACTER}.webp" alt="" /><b>${hero?.name ?? ''}</b><small>${hero?.race ?? ''}</small></div>
      <div class="profile-data">
        <p class="level">Nivel <b>${String(stats.level)}</b></p>
        <div class="xp"><i style="width:${String(Math.round((stats.xpInLevel / stats.xpForNext) * 100))}%"></i></div>
        <small class="muted">${String(stats.xpInLevel)} / ${String(stats.xpForNext)} para el siguiente nivel</small>
        <dl>
          <div><dt>Victorias</dt><dd>${String(stats.wins)}</dd></div>
          <div><dt>Derrotas</dt><dd>${String(stats.losses)}</dd></div>
          <div><dt>Empates</dt><dd>${String(stats.draws)}</dd></div>
        </dl>
      </div>
    </div>`);
}

const OUTCOME: Readonly<Record<MatchRow['outcome'], { text: string; mark: IconName }>> = {
  win: { text: 'Victoria', mark: 'trophy' },
  loss: { text: 'Derrota', mark: 'cross' },
  draw: { text: 'Empate', mark: 'swords' },
};

/** Historial: las últimas diez partidas. */
export async function openHistory(actions: ShopActions): Promise<void> {
  const { items } = await actions.session.call<{ items: MatchRow[] }>('GET', '/v1/me/matches?limit=10&offset=0');
  openModal('Historial', 'Tus últimas 10 partidas', `
    ${items.length === 0 ? '<p class="muted center">Todavía no has jugado ninguna partida.</p>' : `
    <ol class="history">${items.map((row) => `
      <li class="${row.outcome}">${icon(OUTCOME[row.outcome].mark, 22)} <b>${OUTCOME[row.outcome].text}</b>
        <span class="vs">contra ${escapeHtml(row.opponent)}</span>
        <span>${String(row.rounds)} ${row.rounds === 1 ? 'ronda' : 'rondas'}</span>
        <time>${new Date(row.endedAt).toLocaleDateString('es')}</time></li>`).join('')}</ol>`}`);
}

interface StoryLevel {
  level: number;
  monsterId: string;
  name: string;
  title: string;
  weaponId: WeaponId;
  reward: number;
  unlocked: boolean;
  cleared: boolean;
}

/** Modo historia: diez monstruos en orden; cada uno desbloquea al siguiente. */
export async function openStory(actions: ShopActions, start: (level: number) => void): Promise<void> {
  const story = await actions.session.call<{ cleared: number; levels: StoryLevel[] }>('GET', '/v1/me/story');
  openModal('Modo historia', `Has vencido a ${String(story.cleared)} de ${String(story.levels.length)}`, `
    <div class="story">${story.levels.map((entry) => `
      <button class="story-card${entry.cleared ? ' cleared' : ''}${entry.unlocked ? '' : ' locked'}" data-level="${String(entry.level)}" ${entry.unlocked ? '' : 'disabled'}>
        <span class="story-num">${String(entry.level)}</span>
        <img src="/art/portrait-${entry.monsterId}.webp" alt="" />
        <b>${escapeHtml(entry.name)}</b>
        <small>${escapeHtml(entry.title)}</small>
        <span class="story-weapon"><img src="/art/icon-${entry.weaponId}.webp" alt="" />${escapeHtml(WEAPONS[entry.weaponId].name)}</span>
        <span class="story-reward">${entry.unlocked ? `${icon('coin', 14)} ${String(entry.reward)}${entry.cleared ? ' · vencido' : ''}` : 'Bloqueado'}</span>
      </button>`).join('')}</div>`, true);
  for (const node of document.querySelectorAll<HTMLElement>('[data-level]')) {
    node.addEventListener('click', () => {
      start(Number(node.dataset.level));
    });
  }
}

export const END_REASON: Readonly<Record<string, string>> = {
  knockout: 'Un mercenario ha caído.',
  round_limit: 'Se agotaron las rondas.',
  timeout_forfeit: 'Dos turnos consecutivos sin disparar.',
  disconnect_forfeit: 'Un jugador no volvió a tiempo.',
  both_abandoned: 'Ambos abandonaron el duelo.',
  admin_terminated: 'Un administrador terminó la partida.',
};

export const biomeCard = (id: ArenaId): string =>
  `<div class="biome-card"><img src="/art/biome-${id}.webp" alt="" /><b>${BIOME_NAMES[id]}</b></div>`;
