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

const WORLD_HEIGHT = 1100;
const GROUND_Y = 960;
/** La guía muestra solo el inicio del arco: con la posición del rival a la vista, una guía completa haría trivial apuntar. */
const GUIDE_FRACTION = 0.3;
const PAN_MS = 900;
const SHOT_MIN_MS = 500;

const THEMES = {
  whispering_forest: { sky: 0x1c2a26, far: 0x263b32, ground: 0x2c3a2a, rock: 0x4a5548 },
  frostlands: { sky: 0x4a5c68, far: 0x879eaa, ground: 0xc4ccd0, rock: 0x5f6f78 },
  ashen_desert: { sky: 0x5e4630, far: 0x87603c, ground: 0x9b7445, rock: 0x4c3a2c },
} as const;
const PROJECTILE_COLOR: Readonly<Record<WeaponId, number>> = { bow: 0xe5ddc8, spear: 0xd3c4a2, axe: 0x9b7445, dagger: 0xffffff };

const toScreen = (point: Vec2): Vec2 => ({ x: point.x, y: GROUND_Y - point.y });

export interface ArenaHooks {
  /** La animación terminó y la vista puede mostrar el estado confirmado. */
  onAnimationsIdle(): void;
  onAim(): void;
}

export class ArenaScene extends Phaser.Scene {
  view: PlayerMatchView | null = null;
  angleDeg = 45;
  power = 60;
  weaponId: WeaponId = 'bow';
  canAim = false;

  private guide!: Phaser.GameObjects.Graphics;
  private projectile!: Phaser.GameObjects.Rectangle;
  private figures = new Map<string, Phaser.GameObjects.Container>();
  private queue: (() => Promise<void>)[] = [];
  private playing = false;
  private hooks: ArenaHooks = { onAnimationsIdle: () => undefined, onAim: () => undefined };

  constructor() {
    super('arena');
  }

  setHooks(hooks: ArenaHooks): void {
    this.hooks = hooks;
  }

  create(): void {
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.aimAt(pointer);
    });
    this.scale.on('resize', () => {
      this.cameras.main.setZoom(this.fitZoom());
    });
  }

  /** Construye la arena; con `intro` hace el paneo inicial: tu personaje, el rival y quien dispara. */
  loadMatch(view: PlayerMatchView, intro: boolean): void {
    this.view = view;
    this.children.removeAll();
    this.figures.clear();
    this.queue = [];
    this.playing = false;
    this.create2d(view);
    if (intro) {
      this.enqueue(async () => {
        await this.panTo(view.you.position, 0);
        await this.wait(700);
        await this.panTo(view.opponent.position, PAN_MS * 1.4);
        await this.wait(700);
        await this.focusShooter();
      });
    } else {
      void this.focusShooter();
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

  drawGuide(): void {
    if (!this.guide.scene) return;
    this.guide.clear();
    const { view } = this;
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
    const shown = Math.max(2, Math.ceil(path.length * GUIDE_FRACTION));
    this.guide.fillStyle(0xe5ddc8, 0.9);
    for (const point of path.slice(0, shown)) {
      const { x, y } = toScreen(point);
      this.guide.fillRect(x - 3, y - 3, 6, 6);
    }
  }

  private fitZoom(): number {
    return Math.max(0.45, Math.min(1, this.scale.width / 1400));
  }

  private create2d(view: PlayerMatchView): void {
    const arena = ARENAS[view.arenaId];
    const theme = THEMES[view.arenaId];
    const camera = this.cameras.main;
    camera.setBackgroundColor(theme.sky);
    camera.setZoom(this.fitZoom());
    camera.setBounds(-400, -300, arena.width + 800, WORLD_HEIGHT + 400);

    // Capas generadas por código: siluetas lejanas sin colisión.
    const far = this.add.graphics().setScrollFactor(0.6, 1);
    far.fillStyle(theme.far, 0.45);
    for (let x = -600; x < arena.width + 600; x += 150) {
      const height = 170 + ((x * 7) % 190);
      far.fillRect(x, GROUND_Y - height, 70, height);
    }

    this.add.rectangle(arena.width / 2, GROUND_Y + 170, arena.width + 1600, 340, theme.ground);
    for (const rect of arena.obstacles) {
      const top = toScreen({ x: rect.x, y: rect.y + rect.height });
      this.add.rectangle(top.x, top.y, rect.width, rect.height, theme.rock).setOrigin(0, 0).setStrokeStyle(3, 0x17191b);
    }
    this.figures.set(view.you.playerId, this.createFigure(view.you.position, 0xd3c4a2, 'Tú'));
    this.figures.set(view.opponent.playerId, this.createFigure(view.opponent.position, 0x87443d, 'Rival'));

    this.guide = this.add.graphics().setDepth(5);
    this.projectile = this.add.rectangle(0, 0, 18, 5, 0xffffff).setDepth(6).setVisible(false);
  }

  private createFigure(position: Vec2, color: number, label: string): Phaser.GameObjects.Container {
    const { x, y } = toScreen(position);
    const body = this.add.rectangle(0, -38, 40, 58, color).setStrokeStyle(3, 0x17191b);
    const head = this.add.rectangle(0, -80, 26, 26, 0xe5ddc8).setStrokeStyle(3, 0x17191b);
    const legs = this.add.rectangle(0, -5, 34, 10, 0x343a3d);
    const name = this.add.text(0, -116, label, { fontFamily: 'monospace', fontSize: '20px', color: '#e5ddc8' }).setOrigin(0.5);
    const figure = this.add.container(x, y, [legs, body, head, name]);
    // Solo animación: la posición lógica no cambia nunca.
    this.tweens.add({ targets: [body, head], y: '-=2', yoyo: true, repeat: -1, duration: 700 });
    return figure;
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

  private panTo(position: Vec2, duration: number): Promise<void> {
    const { x, y } = toScreen({ x: position.x, y: position.y + 150 });
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

  private async focusShooter(): Promise<void> {
    const { view } = this;
    const turn = view?.turn;
    if (view === null || turn === null || turn === undefined) return;
    await this.panTo(turn.playerId === view.you.playerId ? view.you.position : view.opponent.position, PAN_MS);
  }

  /** La cámara sigue el disparo, para ambos jugadores, y termina donde acabó o en el rival si impactó. */
  private async playShot(shot: ShotView): Promise<void> {
    const points = shot.path.map(toScreen);
    const [start] = points;
    if (start === undefined || document.hidden) return;
    this.guide.clear();
    const { projectile } = this;
    projectile.setFillStyle(PROJECTILE_COLOR[shot.weaponId]).setPosition(start.x, start.y).setVisible(true);
    const camera = this.cameras.main;
    camera.stopFollow();
    camera.startFollow(projectile, true, 0.12, 0.12);

    const curve = new Phaser.Curves.Spline(points.flatMap((point) => [point.x, point.y]));
    const progress = { t: 0 };
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: progress,
        t: 1,
        duration: Math.max(SHOT_MIN_MS, shot.flightMs),
        ease: 'Linear',
        onUpdate: () => {
          const here = curve.getPoint(progress.t);
          const ahead = curve.getPoint(Math.min(1, progress.t + 0.01));
          projectile.setPosition(here.x, here.y);
          projectile.setRotation(Math.atan2(ahead.y - here.y, ahead.x - here.x));
        },
        onComplete: () => {
          resolve();
        },
      });
    });
    camera.stopFollow();
    projectile.setVisible(false);
    this.showImpact(shot);
    await this.wait(800);
  }

  private showImpact(shot: ShotView): void {
    const { x, y } = toScreen(shot.impact);
    const burst = this.add.circle(x, y, 8, 0xe5ddc8, 0.9).setDepth(7);
    this.tweens.add({ targets: burst, radius: 36, alpha: 0, duration: 350, onComplete: () => burst.destroy() });
    if (shot.impactKind === 'player') this.cameras.main.shake(150, 0.006);
    const text = shot.impactKind === 'player' ? `-${String(shot.damage)}` : shot.impactKind === 'out_of_bounds' ? 'Fuera' : 'Fallo';
    const label = this.add
      .text(x, y - 40, text, { fontFamily: 'monospace', fontSize: '34px', color: shot.damage > 0 ? '#e0584c' : '#e5ddc8', stroke: '#17191b', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(8);
    this.tweens.add({ targets: label, y: y - 110, alpha: 0, duration: 1000, onComplete: () => label.destroy() });
  }
}
