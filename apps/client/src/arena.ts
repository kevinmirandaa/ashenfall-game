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
import { characterSheet, DEFAULT_WEAPON, FRAME_H, FRAME_W, FRAMES, projectileTexture, WEAPON_GRIP, WEAPON_SIZE, weaponTexture, type Look } from './art.js';
import { ART_SCALE, buildBiome, GROUND_DEPTH, GROUND_HEADROOM, WORLD_LEFT, WORLD_WIDTH } from './biomes.js';

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
const FRAME_DOWN = 4;
const FRAME_HIT = 3;
const FRAME_SHOOT = 2;

const toScreen = (point: Vec2): Vec2 => ({ x: point.x, y: GROUND_Y - point.y });

export interface ArenaHooks {
  /** La animación terminó y la vista puede mostrar el estado confirmado. */
  onAnimationsIdle(): void;
  onAim(): void;
  /** El proyectil llegó: el HUD muestra el daño ahora, no cuando el servidor lo resolvió. */
  onImpact(shot: ShotView): void;
  onIntro(active: boolean): void;
}

interface Figure {
  body: Phaser.GameObjects.Sprite;
  weapon: Phaser.GameObjects.Image;
  look: Look;
  facing: 1 | -1;
  down: boolean;
  pose: number;
}

interface Mote {
  x: number;
  y: number;
  speed: number;
  size: number;
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
  private aiming = false;
  private idleAt = 0;
  private idleFrame = 0;
  private moteList: Mote[] = [];
  private moteColor = 0xffffff;
  private hooks: ArenaHooks = { onAnimationsIdle: () => undefined, onAim: () => undefined, onImpact: () => undefined, onIntro: () => undefined };

  constructor(private readonly onReady: () => void) {
    super('arena');
  }

  setHooks(hooks: ArenaHooks): void {
    this.hooks = hooks;
  }

  create(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.aiming = this.canAim;
      this.aimAt(pointer);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.aiming && pointer.isDown) this.aimAt(pointer);
    });
    this.input.on('pointerup', () => {
      this.aiming = false;
    });
    this.onReady();
  }

  override update(time: number, delta: number): void {
    this.animateIdle(time);
    this.animateMotes(delta);
    if (this.trailOn && time > this.trailAt && this.projectile !== null) {
      this.trailAt = time + 35;
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
    if (you !== undefined) this.poseWeapon(you, this.canAim ? this.angleDeg : 25);
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

  private texture(key: string, draw: () => HTMLCanvasElement): string {
    if (!this.textures.exists(key)) this.textures.addCanvas(key, draw());
    return key;
  }

  private layerImage(key: string, draw: () => HTMLCanvasElement, parallax: number, baseline: number): void {
    // Con parallax, la capa debe quedar a la altura `baseline` de pantalla cuando la cámara está en reposo.
    this.texture(key, draw);
    this.add
      .image(WORLD_LEFT * parallax, baseline + REST_SCROLL_Y * parallax, key)
      .setOrigin(0, 1)
      .setScale(ART_SCALE)
      .setScrollFactor(parallax);
  }

  private build(view: PlayerMatchView, looks: MatchLooks): void {
    const id = view.arenaId;
    const camera = this.cameras.main;
    const biome = this.textures.exists(`mid-${id}`) ? null : buildBiome(id);
    const need = (part: 'sky' | 'far' | 'mid' | 'ground'): HTMLCanvasElement => {
      if (biome === null) throw new Error('Capa de bioma sin generar');
      return biome[part];
    };
    this.texture(`sky-${id}`, () => need('sky'));
    this.add.image(0, 0, `sky-${id}`).setOrigin(0, 0).setScale(VIEW_W / 320, VIEW_H / 180).setScrollFactor(0);
    this.layerImage(`far-${id}`, () => need('far'), 0.2, VIEW_H - 150);
    this.layerImage(`mid-${id}`, () => need('mid'), 0.55, VIEW_H - 138);
    this.texture(`ground-${id}`, () => need('ground'));
    this.add.image(WORLD_LEFT, GROUND_Y - GROUND_HEADROOM, `ground-${id}`).setOrigin(0, 0).setScale(ART_SCALE);

    const palette = { whispering_forest: [0x14162c, 0xa7b4d0], frostlands: [0x303c68, 0xf4f7ff], ashen_desert: [0x3f2024, 0xe8a76a] }[id];
    camera.setBackgroundColor(palette[0] ?? 0);
    this.moteColor = palette[1] ?? 0xffffff;
    camera.setZoom(1);
    camera.setBounds(WORLD_LEFT, WORLD_TOP, WORLD_WIDTH, WORLD_BOTTOM - WORLD_TOP);

    this.createFigure(view.you, looks.you, looks.youName);
    this.createFigure(view.opponent, looks.rival, looks.rivalName);
    this.equip(view.you.playerId, this.weaponId);
    this.equip(view.opponent.playerId, DEFAULT_WEAPON[looks.rival.character]);

    this.guide = this.add.graphics().setDepth(5);
    this.projectile = this.add.image(0, 0, this.projectileKey('bow', looks.you)).setScale(ART_SCALE).setDepth(6).setVisible(false);
    for (let i = 0; i < TRAIL_POOL; i += 1) this.trail.push(this.add.rectangle(0, 0, 6, 6, 0xf2963c).setDepth(5).setVisible(false));

    this.motes = this.add.graphics().setScrollFactor(0).setDepth(9);
    this.moteList = Array.from({ length: PARTICLES }, () => ({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, speed: 0.4 + Math.random(), size: Math.random() < 0.25 ? 4 : 2 }));
  }

  private projectileKey(id: WeaponId, look: Look): string {
    const skin = id === 'bow' ? String(look.boneBow) : id === 'axe' ? String(look.bronzeAxe) : '';
    return this.texture(`shot-${id}-${skin}`, () => projectileTexture(id, look));
  }

  private weaponKey(id: WeaponId, look: Look): string {
    const skin = id === 'bow' ? String(look.boneBow) : id === 'axe' ? String(look.bronzeAxe) : '';
    return this.texture(`weapon-${id}-${skin}`, () => weaponTexture(id, look));
  }

  private createFigure(side: PlayerMatchView['you'], look: Look, name: string): void {
    const { x, y } = toScreen(side.position);
    const key = `char-${JSON.stringify(look)}`;
    if (!this.textures.exists(key)) {
      const texture = this.textures.addCanvas(key, characterSheet(look));
      if (texture === null) throw new Error('No se pudo crear el sprite');
      for (let frame = 0; frame < FRAMES; frame += 1) texture.add(frame, 0, frame * FRAME_W, 0, FRAME_W, FRAME_H);
    }
    const body = this.add.sprite(x, y + 4, key, 0).setOrigin(0.5, 1).setScale(ART_SCALE).setFlipX(side.facing < 0).setDepth(3);
    const weapon = this.add.image(x + side.facing * 10, y - 46, this.weaponKey('bow', look)).setScale(ART_SCALE).setOrigin(WEAPON_GRIP.x / WEAPON_SIZE, WEAPON_GRIP.y / WEAPON_SIZE).setFlipX(side.facing < 0).setDepth(4);
    if (side.facing < 0) weapon.setOrigin(1 - WEAPON_GRIP.x / WEAPON_SIZE, WEAPON_GRIP.y / WEAPON_SIZE);
    const label = this.add
      .text(x, y - 128, name, { fontFamily: 'Palatino, Georgia, serif', fontSize: '17px', color: '#e8d8b0', stroke: '#0d0a0e', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(4);
    if (side.playerId === this.view?.opponent.playerId) this.rivalLabel = label;
    this.add.ellipse(x, y + 4, 60, 10, 0x000000, 0.4).setDepth(2);
    const figure: Figure = { body, weapon, look, facing: side.facing, down: side.hp <= 0, pose: -1 };
    this.figures.set(side.playerId, figure);
    if (figure.down) this.knockDown(figure);
    this.poseWeapon(figure, 25);
  }

  private equip(playerId: string, id: WeaponId): void {
    const figure = this.figures.get(playerId);
    if (figure !== undefined) figure.weapon.setTexture(this.weaponKey(id, figure.look));
  }

  private poseWeapon(figure: Figure, angleDeg: number): void {
    const radians = Phaser.Math.DegToRad(angleDeg);
    figure.weapon.setRotation(figure.facing > 0 ? -radians : radians);
  }

  private knockDown(figure: Figure): void {
    figure.down = true;
    figure.body.setFrame(FRAME_DOWN);
    figure.weapon.setVisible(false);
  }

  private animateIdle(time: number): void {
    if (time < this.idleAt) return;
    this.idleAt = time + 520;
    this.idleFrame = 1 - this.idleFrame;
    for (const figure of this.figures.values()) {
      if (figure.down || figure.pose >= 0) continue;
      figure.body.setFrame(this.idleFrame);
    }
  }

  private animateMotes(delta: number): void {
    const { motes, view } = this;
    if (motes === null || view === null) return;
    motes.clear();
    motes.fillStyle(this.moteColor, 0.7);
    const drift = view.windAccel * 0.012;
    const step = delta / 16;
    for (const mote of this.moteList) {
      mote.x = (mote.x + (drift + 0.15) * mote.speed * step + VIEW_W) % VIEW_W;
      mote.y = (mote.y + 0.55 * mote.speed * step) % VIEW_H;
      motes.fillRect(Math.round(mote.x), Math.round(mote.y), mote.size, mote.size);
    }
  }

  private emitTrail(x: number, y: number): void {
    const spark = this.trail[this.trailIndex];
    if (spark === undefined) return;
    this.trailIndex = (this.trailIndex + 1) % this.trail.length;
    spark.setPosition(x, y).setVisible(true).setAlpha(1).setFillStyle(Math.random() < 0.5 ? 0xf2963c : 0xfbe58a);
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
    this.power = Math.round(Phaser.Math.Clamp(Math.hypot(dx, dy) / 5, 10, 100));
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
    if (second !== undefined) {
      const dx = Math.abs(second.x - start.x);
      this.poseWeapon(shooter, Phaser.Math.RadToDeg(Math.atan2(start.y - second.y, dx)));
    }
    shooter.pose = FRAME_SHOOT;
    shooter.body.setFrame(FRAME_SHOOT);

    const spin = shot.weaponId === 'axe' || shot.weaponId === 'dagger';
    projectile.setTexture(this.projectileKey(shot.weaponId, shooter.look)).setPosition(start.x, start.y).setVisible(true);
    projectile.setFlipY(false);
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
    shooter.pose = -1;
    camera.stopFollow();
    projectile.setVisible(false);
    this.showImpact(shot);
    this.resolveImpact(shot);
    await this.wait(shot.targetHpAfter <= 0 ? 1400 : 900);
  }

  private resolveImpact(shot: ShotView): void {
    this.hooks.onImpact(shot);
    const { view } = this;
    if (view === null || shot.impactKind !== 'player') return;
    const targetId = shot.shooterId === view.you.playerId ? view.opponent.playerId : view.you.playerId;
    const target = this.figures.get(targetId);
    if (target === undefined) return;
    if (shot.targetHpAfter <= 0) {
      this.knockDown(target);
      return;
    }
    target.pose = FRAME_HIT;
    target.body.setFrame(FRAME_HIT).setTint(0xff8a7a);
    this.time.delayedCall(320, () => {
      target.pose = -1;
      target.body.clearTint();
    });
  }

  private showImpact(shot: ShotView): void {
    const { x, y } = toScreen(shot.impact);
    const hit = shot.impactKind === 'player';
    const colors = hit ? [0xc0392b, 0xef8a7d, 0xf2d0a0] : [0xd3c4a2, 0x8a7a5e, 0x57596b];
    for (let i = 0; i < 12; i += 1) {
      const color = colors[i % colors.length] ?? 0xffffff;
      const piece = this.add.rectangle(x, y, 6, 6, color).setDepth(7);
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
    const text = hit ? `-${String(shot.damage)}` : shot.impactKind === 'out_of_bounds' ? 'Fuera' : 'Fallo';
    const label = this.add
      .text(x, y - 40, text, { fontFamily: 'Palatino, Georgia, serif', fontStyle: 'bold', fontSize: hit ? '38px' : '26px', color: hit ? '#ff6a58' : '#e8d8b0', stroke: '#0d0a0e', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(8);
    this.tweens.add({ targets: label, y: y - 110, alpha: 0, duration: 1000, onComplete: () => label.destroy() });
  }
}
