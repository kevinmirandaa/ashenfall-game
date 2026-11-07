import {
  arenaFor,
  PROPS,
  TERRAIN_OF,
  muzzlePosition,
  playerHitbox,
  simulateShot,
  WEAPONS,
  type PlayerEventPayload,
  type PropId,
  type PlayerMatchView,
  type ShotView,
  type Vec2,
  type WeaponEffect,
  type WeaponFamily,
  type WeaponId,
} from '@ashenfall/domain';
import Phaser from 'phaser';
import { audio } from './audio.js';
import { type FighterId, type Look } from './art.js';
import { BIOME_ART, drawGround, drawTerrainBlock, GROUND_DEPTH, GROUND_HEADROOM, TERRAIN_SCALE, WORLD_LEFT, WORLD_WIDTH } from './biomes.js';

const VIEW_W = 1280;
const VIEW_H = 720;
const GROUND_Y = 960;
const WORLD_BOTTOM = GROUND_Y + GROUND_DEPTH;
/** Margen superior para seguir los tiros altos sin que la cámara se detenga. */
const WORLD_TOP = -1500;
const REST_SCROLL_Y = WORLD_BOTTOM - VIEW_H;
/** La guía es una hilera corta de puntos: con la posición del rival a la vista, una guía completa haría trivial apuntar. */
const GUIDE_LENGTH = 250;
const GUIDE_SPACING = 20;
const PAN_MS = 900;
const SHOT_MIN_MS = 500;
const PARTICLES = 28;
const TRAIL_POOL = 14;
const HIP = 0.5;
const POWER_MIN = 10;
/** Tirachinas: píxeles arrastrados hacia atrás para la potencia máxima y mínimo para que cuente como disparo. */
const MAX_PULL = 240;
const MIN_PULL = 28;
/** Fotogramas que existen en las hojas de referencia; lo demás se anima con el muñeco. */
const POSES: Readonly<Partial<Record<FighterId, readonly ('hit' | 'down' | 'win' | 'shoot')[]>>> = {};
const BODY_HEIGHT: Readonly<Record<FighterId, number>> = {
  edrik: 148, sylwen: 148, borgrim: 134, aldric: 156, vaela: 148, corvus: 156, anselmo: 148, mirelle: 148, morveth: 152, rurik: 148,
  vampire: 150, werewolf: 162, witch: 148, specter: 160, spider: 118, skeleton: 150, dark_knight: 168, treant: 176, wraith: 160, golem: 176,
};
/** Armas que giran en el aire; el resto vuela apuntando a donde va. */
const FIREFLY_ARENAS: ReadonlySet<string> = new Set(['graveyard', 'misty_pines', 'hamlet_ruins']);
const FOG_ARENAS: ReadonlySet<string> = new Set(['graveyard', 'misty_pines', 'fog_ruins', 'blood_keep']);
const SPINNING: ReadonlySet<WeaponFamily> = new Set<WeaponFamily>(['axe', 'mace', 'flask']);
const EFFECT_COLORS: Readonly<Record<WeaponEffect['kind'], readonly [number, number]>> = { poison: [0x7ed957, 0xc8f08a], burn: [0xf2963c, 0xfbe58a] };

const toScreen = (point: Vec2): Vec2 => ({ x: point.x, y: GROUND_Y - point.y });

export interface ArenaHooks {
  /** La animación terminó y la vista puede mostrar el estado confirmado. */
  onAnimationsIdle(): void;
  onAim(): void;
  /** Se soltó el botón: dispara con el ángulo y la potencia actuales. */
  onRelease(): void;
  /** El proyectil llegó: el HUD muestra el daño ahora, no cuando el servidor lo resolvió. */
  onImpact(shot: ShotView): void;
  onIntro(active: boolean): void;
}

/** Muñeco de dos piezas: las piernas quedan en el suelo y el torso se inclina desde la cadera. */
interface Figure {
  root: Phaser.GameObjects.Container;
  torso: Phaser.GameObjects.Container;
  parts: Phaser.GameObjects.Image[];
  rigParts: (Phaser.GameObjects.Image | Phaser.GameObjects.Container)[];
  /** Fotograma real de la hoja, cuando existe para esa acción. */
  frame: Phaser.GameObjects.Image;
  weapon: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  /** Distancia del nombre sobre el suelo, para que lo siga al retroceder. */
  labelOffset: number;
  look: Look;
  facing: 1 | -1;
  homeX: number;
  homeY: number;
  phase: number;
  /** Lo que animan los tweens; `update` lo aplica sumando la respiración. */
  pose: { dx: number; dy: number; lean: number; fall: number; aim: number; recoil: number };
  down: boolean;
}

interface Mote {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
  depth: number;
}

export interface MatchLooks {
  you: Look;
  rival: Look;
  youName: string;
  rivalName: string;
}

export class ArenaScene extends Phaser.Scene {
  view: PlayerMatchView | null = null;
  angleDeg = 45;
  power = 60;
  weaponId: WeaponId = 'dagger';
  canAim = false;

  private guide: Phaser.GameObjects.Graphics | null = null;
  private rivalLabel: Phaser.GameObjects.Text | null = null;
  private motes: Phaser.GameObjects.Graphics | null = null;
  private trail: Phaser.GameObjects.Rectangle[] = [];
  private trailIndex = 0;
  private trailAt = 0;
  private trailOn = false;
  private trailColors: readonly [number, number] = [0xf2963c, 0xfbe58a];
  private projectile: Phaser.GameObjects.Image | null = null;
  private figures = new Map<string, Figure>();
  private queue: (() => Promise<void>)[] = [];
  private playing = false;
  /** Punto de pantalla donde se pulsó: el tirachinas se tensa desde ahí. */
  private anchor: { x: number; y: number } | null = null;
  private pullReady = false;
  private guideLabel: Phaser.GameObjects.Text | null = null;
  /**
   * La escena está creada. Una partida que llega antes (al reanudar), o mientras se descargan sus texturas,
   * queda en `pendingLoad` y sus eventos en `pendingEvents` hasta que todo esté listo.
   */
  private ready = false;
  /** Sube cada vez que se reconstruye la arena: invalida colas de animación que quedaron esperando. */
  private epoch = 0;
  private pendingLoad: (() => void) | null = null;
  private pendingEvents: PlayerEventPayload[] = [];
  private moteList: Mote[] = [];
  private moteColor = 0xffffff;
  private arenaId: PlayerMatchView['arenaId'] = 'hamlet_ruins';
  private blades: { x: number; height: number; phase: number }[] = [];
  private grass: Phaser.GameObjects.Graphics | null = null;
  private birds: { x: number; y: number; speed: number; phase: number }[] = [];
  private hooks: ArenaHooks = { onAnimationsIdle: () => undefined, onAim: () => undefined, onRelease: () => undefined, onImpact: () => undefined, onIntro: () => undefined };

  constructor(private readonly onReady: () => void) {
    super('arena');
  }

  setHooks(hooks: ArenaHooks): void {
    this.hooks = hooks;
  }

  /**
   * Nada pesado al arrancar: la pantalla de acceso y el pueblo no usan la arena. Cada partida pide en
   * `loadMatch` solo lo suyo (dos cuerpos, un fondo, un terreno, sus armas y el atlas de obstáculos) y
   * lo ya descargado queda en caché para las siguientes.
   */
  preload(): void {
    this.load.image('proj-dagger', '/art/proj-dagger.webp');
  }

  create(): void {
    // Un único degradado reutilizado para luces y para despegar a los personajes del fondo.
    const soft = document.createElement('canvas');
    soft.width = 128;
    soft.height = 128;
    const softCtx = soft.getContext('2d');
    if (softCtx !== null) {
      const gradient = softCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      softCtx.fillStyle = gradient;
      softCtx.fillRect(0, 0, 128, 128);
    }
    this.textures.addCanvas('soft-glow', soft);
    // Tirachinas: pulsar fija el ancla, arrastrar hacia atrás tensa (la distancia es la potencia y la
    // dirección el ángulo) y soltar dispara. Esc o clic derecho cancelan.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.canAim || pointer.rightButtonDown()) return;
      this.anchor = { x: pointer.x, y: pointer.y };
      this.pullReady = false;
      audio.sfx('stretch');
      this.power = POWER_MIN;
      this.drawGuide();
      this.hooks.onAim();
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.anchor === null) return;
      if (!this.canAim) {
        this.cancelPull();
        return;
      }
      this.pullTo(pointer);
    });
    const release = (): void => {
      if (this.anchor === null) return;
      const fire = this.pullReady && this.canAim;
      this.cancelPull();
      if (fire) this.hooks.onRelease();
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    this.input.keyboard?.on('keydown-ESC', () => {
      this.cancelPull();
    });
    this.ready = true;
    this.pendingLoad?.();
    this.pendingLoad = null;
    for (const payload of this.pendingEvents.splice(0)) this.applyEvent(payload);
    this.onReady();
  }

  override update(time: number, delta: number): void {
    this.animateFigures(time);
    if (this.anchor !== null && !this.canAim) this.cancelPull();
    this.animateBiome(time, delta);
    if (this.trailOn && time > this.trailAt && this.projectile !== null) {
      this.trailAt = time + 28;
      this.emitTrail(this.projectile.x, this.projectile.y);
    }
  }

  /** Construye la arena; con `intro` hace el paneo inicial: tu personaje, el rival y quien dispara. */
  loadMatch(view: PlayerMatchView, intro: boolean, looks: MatchLooks): void {
    this.view = view;
    this.epoch += 1;
    if (!this.ready || this.fetchMissing(view, looks)) {
      this.pendingLoad = () => { this.loadMatch(view, intro, looks); };
      return;
    }
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.children.removeAll(true);
    this.figures.clear();
    this.queue = [];
    this.playing = false;
    this.trail = [];
    this.build(view, looks);
    if (intro) {
      this.enqueue(async () => {
        this.hooks.onIntro(true);
        await this.panTo(view.you.position, 0, false);
        await this.wait(900);
        await this.panTo(view.opponent.position, PAN_MS * 1.6, false);
        await this.wait(900);
        this.hooks.onIntro(false);
        await this.focusShooter();
      });
    } else {
      // Al reconectar no hay nada que narrar: la cámara aparece ya sobre quien dispara.
      void this.focusShooter(0);
    }
  }

  updateView(view: PlayerMatchView): void {
    this.view = view;
    this.drawGuide();
  }

  /** Los eventos se animan en orden, uno tras otro, en ambos jugadores. */
  applyEvent(payload: PlayerEventPayload): void {
    if (!this.ready || this.pendingLoad !== null) {
      this.pendingEvents.push(payload);
      return;
    }
    if (payload.type === 'shot_resolved') this.enqueue(() => this.playShot(payload));
    if (payload.type === 'turn_started') {
      const mine = payload.playerId === this.view?.you.playerId;
      this.enqueue(async () => {
        if (mine) audio.sfx('turn');
        await this.focusShooter();
      });
    }
  }

  /** También mientras se descargan las texturas de la partida: aún no se puede apuntar. */
  get busy(): boolean {
    return this.playing || this.queue.length > 0 || this.pendingLoad !== null;
  }

  /**
   * Pide las texturas de esta partida que aún no están. Devuelve true si hay descargas en curso: al
   * terminar se vuelve a intentar la partida pendiente (la última que llegó) y luego sus eventos.
   */
  private fetchMissing(view: PlayerMatchView, looks: MatchLooks): boolean {
    if (this.load.isLoading()) return true;
    let missing = 0;
    const image = (key: string): void => {
      if (this.textures.exists(key)) return;
      this.load.image(key, `/art/${key}.webp`);
      missing += 1;
    };
    for (const fighter of new Set([looks.you.character, looks.rival.character])) {
      image(`body-${fighter}`);
      for (const pose of POSES[fighter] ?? []) image(`pose-${fighter}-${pose}`);
    }
    for (const weaponId of new Set<WeaponId>(['dagger', view.you.weaponId, view.opponent.weaponId])) image(`proj-${weaponId}`);
    image(`biome-${view.arenaId}`);
    if (view.obstacles.some((obstacle) => obstacle.kind === 'terrain')) image(`terrain-${TERRAIN_OF[view.arenaId]}`);
    // Todos los obstáculos de la hoja en un solo atlas: una petición, compartida por todas las arenas.
    if (view.obstacles.some((obstacle) => obstacle.kind !== 'terrain') && !this.textures.exists('obs')) {
      this.load.atlas('obs', '/art/obs-atlas.webp', '/art/obs-atlas.json');
      missing += 1;
    }
    if (missing === 0) return false;
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      const retry = this.pendingLoad;
      this.pendingLoad = null;
      retry?.();
      // Si la partida pendiente necesitó otra descarga, sus eventos siguen esperando.
      if (this.pendingLoad !== null) return;
      for (const payload of this.pendingEvents.splice(0)) this.applyEvent(payload);
      if (!this.busy) this.hooks.onAnimationsIdle();
    });
    this.load.start();
    return true;
  }

  /** Parte el cuerpo por la cadera la primera vez que se usa. */
  private splitBody(fighter: FighterId): void {
    const texture = this.textures.get(`body-${fighter}`);
    if (texture.has('upper')) return;
    const { width, height } = texture.getSourceImage();
    const hip = Math.round(Number(height) * HIP);
    // Se solapan unos píxeles para que no se abra una junta al inclinarse.
    texture.add('upper', 0, 0, 0, Number(width), hip + 8);
    texture.add('lower', 0, 0, hip, Number(width), Number(height) - hip);
  }

  setWeapon(id: WeaponId): void {
    this.weaponId = id;
    this.drawGuide();
  }

  drawGuide(): void {
    const { guide, view, guideLabel } = this;
    if (guide === null) return;
    guide.clear();
    guideLabel?.setVisible(false);
    const you = view === null ? undefined : this.figures.get(view.you.playerId);
    if (you !== undefined) you.pose.aim = this.canAim ? this.angleDeg : 25;
    if (view === null || !this.canAim) return;
    const side = view.you;
    const path = simulateShot({
      origin: muzzlePosition(side.position, side.facing),
      facing: side.facing,
      angleDeg: this.angleDeg,
      power: this.power,
      weapon: WEAPONS[this.weaponId],
      windAccel: view.windAccel,
      arena: arenaFor(view),
      target: playerHitbox(view.opponent.position),
    }).path;
    // Hilera corta de puntos cuadrados, como píxeles: cada uno más pequeño y tenue que el anterior.
    const points = path.map(toScreen);
    const dots: Vec2[] = [];
    let travelled = 0;
    let nextAt = 0;
    for (let index = 1; index < points.length && travelled <= GUIDE_LENGTH; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (from === undefined || to === undefined) continue;
      const segment = Math.hypot(to.x - from.x, to.y - from.y);
      while (nextAt <= travelled + segment && nextAt <= GUIDE_LENGTH) {
        const t = segment === 0 ? 0 : (nextAt - travelled) / segment;
        dots.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
        nextAt += GUIDE_SPACING;
      }
      travelled += segment;
    }
    dots.forEach((dot, index) => {
      const fade = 1 - index / Math.max(1, dots.length);
      const size = 4 + Math.round(fade * 4 / 2) * 2;
      const x = Math.round(dot.x / 2) * 2 - size / 2;
      const y = Math.round(dot.y / 2) * 2 - size / 2;
      guide.fillStyle(0x15101a, 0.35 + fade * 0.45);
      guide.fillRect(x - 2, y - 2, size + 4, size + 4);
      guide.fillStyle(fade > 0.5 ? 0xfff4d6 : 0xf0d9a0, 0.5 + fade * 0.5);
      guide.fillRect(x, y, size, size);
    });
    // Porcentajes sobre la hilera: potencia y ángulo (0–90°), sin cifras de grados.
    const middle = dots[Math.min(dots.length - 1, Math.floor(dots.length * 0.55))];
    if (middle !== undefined && guideLabel !== null) {
      guideLabel.setText(`Potencia ${this.power}%  ·  Ángulo ${Math.round((this.angleDeg / 90) * 100)}%`).setPosition(middle.x, middle.y - 26).setVisible(true);
    }
  }

  /** El nombre puede conocerse después de empezar: en sala se consulta aparte. */
  setRivalName(name: string): void {
    this.rivalLabel?.setText(name);
  }

  /** Terreno y objetos de esta partida: bloques de tierra (plataformas, gradas) y los sprites de la hoja. */
  private buildObstacles(view: PlayerMatchView): void {
    const terrain = TERRAIN_OF[view.arenaId];
    const SINK = 8;
    for (const obstacle of view.obstacles) {
      if (obstacle.kind === 'terrain') {
        const sink = obstacle.y === 0 ? SINK : 0;
        const cols = Math.max(8, Math.round(obstacle.width / TERRAIN_SCALE));
        const rows = Math.max(8, Math.round((obstacle.height + sink) / TERRAIN_SCALE));
        const key = `block-${terrain}-${cols}x${rows}`;
        if (!this.textures.exists(key)) this.textures.addCanvas(key, drawTerrainBlock(this.textures.get(`terrain-${terrain}`).getSourceImage() as HTMLImageElement, terrain, cols, rows));
        this.add.image(obstacle.x, GROUND_Y - obstacle.y - obstacle.height, key).setOrigin(0, 0).setScale(obstacle.width / cols, (obstacle.height + sink) / rows).setDepth(1).setFlipX(obstacle.flip === true);
        continue;
      }
      const spec = PROPS[obstacle.kind as PropId];
      const frame = this.textures.getFrame('obs', spec.id);
      const scale = spec.drawHeight / frame.height;
      const drawWidth = frame.width * scale;
      const flip = obstacle.flip === true;
      const centre = obstacle.x + obstacle.width / 2;
      const left = centre - (flip ? 1 - spec.cx : spec.cx) * drawWidth;
      this.add.image(left, GROUND_Y - obstacle.y + (obstacle.y === 0 ? 4 : 0), 'obs', spec.id).setOrigin(0, 1).setScale(scale).setFlipX(flip).setDepth(1.5);
    }
  }

  private build(view: PlayerMatchView, looks: MatchLooks): void {
    const id = view.arenaId;
    this.arenaId = id;
    const camera = this.cameras.main;
    const art = BIOME_ART[id];
    if (!this.textures.exists(`ground-${id}`)) this.textures.addCanvas(`ground-${id}`, drawGround(id));
    // La imagen de referencia, ampliada por un factor entero para que cada píxel siga siendo un píxel.
    this.add.image(WORLD_LEFT * 0.15, VIEW_H - 136 + REST_SCROLL_Y * 0.15, `biome-${id}`).setOrigin(0, 1).setScale(art.scale).setScrollFactor(0.15);
    this.addSkyFade(id, art.scale);
    this.add.image(WORLD_LEFT, GROUND_Y - GROUND_HEADROOM, `ground-${id}`).setOrigin(0, 0).setScale(2);
    this.buildObstacles(view);
    camera.setBackgroundColor(art.sky);
    this.moteColor = art.particle;
    camera.setZoom(1);
    camera.setBounds(WORLD_LEFT, WORLD_TOP, WORLD_WIDTH, WORLD_BOTTOM - WORLD_TOP);

    this.createFigure(view.you, looks.you, looks.youName);
    this.createFigure(view.opponent, looks.rival, looks.rivalName);

    this.grass = id === 'frozen_bridge' ? null : this.add.graphics().setDepth(4);
    this.blades = Array.from({ length: 110 }, () => ({ x: WORLD_LEFT + Math.random() * WORLD_WIDTH, height: 8 + Math.floor(Math.random() * 7) * 2, phase: Math.random() * 6 }));
    this.birds = id === 'frozen_bridge' ? [] : Array.from({ length: 5 }, (_, index) => ({ x: Math.random() * VIEW_W, y: 90 + index * 26 + Math.random() * 40, speed: 0.25 + Math.random() * 0.2, phase: Math.random() * 6 }));

    this.guide = this.add.graphics().setDepth(5);
    this.guideLabel = this.add
      .text(0, 0, '', { fontFamily: 'Palatino, Georgia, serif', fontStyle: 'bold', fontSize: '18px', color: '#f4efdf', stroke: '#0d0a0e', strokeThickness: 5 })
      .setOrigin(0.5, 1)
      .setDepth(6)
      .setVisible(false);
    this.anchor = null;
    this.projectile = this.add.image(0, 0, 'proj-dagger').setDepth(6).setVisible(false);
    for (let i = 0; i < TRAIL_POOL; i += 1) this.trail.push(this.add.rectangle(0, 0, 7, 7, 0xf2963c).setDepth(5).setVisible(false).setBlendMode(Phaser.BlendModes.ADD));

    this.motes = this.add.graphics().setScrollFactor(0).setDepth(9);
    const count = id === 'frozen_bridge' ? PARTICLES * 3 : PARTICLES;
    this.moteList = Array.from({ length: count }, () => ({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, speed: 0.4 + Math.random(), size: 1 + Math.random() * 2.4, phase: Math.random() * 6, depth: 0.4 + Math.random() * 0.8 }));
  }

  /** Degradado del color del cielo sobre la imagen de fondo: así no se ve un corte donde termina. */
  private addSkyFade(id: PlayerMatchView['arenaId'], scale: number): void {
    const key = `skyfade-${id}`;
    if (!this.textures.exists(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx !== null) {
        const gradient = ctx.createLinearGradient(0, 0, 0, 128);
        gradient.addColorStop(0, BIOME_ART[id].sky);
        gradient.addColorStop(1, `${BIOME_ART[id].sky}00`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 4, 128);
      }
      this.textures.addCanvas(key, canvas);
    }
    const source = this.textures.get(`biome-${id}`).getSourceImage();
    const top = VIEW_H - 136 + REST_SCROLL_Y * 0.15 - Number(source.height) * scale;
    this.add.image(WORLD_LEFT * 0.15, top - 64, key).setOrigin(0, 0).setDisplaySize(Number(source.width) * scale + 400, 128 + 64).setScrollFactor(0.15);
  }

  private createFigure(side: PlayerMatchView['you'], look: Look, name: string): void {
    const { x, y } = toScreen(side.position);
    const key = `body-${look.character}`;
    this.splitBody(look.character);
    const hipY = -BODY_HEIGHT[look.character] * HIP;
    const lower = this.add.image(0, 0, key, 'lower').setOrigin(0.5, 1);
    const upper = this.add.image(0, 8, key, 'upper').setOrigin(0.5, 1);
    const weapon = this.add.image(16, -BODY_HEIGHT[look.character] * 0.14, 'proj-dagger').setOrigin(0.5, 0.5).setVisible(false);
    const children: Phaser.GameObjects.GameObject[] = [upper, weapon];
    const torso = this.add.container(0, hipY, children);
    const frame = this.add.image(0, 0, key).setOrigin(0.5, 1).setVisible(false);
    const root = this.add.container(x, y + 3, [lower, torso, frame]).setDepth(3).setScale(side.facing, 1);
    const parts = [lower, upper, frame];
    const label = this.add
      .text(x, y - BODY_HEIGHT[look.character] - 22, name, { fontFamily: 'Palatino, Georgia, serif', fontSize: '17px', color: '#e8d8b0', stroke: '#0d0a0e', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(4);
    const shadow = this.add.ellipse(x, y + 4, 76, 13, 0x000000, 0.45).setDepth(2);
    const figure: Figure = { rigParts: [lower, torso], frame, root, torso, parts, weapon, shadow, label, labelOffset: BODY_HEIGHT[look.character] + 22, look, facing: side.facing, homeX: x, homeY: y + 3, phase: Math.random() * 6, pose: { dx: 0, dy: 0, lean: 0, fall: 0, aim: 25, recoil: 0 }, down: false };
    this.figures.set(side.playerId, figure);
    if (side.hp <= 0) this.knockDown(figure, false);
  }

  /** Muestra un fotograma de la hoja; devuelve false si ese personaje no lo tiene. */
  private showPose(figure: Figure, pose: 'hit' | 'down' | 'win' | 'shoot' | null): boolean {
    const available = pose !== null && (POSES[figure.look.character]?.includes(pose) ?? false);
    figure.frame.setVisible(available);
    for (const part of figure.rigParts) part.setVisible(!available);
    if (available) figure.frame.setTexture(`pose-${figure.look.character}-${pose}`);
    return available;
  }

  /** Respiración, balanceo y la pose que dejan los tweens. Sin texturas nuevas: solo transformar. */
  private animateFigures(time: number): void {
    for (const figure of this.figures.values()) {
      const { pose, root, torso, weapon, shadow } = figure;
      const breath = figure.down ? 0 : Math.sin(time / 620 + figure.phase);
      root.setPosition(figure.homeX + pose.dx, figure.homeY + pose.dy);
      root.setRotation(figure.facing * pose.fall);
      torso.setRotation(pose.lean + breath * 0.012);
      torso.setScale(1 + breath * 0.006, 1 - breath * 0.01);
      weapon.setRotation(Phaser.Math.DegToRad(-pose.aim) + breath * 0.012);
      weapon.setX(16 - pose.recoil);
      const height = Math.max(0, -pose.dy);
      shadow.setPosition(figure.homeX + pose.dx, figure.homeY + 1).setScale(1 - height / 120 + Math.abs(pose.fall) * 0.8, 1).setAlpha(0.8 - height / 200);
    }
  }

  private play(target: object, values: Record<string, number>, duration: number, ease: string): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.add({ targets: target, ...values, duration, ease, onComplete: () => { resolve(); } });
    });
  }

  /** Acción de disparo: se carga hacia atrás, suelta con el cuerpo y el arma retrocede. */
  private async animateShot(figure: Figure, aim: number, weaponId: WeaponId): Promise<void> {
    figure.pose.aim = aim;
    // El fotograma de disparo trae el arco en la mano: solo sirve si dispara con arco.
    const framed = weaponId === 'bow' && this.showPose(figure, 'shoot');
    this.time.delayedCall(framed ? 520 : 0, () => { if (!figure.down) this.showPose(figure, null); });
    await this.play(figure.pose, { lean: -0.16, recoil: 8, dx: -figure.facing * 4 }, 130, 'Sine.easeOut');
    void this.play(figure.pose, { lean: 0.13, recoil: -6, dx: figure.facing * 7 }, 80, 'Back.easeOut').then(() =>
      this.play(figure.pose, { lean: 0, recoil: 0, dx: 0 }, 420, 'Sine.easeInOut'),
    );
  }

  private flash(figure: Figure): void {
    for (const part of figure.parts) part.setTintFill(0xffffff);
    this.time.delayedCall(70, () => {
      for (const part of figure.parts) part.setTint(0xff5a48);
    });
    this.time.delayedCall(330, () => {
      for (const part of figure.parts) part.clearTint();
    });
  }

  private dust(x: number, y: number, count: number): void {
    const colour = { hamlet_ruins: 0x6a6048, graveyard: 0x4a4a5c, ember_desert: 0xc79a68, misty_pines: 0x5c6458, frozen_bridge: 0xeef3fb, blood_keep: 0x6a4650, fog_ruins: 0x7a7e8c }[this.arenaId];
    for (let i = 0; i < count; i += 1) {
      const size = 2 + Math.floor(Math.random() * 3) * 2;
      const puff = this.add.rectangle(x + (Math.random() - 0.5) * 24, y, size, size, colour, 0.7).setDepth(4);
      this.tweens.add({ targets: puff, x: puff.x + (Math.random() - 0.5) * 60, y: y - 8 - Math.random() * 22, alpha: 0, duration: 420 + Math.random() * 320, onComplete: () => puff.destroy() });
    }
  }

  /** Retroceso: el golpe lo levanta, lo arquea y lo desplaza a su nueva posición, donde se queda para siempre. */
  private async knockBack(figure: Figure, to: Vec2): Promise<void> {
    const { pose } = figure;
    const target = toScreen(to);
    const slide = target.x - figure.homeX;
    this.flash(figure);
    this.showPose(figure, 'hit');
    this.time.delayedCall(560, () => { if (!figure.down) this.showPose(figure, null); });
    this.dust(figure.homeX, figure.homeY, 7);
    pose.recoil = 6;
    void this.play(pose, { dy: -16 }, 90, 'Quad.easeOut').then(() => this.play(pose, { dy: 0 }, 90, 'Quad.easeIn'));
    void this.play(pose, { lean: -0.42, aim: 60 }, 180, 'Cubic.easeOut');
    await this.relocate(figure, to, 380 + Math.min(520, Math.abs(slide) * 2.2));
    if (Math.abs(slide) > 1) this.dust(figure.homeX, figure.homeY, 5);
    await this.play(pose, { lean: 0.14, aim: 10 }, 120, 'Sine.easeIn');
    await this.wait(80);
    await this.play(pose, { lean: 0 }, 240, 'Sine.easeInOut');
    pose.recoil = 0;
  }

  /** Mueve para siempre el punto de apoyo de la figura, su sombra y su nombre. */
  private relocate(figure: Figure, to: Vec2, duration: number): Promise<void> {
    const target = toScreen(to);
    if (document.hidden || duration <= 0) {
      this.settle(figure, target.x, target.y + 3);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.add({
        targets: figure,
        homeX: target.x,
        homeY: target.y + 3,
        duration,
        ease: 'Cubic.easeOut',
        onUpdate: () => {
          figure.label.setPosition(figure.homeX, figure.homeY - 3 - figure.labelOffset);
        },
        onComplete: () => {
          this.settle(figure, target.x, target.y + 3);
          resolve();
        },
      });
    });
  }

  private settle(figure: Figure, x: number, y: number): void {
    figure.homeX = x;
    figure.homeY = y;
    figure.label.setPosition(x, y - 3 - figure.labelOffset);
  }

  /** Cae de espaldas con rebote; el arma sale despedida. */
  private knockDown(figure: Figure, animated: boolean): void {
    figure.down = true;
    const hasFrame = this.showPose(figure, 'down');
    const back = -figure.facing;
    const { pose } = figure;
    if (!animated) {
      Object.assign(pose, { dx: back * 60, dy: 0, lean: 0, fall: hasFrame ? 0 : -Math.PI / 2 });
      figure.weapon.setVisible(false);
      return;
    }
    this.flash(figure);
    this.dust(figure.homeX, figure.homeY, 8);
    void this.play(pose, { dx: back * 90, lean: -0.5 }, 260, 'Cubic.easeOut');
    if (!hasFrame) void this.play(pose, { fall: -Math.PI / 2 }, 560, 'Bounce.easeOut');
    this.time.delayedCall(420, () => {
      this.dust(figure.homeX + back * 130, figure.homeY, 14);
      this.cameras.main.shake(140, 0.004);
    });
    this.tweens.add({ targets: figure.weapon, alpha: 0, duration: 400 });
  }

  private animateBiome(time: number, delta: number): void {
    const { motes, view } = this;
    if (motes === null || view === null) return;
    const step = delta / 16.67;
    motes.clear();
    const wind = view.windAccel * 0.012;
    const id = this.arenaId;
    for (const mote of this.moteList) {
      if (FIREFLY_ARENAS.has(id)) {
        // Luciérnagas: vagan despacio y laten.
        mote.x = (mote.x + (Math.sin(time / 900 + mote.phase) * 0.5 + wind * 0.2) * step + VIEW_W) % VIEW_W;
        mote.y += Math.cos(time / 700 + mote.phase) * 0.35 * step;
        const pulse = 0.25 + 0.75 * Math.max(0, Math.sin(time / 500 + mote.phase));
        motes.fillStyle(this.moteColor, pulse * 0.18);
        motes.fillRect(Math.round(mote.x) - 3, 300 + Math.round(mote.y % 300) - 3, 8, 8);
        motes.fillStyle(this.moteColor, pulse);
        motes.fillRect(Math.round(mote.x), 300 + Math.round(mote.y % 300), 2, 2);
      } else if (id === 'frozen_bridge') {
        // Nieve con profundidad: los copos cercanos caen más rápido.
        mote.x = (mote.x + (wind * mote.depth * 1.6 + Math.sin(time / 800 + mote.phase) * 0.4) * step + VIEW_W) % VIEW_W;
        mote.y = (mote.y + 1.1 * mote.depth * step) % VIEW_H;
        motes.fillStyle(this.moteColor, 0.35 + mote.depth * 0.5);
        motes.fillRect(Math.round(mote.x), Math.round(mote.y), mote.depth > 0.8 ? 4 : 2, mote.depth > 0.8 ? 4 : 2);
      } else {
        // Ceniza que sube y brasas que se apagan.
        mote.x = (mote.x + (wind * 1.4 + 0.2) * mote.depth * step + VIEW_W) % VIEW_W;
        mote.y = (mote.y - 0.45 * mote.depth * step + VIEW_H) % VIEW_H;
        motes.fillStyle(mote.phase > 4 ? 0xff9a3c : this.moteColor, 0.4 + 0.5 * Math.abs(Math.sin(time / 400 + mote.phase)));
        motes.fillRect(Math.round(mote.x), Math.round(mote.y), 2, 2);
      }
    }
    if (FOG_ARENAS.has(id)) {
      // Bancos de niebla que se desplazan despacio con el viento.
      for (let band = 0; band < 3; band += 1) {
        const drift = ((time / (60 + band * 25) + band * 420) % (VIEW_W + 520)) - 260;
        motes.fillStyle(0xdfe6f0, 0.05 + band * 0.012);
        motes.fillRect(drift - 260, 430 + band * 52, 640, 36);
        motes.fillRect(VIEW_W - drift - 380, 470 + band * 40, 520, 28);
      }
    }
    motes.lineStyle(1.6, 0x0c0a10, 0.75);
    for (const bird of this.birds) {
      bird.x = (bird.x + bird.speed * step) % (VIEW_W + 60);
      const flap = Math.sin(time / 130 + bird.phase) * 4;
      motes.beginPath();
      motes.moveTo(bird.x - 7, bird.y - flap);
      motes.lineTo(bird.x, bird.y);
      motes.lineTo(bird.x + 7, bird.y - flap);
      motes.strokePath();
    }
    const { grass } = this;
    if (grass !== null) {
      grass.clear();
      grass.lineStyle(1.6, this.arenaId === 'ember_desert' ? 0x3a2418 : 0x233a18, 1);
      const left = this.cameras.main.scrollX - 20;
      for (const blade of this.blades) {
        if (blade.x < left || blade.x > left + VIEW_W + 40) continue;
        const sway = Math.sin(time / 500 + blade.phase) * 3 + view.windAccel * 0.05;
        grass.lineBetween(blade.x, GROUND_Y + 2, blade.x + sway, GROUND_Y - blade.height);
      }
    }
  }

  private emitTrail(x: number, y: number): void {
    const spark = this.trail[this.trailIndex];
    if (spark === undefined) return;
    this.trailIndex = (this.trailIndex + 1) % this.trail.length;
    spark.setPosition(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8).setVisible(true).setAlpha(1).setFillStyle(this.trailColors[Math.random() < 0.5 ? 0 : 1]);
    this.tweens.add({ targets: spark, alpha: 0, y: y + 14, duration: 420, onComplete: () => spark.setVisible(false) });
  }

  /** El vector arrastrado apunta al revés que el tiro: tirar hacia atrás y abajo lanza hacia delante y arriba. */
  private pullTo(pointer: Phaser.Input.Pointer): void {
    const { view, anchor } = this;
    if (view === null || anchor === null) return;
    const dragX = pointer.x - anchor.x;
    const dragY = pointer.y - anchor.y;
    const back = -dragX * view.you.facing;
    const length = Math.hypot(dragX, dragY);
    this.pullReady = back > 0 && length >= MIN_PULL;
    const angle = back <= 0 ? (dragY > 0 ? 90 : 0) : Phaser.Math.RadToDeg(Math.atan2(dragY, back));
    this.angleDeg = Math.round(Phaser.Math.Clamp(angle, 0, 90));
    this.power = Math.round(Phaser.Math.Clamp(POWER_MIN + (Math.min(length, MAX_PULL) / MAX_PULL) * (100 - POWER_MIN), POWER_MIN, 100));
    this.drawGuide();
    this.hooks.onAim();
  }

  private cancelPull(): void {
    this.anchor = null;
    this.pullReady = false;
    this.drawGuide();
    this.hooks.onAim();
  }

  private enqueue(step: () => Promise<void>): void {
    this.queue.push(step);
    if (!this.playing) void this.drain();
  }

  private async drain(): Promise<void> {
    const epoch = this.epoch;
    this.playing = true;
    for (let step = this.queue.shift(); step !== undefined; step = this.queue.shift()) {
      await step();
      // Si la arena se reconstruyó mientras tanto, esta cola ya no es la vigente.
      if (epoch !== this.epoch) return;
    }
    this.playing = false;
    this.hooks.onAnimationsIdle();
  }

  private wait(ms: number): Promise<void> {
    // Con la pestaña oculta el navegador pausa el juego: sin esto la partida se quedaría esperando la animación.
    if (document.hidden) return Promise.resolve();
    // Reloj del navegador, no del juego: si se pausa el dibujado (ventana tapada) la cola no se queda esperando.
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /** `lead` adelanta el encuadre hacia el rival para ver hacia dónde se dispara. */
  private panTo(position: Vec2, duration: number, lead: boolean, facing: 1 | -1 = 1): Promise<void> {
    const x = position.x + (lead ? facing * 260 : 0);
    const y = WORLD_BOTTOM - VIEW_H / 2;
    const camera = this.cameras.main;
    camera.stopFollow();
    if (duration === 0 || document.hidden) {
      camera.centerOn(x, y);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const fallback = window.setTimeout(() => {
        camera.centerOn(x, y);
        resolve();
      }, duration + 400);
      camera.pan(x, y, duration, 'Sine.easeInOut', true, (_camera, progress) => {
        if (progress === 1) {
          window.clearTimeout(fallback);
          resolve();
        }
      });
    });
  }

  private async focusShooter(duration = PAN_MS): Promise<void> {
    const { view } = this;
    const turn = view?.turn;
    if (view === null || turn === null || turn === undefined) return;
    const side = turn.playerId === view.you.playerId ? view.you : view.opponent;
    await this.panTo(side.position, duration, true, side.facing);
  }

  /** La cámara sigue el disparo, para ambos jugadores, y termina donde acabó o en el rival si impactó. */
  private async playShot(shot: ShotView): Promise<void> {
    const points = shot.path.map(toScreen);
    const [start, second] = points;
    const { projectile } = this;
    const shooter = this.figures.get(shot.shooterId);
    if (start === undefined || projectile === null || shooter === undefined || document.hidden) {
      this.resolveImpact(shot);
      return;
    }
    this.guide?.clear();
    // La trayectoria es pública; de su inicio se deduce a dónde apuntar el arma.
    const aim = second === undefined ? 30 : Phaser.Math.RadToDeg(Math.atan2(start.y - second.y, Math.abs(second.x - start.x)));
    await this.animateShot(shooter, aim, shot.weaponId);
    audio.sfx(WEAPONS[shot.weaponId].family);

    const family = WEAPONS[shot.weaponId].family;
    const spin = SPINNING.has(family);
    projectile.setTexture(`proj-${shot.weaponId}`).setPosition(start.x, start.y).setVisible(true).clearTint().setScale(1).setOrigin(0.5, 0.5);
    this.trailColors = shot.effect === null ? [0xf2963c, 0xfbe58a] : EFFECT_COLORS[shot.effect.kind];
    this.trailOn = shot.effect !== null;
    const camera = this.cameras.main;
    camera.stopFollow();
    camera.startFollow(projectile, true, 0.12, 0.12);

    const curve = new Phaser.Curves.Spline(points.flatMap((point) => [point.x, point.y]));
    const progress = { t: 0 };
    const duration = Math.max(SHOT_MIN_MS, shot.flightMs);
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: progress,
        t: 1,
        duration,
        ease: 'Linear',
        onUpdate: () => {
          const here = curve.getPoint(progress.t);
          const ahead = curve.getPoint(Math.min(1, progress.t + 0.01));
          projectile.setPosition(here.x, here.y);
          projectile.setRotation(spin ? progress.t * duration * 0.018 : Math.atan2(ahead.y - here.y, ahead.x - here.x));
        },
        onComplete: () => {
          resolve();
        },
      });
    });
    this.trailOn = false;
    camera.stopFollow();
    projectile.setVisible(false);
    this.showImpact(shot);
    this.resolveImpact(shot);
    await this.wait(shot.impactKind !== 'player' ? 800 : shot.targetHpAfter <= 0 ? 1500 : 1600);
  }

  private resolveImpact(shot: ShotView): void {
    this.hooks.onImpact(shot);
    const { view } = this;
    if (view === null || shot.impactKind !== 'player') return;
    const targetId = shot.shooterId === view.you.playerId ? view.opponent.playerId : view.you.playerId;
    const target = this.figures.get(targetId);
    if (target === undefined) return;
    if (document.hidden) {
      this.settle(target, toScreen(shot.targetPosition).x, toScreen(shot.targetPosition).y + 3);
      if (shot.targetHpAfter <= 0) this.knockDown(target, false);
      return;
    }
    if (shot.targetHpAfter <= 0) {
      void this.relocate(target, shot.targetPosition, 700);
      audio.sfx('fall');
      this.knockDown(target, true);
      const winner = this.figures.get(shot.shooterId);
      if (winner !== undefined) this.showPose(winner, 'win');
    }
    else void this.knockBack(target, shot.targetPosition);
  }

  private showImpact(shot: ShotView): void {
    const { x, y } = toScreen(shot.impact);
    const hit = shot.impactKind === 'player';
    const colors = hit ? [0xc0392b, 0xef8a7d, 0xf2d0a0] : [0xd3c4a2, 0x8a7a5e, 0x57596b];
    for (let i = 0; i < 12; i += 1) {
      const color = colors[i % colors.length] ?? 0xffffff;
      const piece = this.add.rectangle(x, y, 4, 4, color).setDepth(7);
      const heading = Math.random() * Math.PI * 2;
      const reach = 24 + Math.random() * 46;
      this.tweens.add({
        targets: piece,
        x: x + Math.cos(heading) * reach,
        y: y + Math.sin(heading) * reach + 18,
        alpha: 0,
        duration: 420,
        onComplete: () => piece.destroy(),
      });
    }
    audio.sfx(hit ? 'hit_body' : shot.impactKind === 'obstacle' ? 'hit_obstacle' : shot.impactKind === 'ground' ? 'hit_ground' : 'miss');
    if (hit) this.cameras.main.shake(180, 0.007);
    const text = hit ? `-${String(shot.damage)}` : shot.impactKind === 'out_of_bounds' ? 'Fuera' : 'Fallo';
    const label = this.add
      .text(x, y - 40, text, { fontFamily: 'Palatino, Georgia, serif', fontStyle: 'bold', fontSize: hit ? '38px' : '26px', color: hit ? '#ff6a58' : '#e8d8b0', stroke: '#0d0a0e', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(8);
    this.tweens.add({ targets: label, y: y - 110, alpha: 0, duration: 1000, onComplete: () => label.destroy() });
    if (hit && shot.effect !== null) this.showEffect(shot, shot.effect);
  }

  /** Veneno o fuego: cada segundo aparece su daño sobre el rival y salen chispas del color del efecto. */
  private showEffect(shot: ShotView, effect: WeaponEffect): void {
    const { view } = this;
    if (view === null) return;
    const target = this.figures.get(shot.shooterId === view.you.playerId ? view.opponent.playerId : view.you.playerId);
    if (target === undefined) return;
    const [dark, light] = EFFECT_COLORS[effect.kind];
    const height = BODY_HEIGHT[target.look.character];
    this.time.addEvent({
      delay: 250,
      repeat: effect.seconds * 4 - 1,
      callback: () => {
        const x = target.homeX + (Math.random() - 0.5) * 36;
        const spark = this.add.rectangle(x, target.homeY - 10 - Math.random() * height * 0.6, 4, 4, Math.random() < 0.5 ? dark : light).setDepth(7);
        this.tweens.add({ targets: spark, y: spark.y - 26 - Math.random() * 20, alpha: 0, duration: 520, onComplete: () => spark.destroy() });
      },
    });
    this.time.addEvent({
      delay: 1000,
      repeat: effect.seconds - 1,
      callback: () => {
        const text = this.add
          .text(target.homeX, target.homeY - height - 8, `-${String(effect.perSecond)}`, {
            fontFamily: 'Palatino, Georgia, serif', fontStyle: 'bold', fontSize: '26px', color: effect.kind === 'poison' ? '#9be07a' : '#ffa050', stroke: '#0d0a0e', strokeThickness: 5,
          })
          .setOrigin(0.5)
          .setDepth(8);
        this.tweens.add({ targets: text, y: text.y - 56, alpha: 0, duration: 900, onComplete: () => text.destroy() });
      },
    });
  }
}
