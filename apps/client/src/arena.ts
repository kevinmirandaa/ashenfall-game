import {
  ARENAS,
  muzzlePosition,
  playerHitbox,
  simulateShot,
  WEAPONS,
  type PlayerEventPayload,
  type PlayerMatchView,
  type ShotView,
  type Vec2,
  type WeaponId,
} from '@ashenfall/domain';
import Phaser from 'phaser';
import { bodyTint, CHARACTERS, DEFAULT_WEAPON, type CharacterId, type Look } from './art.js';
import { BIOME_ART, drawGround, GROUND_DEPTH, GROUND_HEADROOM, WORLD_LEFT, WORLD_WIDTH } from './biomes.js';

const VIEW_W = 1280;
const VIEW_H = 720;
const GROUND_Y = 960;
const WORLD_BOTTOM = GROUND_Y + GROUND_DEPTH;
/** Margen superior para seguir los tiros altos sin que la cámara se detenga. */
const WORLD_TOP = -1500;
const REST_SCROLL_Y = WORLD_BOTTOM - VIEW_H;
/** La guía muestra solo el inicio del arco: con la posición del rival a la vista, una guía completa haría trivial apuntar. */
const GUIDE_FRACTION = 0.3;
const GUIDE_SPACING = 20;
const PAN_MS = 900;
const SHOT_MIN_MS = 500;
const PARTICLES = 28;
const TRAIL_POOL = 14;
const HIP = 0.5;
const POWER_MIN = 10;
const CHARGE_MS = 1500;
/** Fotogramas que existen en las hojas de referencia; lo demás se anima con el muñeco. */
const POSES: Readonly<Partial<Record<CharacterId, readonly ('hit' | 'down' | 'win' | 'shoot')[]>>> = {};
const BODY_HEIGHT: Readonly<Record<CharacterId, number>> = { edrik: 146, sylwen: 144, borgrim: 128 };
const WEAPON_ART: Readonly<Record<WeaponId, { length: number; originX: number }>> = {
  bow: { length: 112, originX: 0.3 },
  spear: { length: 150, originX: 0.38 },
  axe: { length: 104, originX: 0.3 },
};

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
  weaponId: WeaponId = 'bow';
  canAim = false;

  private guide: Phaser.GameObjects.Graphics | null = null;
  private rivalLabel: Phaser.GameObjects.Text | null = null;
  private motes: Phaser.GameObjects.Graphics | null = null;
  private trail: Phaser.GameObjects.Rectangle[] = [];
  private trailIndex = 0;
  private trailAt = 0;
  private trailOn = false;
  private projectile: Phaser.GameObjects.Image | null = null;
  private figures = new Map<string, Figure>();
  private queue: (() => Promise<void>)[] = [];
  private playing = false;
  private charging = false;
  private chargeMs = 0;
  private moteList: Mote[] = [];
  private moteColor = 0xffffff;
  private arenaId: PlayerMatchView['arenaId'] = 'whispering_forest';
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

  preload(): void {
    for (const hero of CHARACTERS) this.load.image(`body-${hero.id}`, `/art/body-${hero.id}.webp`);
    for (const id of ['bow', 'spear', 'axe'] as const) this.load.image(`weapon-${id}`, `/art/weapon-${id}.webp`);
    for (const [hero, poses] of Object.entries(POSES)) for (const pose of poses) this.load.image(`pose-${hero}-${pose}`, `/art/pose-${hero}-${pose}.webp`);
    for (const id of ['whispering_forest', 'frostlands', 'ashen_desert']) this.load.image(`biome-${id}`, `/art/biome-${id}.webp`);
    this.load.image('fx-arrow', '/art/fx-arrow.webp');
    this.load.image('helm', '/art/icon-helm.webp');
  }

  create(): void {
    for (const hero of CHARACTERS) {
      const texture = this.textures.get(`body-${hero.id}`);
      const { width, height } = texture.getSourceImage();
      const hip = Math.round(Number(height) * HIP);
      // Se solapan unos píxeles para que no se abra una junta al inclinarse.
      texture.add('upper', 0, 0, 0, Number(width), hip + 8);
      texture.add('lower', 0, 0, hip, Number(width), Number(height) - hip);
    }
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
    // Solo ratón: su posición da el ángulo; mantener pulsado carga la potencia; soltar dispara.
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.aimAt(pointer);
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.canAim) return;
      this.aimAt(pointer);
      this.charging = true;
      this.chargeMs = performance.now();
      this.power = POWER_MIN;
      this.hooks.onAim();
    });
    const release = (): void => {
      if (!this.charging) return;
      this.charging = false;
      this.hooks.onRelease();
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    this.onReady();
  }

  override update(time: number, delta: number): void {
    this.animateFigures(time);
    if (this.charging) {
      if (!this.canAim) {
        this.charging = false;
      } else {
        // Sube y baja: quien se pasa de fuerza puede esperar a que vuelva.
        // Tiempo real, no fotogramas: la misma pulsación da la misma potencia en cualquier equipo.
        const phase = ((performance.now() - this.chargeMs) % (CHARGE_MS * 2)) / CHARGE_MS;
        const level = phase <= 1 ? phase : 2 - phase;
        this.power = Math.round(POWER_MIN + (100 - POWER_MIN) * level);
        this.drawGuide();
        this.hooks.onAim();
      }
    }
    this.animateBiome(time, delta);
    if (this.trailOn && time > this.trailAt && this.projectile !== null) {
      this.trailAt = time + 28;
      this.emitTrail(this.projectile.x, this.projectile.y);
    }
  }

  /** Construye la arena; con `intro` hace el paneo inicial: tu personaje, el rival y quien dispara. */
  loadMatch(view: PlayerMatchView, intro: boolean, looks: MatchLooks): void {
    this.view = view;
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
    if (payload.type === 'shot_resolved') this.enqueue(() => this.playShot(payload));
    if (payload.type === 'turn_started') this.enqueue(() => this.focusShooter());
  }

  get busy(): boolean {
    return this.playing || this.queue.length > 0;
  }

  setWeapon(id: WeaponId): void {
    this.weaponId = id;
    const { view } = this;
    if (view !== null) this.equip(view.you.playerId, id);
    this.drawGuide();
  }

  drawGuide(): void {
    const { guide, view } = this;
    if (guide === null) return;
    guide.clear();
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
      arena: ARENAS[view.arenaId],
      target: playerHitbox(view.opponent.position),
    }).path;
    // El dominio devuelve pocos puntos: se reparten puntos regulares a lo largo del primer tramo del arco.
    const points = path.map(toScreen);
    const segments = points.slice(1).map((point, index) => {
      const from = points[index] ?? point;
      return { from, to: point, length: Math.hypot(point.x - from.x, point.y - from.y) };
    });
    const shownLength = segments.reduce((sum, segment) => sum + segment.length, 0) * GUIDE_FRACTION;
    guide.fillStyle(0xf4efdf, 0.95);
    let walked = 0;
    let nextDot = GUIDE_SPACING;
    for (const { from, to, length } of segments) {
      while (nextDot <= walked + length && nextDot <= shownLength) {
        const t = (nextDot - walked) / length;
        guide.fillRect(Math.round(from.x + (to.x - from.x) * t) - 2, Math.round(from.y + (to.y - from.y) * t) - 2, 4, 4);
        nextDot += GUIDE_SPACING;
      }
      walked += length;
    }
  }

  /** El nombre puede conocerse después de empezar: en sala se consulta aparte. */
  setRivalName(name: string): void {
    this.rivalLabel?.setText(name);
  }

  private build(view: PlayerMatchView, looks: MatchLooks): void {
    const id = view.arenaId;
    this.arenaId = id;
    const camera = this.cameras.main;
    const art = BIOME_ART[id];
    if (!this.textures.exists(`ground-${id}`)) this.textures.addCanvas(`ground-${id}`, drawGround(id));
    // La imagen de referencia, ampliada por un factor entero para que cada píxel siga siendo un píxel.
    this.add.image(WORLD_LEFT * 0.15, VIEW_H - 136 + REST_SCROLL_Y * 0.15, `biome-${id}`).setOrigin(0, 1).setScale(art.scale).setScrollFactor(0.15);
    this.add.image(WORLD_LEFT, GROUND_Y - GROUND_HEADROOM, `ground-${id}`).setOrigin(0, 0).setScale(2);
    camera.setBackgroundColor(art.sky);
    this.moteColor = art.particle;
    camera.setZoom(1);
    camera.setBounds(WORLD_LEFT, WORLD_TOP, WORLD_WIDTH, WORLD_BOTTOM - WORLD_TOP);

    this.createFigure(view.you, looks.you, looks.youName);
    this.createFigure(view.opponent, looks.rival, looks.rivalName);
    this.equip(view.you.playerId, this.weaponId);
    this.equip(view.opponent.playerId, DEFAULT_WEAPON[looks.rival.character]);

    this.grass = id === 'frostlands' ? null : this.add.graphics().setDepth(4);
    this.blades = Array.from({ length: 110 }, () => ({ x: WORLD_LEFT + Math.random() * WORLD_WIDTH, height: 8 + Math.floor(Math.random() * 7) * 2, phase: Math.random() * 6 }));
    this.birds = id === 'frostlands' ? [] : Array.from({ length: 5 }, (_, index) => ({ x: Math.random() * VIEW_W, y: 90 + index * 26 + Math.random() * 40, speed: 0.25 + Math.random() * 0.2, phase: Math.random() * 6 }));

    this.guide = this.add.graphics().setDepth(5);
    this.projectile = this.add.image(0, 0, 'fx-arrow').setDepth(6).setVisible(false);
    for (let i = 0; i < TRAIL_POOL; i += 1) this.trail.push(this.add.rectangle(0, 0, 7, 7, 0xf2963c).setDepth(5).setVisible(false).setBlendMode(Phaser.BlendModes.ADD));

    this.motes = this.add.graphics().setScrollFactor(0).setDepth(9);
    const count = id === 'frostlands' ? PARTICLES * 3 : PARTICLES;
    this.moteList = Array.from({ length: count }, () => ({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, speed: 0.4 + Math.random(), size: 1 + Math.random() * 2.4, phase: Math.random() * 6, depth: 0.4 + Math.random() * 0.8 }));
  }

  private createFigure(side: PlayerMatchView['you'], look: Look, name: string): void {
    const { x, y } = toScreen(side.position);
    const key = `body-${look.character}`;
    const hipY = -BODY_HEIGHT[look.character] * HIP;
    const lower = this.add.image(0, 0, key, 'lower').setOrigin(0.5, 1);
    const upper = this.add.image(0, 8, key, 'upper').setOrigin(0.5, 1);
    const weapon = this.add.image(16, -BODY_HEIGHT[look.character] * 0.14, 'weapon-bow').setOrigin(0.5, 0.5);
    const children: Phaser.GameObjects.GameObject[] = [upper, weapon];
    if (look.helm) children.push(this.add.image(2, -BODY_HEIGHT[look.character] * 0.4, 'helm').setDisplaySize(34, 34));
    const torso = this.add.container(0, hipY, children);
    const frame = this.add.image(0, 0, key).setOrigin(0.5, 1).setVisible(false);
    const root = this.add.container(x, y + 3, [lower, torso, frame]).setDepth(3).setScale(side.facing, 1);
    const parts = [lower, upper, frame];
    const tint = bodyTint(look);
    if (tint !== 0xffffff) for (const part of parts) part.setTint(tint);
    this.add
      .text(x, y - BODY_HEIGHT[look.character] - 22, name, { fontFamily: 'Palatino, Georgia, serif', fontSize: '17px', color: '#e8d8b0', stroke: '#0d0a0e', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(4);
    const shadow = this.add.ellipse(x, y + 4, 76, 13, 0x000000, 0.45).setDepth(2);
    const figure: Figure = { rigParts: [lower, torso], frame, root, torso, parts, weapon, shadow, look, facing: side.facing, homeX: x, homeY: y + 3, phase: Math.random() * 6, pose: { dx: 0, dy: 0, lean: 0, fall: 0, aim: 25, recoil: 0 }, down: false };
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

  private equip(playerId: string, id: WeaponId): void {
    const figure = this.figures.get(playerId);
    if (figure === undefined) return;
    const art = WEAPON_ART[id];
    // Cada sprite ya lleva dibujada su arma: solo se superpone si elige otra.
    const image = figure.weapon.setTexture(`weapon-${id}`).clearTint().setVisible(id !== DEFAULT_WEAPON[figure.look.character]);
    image.setOrigin(art.originX, 0.5);
    image.setScale(1);
    if (id === 'axe' && figure.look.bronzeAxe) image.setTint(0xe6a860);
    if (id === 'bow' && figure.look.boneBow) image.setTint(0xfff0d0);
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
      const tint = bodyTint(figure.look);
      for (const part of figure.parts) part.setTint(tint);
    });
  }

  private dust(x: number, y: number, count: number): void {
    const colour = { whispering_forest: 0x6a6048, frostlands: 0xeef3fb, ashen_desert: 0xc79a68 }[this.arenaId];
    for (let i = 0; i < count; i += 1) {
      const size = 2 + Math.floor(Math.random() * 3) * 2;
      const puff = this.add.rectangle(x + (Math.random() - 0.5) * 24, y, size, size, colour, 0.7).setDepth(4);
      this.tweens.add({ targets: puff, x: puff.x + (Math.random() - 0.5) * 60, y: y - 8 - Math.random() * 22, alpha: 0, duration: 420 + Math.random() * 320, onComplete: () => puff.destroy() });
    }
  }

  /** Retroceso realista: el golpe lo levanta y arquea, tropieza dos pasos atrás y vuelve a su sitio. La posición lógica no cambia. */
  private async knockBack(figure: Figure, damage: number): Promise<void> {
    const back = -figure.facing;
    const { pose } = figure;
    const shove = 34 + damage * 1.5;
    this.flash(figure);
    this.showPose(figure, 'hit');
    this.time.delayedCall(560, () => { if (!figure.down) this.showPose(figure, null); });
    this.dust(figure.homeX, figure.homeY, 7);
    pose.recoil = 6;
    void this.play(pose, { dy: -16 }, 90, 'Quad.easeOut').then(() => this.play(pose, { dy: 0 }, 90, 'Quad.easeIn'));
    await this.play(pose, { dx: back * shove, lean: -0.42, aim: 60 }, 180, 'Cubic.easeOut');
    this.dust(figure.homeX + back * shove, figure.homeY, 5);
    await this.play(pose, { dx: back * (shove + 12), dy: -5, lean: -0.2 }, 110, 'Sine.easeOut');
    await this.play(pose, { dx: back * (shove + 18), dy: 0, lean: 0.14, aim: 10 }, 120, 'Sine.easeIn');
    this.dust(figure.homeX + back * (shove + 18), figure.homeY, 3);
    await this.wait(120);
    // Regresa recuperando el equilibrio, con pasos visibles.
    const steps = 3;
    const each = 230;
    for (let step = 1; step <= steps; step += 1) {
      void this.play(pose, { dy: -5 }, each / 2, 'Sine.easeOut').then(() => this.play(pose, { dy: 0 }, each / 2, 'Sine.easeIn'));
      await this.play(pose, { dx: back * (shove + 18) * (1 - step / steps), lean: step === steps ? 0 : 0.08 }, each, 'Sine.easeInOut');
    }
    pose.recoil = 0;
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
      if (id === 'whispering_forest') {
        // Luciérnagas: vagan despacio y laten.
        mote.x = (mote.x + (Math.sin(time / 900 + mote.phase) * 0.5 + wind * 0.2) * step + VIEW_W) % VIEW_W;
        mote.y += Math.cos(time / 700 + mote.phase) * 0.35 * step;
        const pulse = 0.25 + 0.75 * Math.max(0, Math.sin(time / 500 + mote.phase));
        motes.fillStyle(this.moteColor, pulse * 0.18);
        motes.fillRect(Math.round(mote.x) - 3, 300 + Math.round(mote.y % 300) - 3, 8, 8);
        motes.fillStyle(this.moteColor, pulse);
        motes.fillRect(Math.round(mote.x), 300 + Math.round(mote.y % 300), 2, 2);
      } else if (id === 'frostlands') {
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
      grass.lineStyle(1.6, this.arenaId === 'ashen_desert' ? 0x3a2418 : 0x233a18, 1);
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
    spark.setPosition(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8).setVisible(true).setAlpha(1).setFillStyle(Math.random() < 0.5 ? 0xf2963c : 0xfbe58a);
    this.tweens.add({ targets: spark, alpha: 0, y: y + 14, duration: 420, onComplete: () => spark.setVisible(false) });
  }

  private aimAt(pointer: Phaser.Input.Pointer): void {
    const { view } = this;
    if (view === null || !this.canAim) return;
    const origin = toScreen(muzzlePosition(view.you.position, view.you.facing));
    const dx = (pointer.worldX - origin.x) * view.you.facing;
    const dy = origin.y - pointer.worldY;
    const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
    const clamped = dx < 0 ? (dy > 0 ? 90 : 0) : Phaser.Math.Clamp(angle, 0, 90);
    this.angleDeg = Math.round(clamped);
    this.drawGuide();
    this.hooks.onAim();
  }

  private enqueue(step: () => Promise<void>): void {
    this.queue.push(step);
    if (!this.playing) void this.drain();
  }

  private async drain(): Promise<void> {
    this.playing = true;
    for (let step = this.queue.shift(); step !== undefined; step = this.queue.shift()) await step();
    this.playing = false;
    this.hooks.onAnimationsIdle();
  }

  private wait(ms: number): Promise<void> {
    // Con la pestaña oculta el navegador pausa el juego: sin esto la partida se quedaría esperando la animación.
    if (document.hidden) return Promise.resolve();
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
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
      camera.pan(x, y, duration, 'Sine.easeInOut', true, (_camera, progress) => {
        if (progress === 1) resolve();
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
    this.equip(shot.shooterId, shot.weaponId);
    // La trayectoria es pública; de su inicio se deduce a dónde apuntar el arma.
    const aim = second === undefined ? 30 : Phaser.Math.RadToDeg(Math.atan2(start.y - second.y, Math.abs(second.x - start.x)));
    await this.animateShot(shooter, aim, shot.weaponId);

    const spin = shot.weaponId === 'axe';
    const arrow = shot.weaponId === 'bow';
    projectile.setTexture(arrow ? 'fx-arrow' : `weapon-${shot.weaponId}`).setPosition(start.x, start.y).setVisible(true).clearTint();
    projectile.setScale(arrow ? 1 : 0.5).setOrigin(arrow ? 0.8 : 0.5, 0.5);
    this.trailOn = shooter.look.embers;
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
      if (shot.targetHpAfter <= 0) this.knockDown(target, false);
      return;
    }
    if (shot.targetHpAfter <= 0) {
      this.knockDown(target, true);
      const winner = this.figures.get(shot.shooterId);
      if (winner !== undefined) this.showPose(winner, 'win');
    }
    else void this.knockBack(target, shot.damage);
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
    if (hit) this.cameras.main.shake(180, 0.007);
    const zone = shot.zone === 'head' ? '¡Cabeza! ' : shot.zone === 'legs' ? 'Piernas ' : '';
    const text = hit ? `${zone}-${String(shot.damage)}` : shot.impactKind === 'out_of_bounds' ? 'Fuera' : 'Fallo';
    const label = this.add
      .text(x, y - 40, text, { fontFamily: 'Palatino, Georgia, serif', fontStyle: 'bold', fontSize: hit ? '38px' : '26px', color: hit ? '#ff6a58' : '#e8d8b0', stroke: '#0d0a0e', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(8);
    this.tweens.add({ targets: label, y: y - 110, alpha: 0, duration: 1000, onComplete: () => label.destroy() });
  }
}
