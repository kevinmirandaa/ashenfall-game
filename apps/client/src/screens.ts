/** Pueblo y paneles. Todo precio, saldo y propiedad viene del servidor; el cliente solo los presenta. */
import { audio } from './audio.js';
import { CHARACTER_FAMILY, CHARACTER_PRICE, STARTER_CHARACTER, WEAPONS, type ArenaId, type WeaponId } from '@ashenfall/domain';
import { baseLook, bodyFilter, CHARACTERS, FAMILY_LABEL, icon, iconUrl, type CharacterId, type IconName, type Look } from './art.js';
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
interface CatalogItem {
  id: string;
  name: string;
  kind: string;
  price: number;
}
interface OwnedItem {
  id: string;
  name: string;
  kind: string;
  equipped: boolean;
}
interface MatchRow {
  matchId: string;
  outcome: 'win' | 'loss' | 'draw';
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
  character(): CharacterId;
  setCharacter(id: CharacterId): void;
  /** Vuelve a leer lo equipado y actualiza pueblo y partida. */
  refreshLook(items: readonly OwnedItem[]): void;
}

const KIND_ICON: Readonly<Record<string, IconName>> = {
  portrait_frame: 'star',
  emblem: 'emblem',
  cloak: 'cloak',
  projectile_effect: 'potion',
  helmet: 'helm',
};
const KIND_NAME: Readonly<Record<string, string>> = {
  portrait_frame: 'Marcos',
  emblem: 'Emblemas',
  cloak: 'Capas',
  helmet: 'Yelmos',
  projectile_effect: 'Efectos',
};

const iconFor = (item: { id: string; kind: string }): IconName => KIND_ICON[item.kind] ?? 'pouch';

export function lookFrom(character: CharacterId, items: readonly OwnedItem[]): Look {
  const on = new Set(items.filter((item) => item.equipped).map((item) => item.id));
  return {
    ...baseLook(character),
    cloak: on.has('cloak-frost'),
    helm: on.has('helm-watch'),
    embers: on.has('trail-embers'),
    frame: on.has('frame-ash'),
    emblem: on.has('emblem-brotherhood'),
  };
}

export const portrait = (character: CharacterId, ornate: boolean): string =>
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

/** Tienda genérica: una pestaña por tipo de artículo, vista previa y compra idempotente. */
export async function openShop(title: string, subtitle: string, kinds: readonly string[], actions: ShopActions, extra?: () => string, wire?: (rerender: () => void) => void): Promise<void> {
  const [catalog, inventory] = await Promise.all([
    actions.session.call<{ items: CatalogItem[] }>('GET', '/v1/shop/catalog'),
    actions.session.call<{ items: OwnedItem[] }>('GET', '/v1/me/inventory'),
  ]);
  let owned = inventory.items;
  const items = catalog.items.filter((item) => kinds.includes(item.kind));
  let tab = kinds[0] ?? '';
  let selected = items.find((item) => item.kind === tab)?.id ?? '';
  // Se conserva por artículo: reintentar tras un fallo de red no cobra dos veces.
  const purchaseIds = new Map<string, string>();

  const previewLook = (item: CatalogItem | undefined): Look => {
    const trial = owned.map((entry) => (item !== undefined && entry.kind === item.kind ? { ...entry, equipped: entry.id === item.id } : entry));
    const withItem = item !== undefined && !owned.some((entry) => entry.id === item.id) ? [...trial, { id: item.id, name: item.name, kind: item.kind, equipped: true }] : trial;
    // Una apariencia de Edrik solo tiene sentido verla sobre Edrik.
    return lookFrom(actions.character(), withItem);
  };
  const previewOf = (item: CatalogItem | undefined): string => {
    if (item === undefined) return '';
    if (item.kind === 'cloak') {
      const look = previewLook(item);
      return `<img class="hero" src="/art/body-${look.character}.webp" style="filter:${bodyFilter(look)}" alt="" />`;
    }
    return `<img class="hero-item" src="${iconUrl(iconFor(item))}" alt="" />`;
  };

  const render = (): void => {
    const body = document.getElementById('modal-body');
    if (body === null) return;
    const shown = items.filter((item) => item.kind === tab);
    const current = shown.find((item) => item.id === selected) ?? shown[0];
    const entry = owned.find((item) => item.id === current?.id);
    const balance = actions.profile().balance;
    const button = current === undefined
      ? ''
      : entry === undefined
        ? `<button class="primary" id="buy" ${balance < current.price ? 'disabled' : ''}>${balance < current.price ? 'Marcas insuficientes' : 'Comprar'}</button>`
        : `<button class="primary" id="equip">${entry.equipped ? 'Quitar' : 'Equipar'}</button>`;
    body.innerHTML = `
      ${extra?.() ?? ''}
      ${kinds.length > 1 ? `<nav class="tabs">${kinds.map((kind) => `<button data-tab="${kind}" class="${kind === tab ? 'on' : ''}">${KIND_NAME[kind] ?? kind}</button>`).join('')}</nav>` : ''}
      <div class="shop">
        <aside class="preview">
          ${previewOf(current)}
          <b>${current === undefined ? '—' : escapeHtml(current.name)}</b>
          ${current === undefined ? '' : `<span class="price">${icon('coin', 20)} ${String(current.price)}</span>`}
          ${button}
          <small class="fair">Solo apariencia: no cambia daño, vida ni física.</small>
        </aside>
        <div class="grid">
          ${shown.map((item) => {
            const mine = owned.find((candidate) => candidate.id === item.id);
            return `<button class="slot${item.id === current?.id ? ' on' : ''}" data-item="${item.id}" title="${escapeHtml(item.name)}">
              ${icon(iconFor(item), 40)}
              <span class="slot-name">${escapeHtml(item.name)}</span>
              <span class="slot-state">${mine === undefined ? `${icon('coin', 14)} ${String(item.price)}` : mine.equipped ? `${icon('check', 14)} Equipado` : 'Adquirido'}</span>
            </button>`;
          }).join('') || '<p class="muted">No hay artículos.</p>'}
        </div>
      </div>
      <p class="wallet">${icon('coin', 20)} <b>${String(balance)}</b> Marcas de Ceniza</p>`;
    for (const node of body.querySelectorAll<HTMLElement>('[data-tab]')) {
      node.addEventListener('click', () => {
        tab = node.dataset.tab ?? tab;
        selected = items.find((item) => item.kind === tab)?.id ?? '';
        render();
      });
    }
    for (const node of body.querySelectorAll<HTMLElement>('[data-item]')) {
      node.addEventListener('click', () => {
        selected = node.dataset.item ?? selected;
        render();
      });
    }
    wire?.(render);
    document.getElementById('buy')?.addEventListener('click', () => {
      if (current === undefined) return;
      void actions.guarded(async () => {
        const purchaseId = purchaseIds.get(current.id) ?? crypto.randomUUID();
        purchaseIds.set(current.id, purchaseId);
        const result = await actions.session.call<{ balance: number }>('POST', '/v1/shop/purchases', { cosmeticId: current.id, purchaseId });
        actions.setBalance(result.balance);
        owned = (await actions.session.call<{ items: OwnedItem[] }>('GET', '/v1/me/inventory')).items;
        actions.refreshLook(owned);
        audio.sfx('buy');
        actions.notify(`Has comprado ${current.name}.`);
        render();
      });
    });
    document.getElementById('equip')?.addEventListener('click', () => {
      if (current === undefined || entry === undefined) return;
      void actions.guarded(async () => {
        await actions.session.call('POST', `/v1/me/inventory/${current.id}/equip`, { equipped: !entry.equipped });
        owned = (await actions.session.call<{ items: OwnedItem[] }>('GET', '/v1/me/inventory')).items;
        actions.refreshLook(owned);
        render();
      });
    });
  };
  openModal(title, subtitle, '', true);
  render();
}

const WEIGHT_LABEL = { 1: 'Ligera', 2: 'Media', 3: 'Pesada' } as const;

/** Texto del efecto de un arma: veneno o fuego, por segundo y durante unos segundos. */
export function effectText(weaponId: WeaponId): string {
  const { effect } = WEAPONS[weaponId];
  if (effect === undefined) return 'Sin efecto';
  return `${effect.kind === 'poison' ? 'Veneno' : 'Fuego'}: -${String(effect.perSecond)} por segundo durante ${String(effect.seconds)} s`;
}

/** Personajes y armas: se empieza con uno; los demás y las armas mejores se compran, y cada personaje solo mejora armas de su familia. */
export async function openRoster(actions: ShopActions): Promise<void> {
  const [catalog, inventory] = await Promise.all([
    actions.session.call<{ items: CatalogItem[] }>('GET', '/v1/shop/catalog'),
    actions.session.call<{ items: OwnedItem[] }>('GET', '/v1/me/inventory'),
  ]);
  let owned = inventory.items;
  const prices = new Map(catalog.items.map((item) => [item.id, item.price]));
  const purchaseIds = new Map<string, string>();
  let selected: CharacterId = actions.character();

  const hasHero = (id: CharacterId): boolean => id === STARTER_CHARACTER || owned.some((item) => item.id === `char-${id}`);
  const equippedOf = (family: string): string | undefined => owned.find((item) => item.kind === `weapon_${family}` && item.equipped)?.id;

  const buy = (itemId: string, then: () => Promise<void>): void => {
    void actions.guarded(async () => {
      const purchaseId = purchaseIds.get(itemId) ?? crypto.randomUUID();
      purchaseIds.set(itemId, purchaseId);
      const result = await actions.session.call<{ balance: number }>('POST', '/v1/shop/purchases', { cosmeticId: itemId, purchaseId });
      actions.setBalance(result.balance);
      owned = (await actions.session.call<{ items: OwnedItem[] }>('GET', '/v1/me/inventory')).items;
      actions.refreshLook(owned);
      audio.sfx('buy');
      await then();
      render();
    });
  };

  const render = (): void => {
    const body = document.getElementById('modal-body');
    if (body === null) return;
    const hero = CHARACTERS.find((candidate) => candidate.id === selected) ?? CHARACTERS[0];
    if (hero === undefined) return;
    const family = CHARACTER_FAMILY[hero.id];
    const balance = actions.profile().balance;
    const active = actions.character() === hero.id;
    const price = CHARACTER_PRICE[hero.id];
    const heroButton = hasHero(hero.id)
      ? `<button class="primary" id="pick" ${active ? 'disabled' : ''}>${active ? 'En uso' : 'Elegir'}</button>`
      : `<button class="primary" id="buy-hero" ${balance < price ? 'disabled' : ''}>${balance < price ? 'Marcas insuficientes' : 'Comprar'}</button>`;
    const equipped = equippedOf(family);
    const tiers: { id: WeaponId; item?: string }[] = [
      { id: family },
      { id: `${family}_2` as WeaponId, item: `wpn-${family}-2` },
      { id: `${family}_3` as WeaponId, item: `wpn-${family}-3` },
    ];
    body.innerHTML = `
      <div class="roster-strip">${CHARACTERS.map((candidate) => `
        <button class="face${candidate.id === hero.id ? ' on' : ''}${hasHero(candidate.id) ? '' : ' locked'}" data-hero="${candidate.id}" title="${escapeHtml(candidate.name)}">
          <img src="/art/portrait-${candidate.id}.webp" alt="" />
          <span>${hasHero(candidate.id) ? (actions.character() === candidate.id ? 'En uso' : candidate.name) : `${icon('coin', 12)} ${String(CHARACTER_PRICE[candidate.id])}`}</span>
        </button>`).join('')}</div>
      <div class="roster-main">
        <aside class="hero-panel">
          <img class="hero-big" src="/art/body-${hero.id}.webp" alt="" />
          <b>${hero.name}</b><small>${hero.race}</small>
          <em>${hero.lore}</em>
          <span class="family">${icon(family, 20)} ${FAMILY_LABEL[family]}</span>
          ${hasHero(hero.id) ? '' : `<span class="price">${icon('coin', 18)} ${String(price)}</span>`}
          ${heroButton}
        </aside>
        <section class="weapon-list">
          <h3>Armas de ${hero.name}</h3>
          <p class="muted">Solo puede usar ${FAMILY_LABEL[family].toLowerCase()}: mejora el arma, no cambia el tipo.</p>
          ${tiers.map(({ id, item }) => {
            const weapon = WEAPONS[id];
            const mine = item === undefined || owned.some((entry) => entry.id === item);
            const on = item === undefined ? equipped === undefined : equipped === item;
            const cost = item === undefined ? 0 : (prices.get(item) ?? weapon.price);
            const action = !mine
              ? `<button data-buy="${item ?? ''}" ${balance < cost ? 'disabled' : ''}>${icon('coin', 14)} ${String(cost)}</button>`
              : `<button data-equip="${item ?? ''}" ${on ? 'disabled' : ''}>${on ? 'Equipada' : 'Equipar'}</button>`;
            return `<div class="weapon-row${on ? ' on' : ''}">
              <img src="/art/icon-${family}.webp" style="${weapon.tier === 0 ? '' : weapon.tier === 1 ? 'filter:brightness(1.25)' : 'filter:drop-shadow(0 0 4px ' + (weapon.effect?.kind === 'poison' ? '#7ed957' : '#f2963c') + ')'}" alt="" />
              <div><b>${escapeHtml(weapon.name)}</b>
                <small>Daño ${String(weapon.baseDamage)} · Peso ${WEIGHT_LABEL[weapon.weight]}</small>
                <small class="${weapon.effect === undefined ? 'muted' : weapon.effect.kind}">${effectText(id)}</small></div>
              ${action}
            </div>`;
          }).join('')}
          <small class="fair">Más peso pide más potencia y más ángulo; menos peso, al revés.</small>
        </section>
      </div>
      <p class="wallet">${icon('coin', 20)} <b>${String(balance)}</b> Marcas de Ceniza</p>`;
    for (const node of body.querySelectorAll<HTMLElement>('[data-hero]')) {
      node.addEventListener('click', () => {
        selected = node.dataset.hero as CharacterId;
        render();
      });
    }
    document.getElementById('pick')?.addEventListener('click', () => {
      actions.setCharacter(hero.id);
      render();
    });
    document.getElementById('buy-hero')?.addEventListener('click', () => {
      buy(`char-${hero.id}`, async () => {
        await actions.session.call('POST', '/v1/me/character', { characterId: hero.id });
        actions.setCharacter(hero.id);
      });
    });
    for (const node of body.querySelectorAll<HTMLElement>('[data-buy]')) {
      node.addEventListener('click', () => {
        const itemId = node.dataset.buy ?? '';
        buy(itemId, async () => {
          await actions.session.call('POST', `/v1/me/inventory/${itemId}/equip`, { equipped: true });
          owned = (await actions.session.call<{ items: OwnedItem[] }>('GET', '/v1/me/inventory')).items;
        });
      });
    }
    for (const node of body.querySelectorAll<HTMLElement>('[data-equip]')) {
      node.addEventListener('click', () => {
        const itemId = node.dataset.equip ?? '';
        void actions.guarded(async () => {
          // El arma común es la que se usa cuando no hay otra equipada de la familia.
          const current = equippedOf(family);
          if (itemId === '') {
            if (current !== undefined) await actions.session.call('POST', `/v1/me/inventory/${current}/equip`, { equipped: false });
          } else {
            await actions.session.call('POST', `/v1/me/inventory/${itemId}/equip`, { equipped: true });
          }
          owned = (await actions.session.call<{ items: OwnedItem[] }>('GET', '/v1/me/inventory')).items;
          actions.refreshLook(owned);
          render();
        });
      });
    }
  };
  openModal('Personajes', 'Tu mercenario y su arma', '', true);
  render();
}

const OUTCOME: Readonly<Record<MatchRow['outcome'], { text: string; mark: IconName }>> = {
  win: { text: 'Victoria', mark: 'trophy' },
  loss: { text: 'Derrota', mark: 'cross' },
  draw: { text: 'Empate', mark: 'swords' },
};

const PAGE = 6;

/** Gremio con tienda; Perfil e Historial muestran solo la hoja de servicios. */
export async function openBrotherhood(actions: ShopActions, title = 'Gremio', shop = true): Promise<void> {
  const profile = actions.profile();
  // Hasta 50 partidas recientes: el límite del contrato. Las cifras lo indican.
  const recent = await actions.session.call<{ total: number; items: MatchRow[] }>('GET', '/v1/me/matches?limit=50&offset=0');
  const wins = recent.items.filter((row) => row.outcome === 'win').length;
  const losses = recent.items.filter((row) => row.outcome === 'loss').length;
  const rate = recent.items.length === 0 ? 0 : Math.round((wins / recent.items.length) * 100);
  let offset = 0;
  const extra = (): string => {
    const rows = recent.items.slice(offset, offset + PAGE);
    return `
    <div class="ledger">
      <div class="stats">
        ${portrait(actions.character(), false)}
        <div><b class="who">${escapeHtml(profile.displayName)}</b>
          <dl>
            <div><dt>Jugadas</dt><dd>${String(recent.total)}</dd></div>
            <div><dt>Victorias</dt><dd>${String(wins)}</dd></div>
            <div><dt>Derrotas</dt><dd>${String(losses)}</dd></div>
            <div><dt>% Victorias</dt><dd>${String(rate)}%</dd></div>
          </dl>
          ${recent.total > recent.items.length ? '<small class="muted">Victorias y derrotas de tus últimas 50 partidas.</small>' : ''}
        </div>
      </div>
      <ol class="history">
        ${rows.map((row) => `<li>${icon(OUTCOME[row.outcome].mark, 20)} <b>${OUTCOME[row.outcome].text}</b> <span>${String(row.rounds)} rondas</span> <time>${new Date(row.endedAt).toLocaleDateString('es')}</time></li>`).join('') || '<li class="muted">Aún no has disputado duelos.</li>'}
      </ol>
      ${recent.items.length > PAGE ? `<div class="pager"><button id="prev" ${offset === 0 ? 'disabled' : ''}>‹</button><button id="next" ${offset + PAGE >= recent.items.length ? 'disabled' : ''}>›</button></div>` : ''}
    </div>`;
  };
  const wirePager = (rerender: () => void): void => {
    document.getElementById('prev')?.addEventListener('click', () => {
      offset = Math.max(0, offset - PAGE);
      rerender();
    });
    document.getElementById('next')?.addEventListener('click', () => {
      offset += PAGE;
      rerender();
    });
  };
  if (shop) {
    await openShop(title, 'Hoja de servicios y distintivos', ['portrait_frame', 'emblem'], actions, extra, wirePager);
    return;
  }
  const paint = (): void => {
    const body = document.getElementById('modal-body');
    if (body === null) return;
    body.innerHTML = extra();
    wirePager(paint);
  };
  openModal(title, 'Tu hoja de servicios', '', true);
  paint();
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
