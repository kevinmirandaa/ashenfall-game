/**
 * Música y efectos generados por código con Web Audio: sin archivos que descargar ni derechos de autor.
 * Nada suena hasta el primer gesto del usuario, como exigen los navegadores.
 */

export type MusicScene = 'town' | 'battle' | 'off';
export type SoundName =
  | 'click'
  | 'open'
  | 'back'
  | 'coin'
  | 'buy'
  | 'deny'
  | 'stretch'
  | 'turn'
  | 'bow'
  | 'spear'
  | 'axe'
  | 'hit_body'
  | 'hit_head'
  | 'hit_legs'
  | 'hit_obstacle'
  | 'hit_ground'
  | 'miss'
  | 'fall'
  | 'victory'
  | 'defeat'
  | 'match_start';

interface Volumes {
  music: number;
  sfx: number;
}

const STORAGE_KEY = 'ashenfall.audio';
const DEFAULT_VOLUMES: Volumes = { music: 0.5, sfx: 0.8 };
const LOOKAHEAD_S = 0.45;
const TICK_MS = 120;

/** Modo dórico sobre re: suena a taberna y camino medieval sin caer en lo alegre. */
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const ROOT = 50; // re3

const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const degree = (index: number, octave = 0): number => {
  const wrapped = ((index % 7) + 7) % 7;
  const octaves = Math.floor(index / 7);
  return ROOT + (DORIAN[wrapped] ?? 0) + 12 * (octave + octaves);
};

function loadVolumes(): Volumes {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<Volumes>;
      const clamp = (value: unknown, fallback: number): number => (typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback);
      return { music: clamp(parsed.music, DEFAULT_VOLUMES.music), sfx: clamp(parsed.sfx, DEFAULT_VOLUMES.sfx) };
    }
  } catch {
    // sin almacenamiento: se usan los valores por defecto
  }
  return { ...DEFAULT_VOLUMES };
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volumes: Volumes = loadVolumes();
  private scene: MusicScene = 'off';
  private timer: number | null = null;
  private nextStep = 0;
  private step = 0;

  get music(): number {
    return this.volumes.music;
  }

  get sfxVolume(): number {
    return this.volumes.sfx;
  }

  /** Debe llamarse desde un gesto del usuario; es seguro repetirlo. */
  unlock(): void {
    if (this.ctx === null) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      const compressor = ctx.createDynamicsCompressor();
      master.connect(compressor).connect(ctx.destination);
      const musicBus = ctx.createGain();
      const sfxBus = ctx.createGain();
      musicBus.connect(master);
      sfxBus.connect(master);
      this.ctx = ctx;
      this.master = master;
      this.musicBus = musicBus;
      this.sfxBus = sfxBus;
      this.noise = this.makeNoise(ctx);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.scene !== 'off') this.startLoop();
  }

  setVolumes(change: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...change };
    this.applyVolumes();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.volumes));
    } catch {
      // no es imprescindible recordar el volumen
    }
  }

  setScene(scene: MusicScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.step = 0;
    if (scene === 'off') this.stopLoop();
    else if (this.ctx !== null) this.startLoop();
  }

  sfx(name: SoundName): void {
    const { ctx, sfxBus } = this;
    if (ctx === null || sfxBus === null || ctx.state !== 'running' || this.volumes.sfx === 0) return;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'click':
        this.blip(t, 520, 0.05, 'square', 0.12);
        break;
      case 'open':
        this.blip(t, 330, 0.07, 'triangle', 0.2);
        this.blip(t + 0.06, 495, 0.09, 'triangle', 0.2);
        break;
      case 'back':
        this.blip(t, 440, 0.06, 'triangle', 0.18);
        this.blip(t + 0.05, 294, 0.1, 'triangle', 0.18);
        break;
      case 'coin':
        this.blip(t, 1318, 0.08, 'square', 0.14);
        this.blip(t + 0.07, 1760, 0.22, 'square', 0.14);
        break;
      case 'buy':
        for (let i = 0; i < 4; i += 1) this.blip(t + i * 0.055, 1500 + i * 180, 0.12, 'triangle', 0.16);
        this.blip(t + 0.26, 988, 0.35, 'sine', 0.22);
        break;
      case 'deny':
        this.blip(t, 160, 0.16, 'sawtooth', 0.2);
        this.blip(t + 0.1, 120, 0.22, 'sawtooth', 0.2);
        break;
      case 'stretch':
        this.sweep(t, 90, 150, 0.22, 'sawtooth', 0.1, 420);
        this.noiseBurst(t, 0.12, 900, 'bandpass', 0.06);
        break;
      case 'turn':
        this.bell(t, 88);
        break;
      case 'bow':
        this.noiseBurst(t, 0.09, 2400, 'highpass', 0.3);
        this.sweep(t, 260, 120, 0.18, 'triangle', 0.35, 1800);
        this.noiseBurst(t + 0.05, 0.28, 3000, 'bandpass', 0.12);
        break;
      case 'spear':
        this.noiseSweep(t, 0.4, 600, 3200, 0.3);
        this.sweep(t, 180, 90, 0.2, 'triangle', 0.2, 1200);
        break;
      case 'axe':
        this.noiseSweep(t, 0.55, 300, 1400, 0.38);
        this.sweep(t, 110, 70, 0.4, 'sawtooth', 0.12, 500);
        break;
      case 'hit_body':
        this.thump(t, 95, 0.3, 0.7);
        this.noiseBurst(t, 0.12, 700, 'lowpass', 0.4);
        break;
      case 'hit_head':
        this.thump(t, 120, 0.35, 0.8);
        this.noiseBurst(t, 0.1, 3500, 'highpass', 0.35);
        this.blip(t + 0.02, 1500, 0.12, 'square', 0.12);
        break;
      case 'hit_legs':
        this.thump(t, 80, 0.26, 0.65);
        this.noiseBurst(t, 0.1, 500, 'lowpass', 0.35);
        break;
      case 'hit_obstacle':
        this.noiseBurst(t, 0.07, 900, 'bandpass', 0.5);
        this.sweep(t, 220, 140, 0.12, 'triangle', 0.45, 900);
        this.sweep(t + 0.04, 330, 200, 0.1, 'triangle', 0.25, 900);
        break;
      case 'hit_ground':
        this.noiseBurst(t, 0.22, 380, 'lowpass', 0.45);
        this.thump(t, 60, 0.18, 0.4);
        break;
      case 'miss':
        this.noiseSweep(t, 0.35, 2600, 500, 0.12);
        break;
      case 'fall':
        this.thump(t, 70, 0.5, 0.9);
        this.noiseBurst(t, 0.4, 420, 'lowpass', 0.4);
        this.sweep(t + 0.05, 200, 50, 0.6, 'sawtooth', 0.15, 300);
        break;
      case 'victory':
        this.fanfare(t, [0, 4, 7, 12, 7, 12, 16], 0.17);
        break;
      case 'defeat':
        this.fanfare(t, [7, 5, 3, 0, -5], 0.3, true);
        break;
      case 'match_start':
        this.drum(t, 'tom');
        this.drum(t + 0.22, 'tom');
        this.drum(t + 0.44, 'kick');
        this.bell(t + 0.5, 74);
        break;
    }
  }

  // ---------- infraestructura ----------

  private applyVolumes(): void {
    if (this.musicBus !== null) this.musicBus.gain.value = this.volumes.music * 0.55;
    if (this.sfxBus !== null) this.sfxBus.gain.value = this.volumes.sfx;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private startLoop(): void {
    if (this.timer !== null || this.ctx === null) return;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => {
      this.schedule();
    }, TICK_MS);
  }

  private stopLoop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const { ctx } = this;
    if (ctx === null || ctx.state !== 'running' || document.hidden) {
      if (ctx !== null) this.nextStep = Math.max(this.nextStep, ctx.currentTime);
      return;
    }
    if (this.volumes.music === 0 || this.scene === 'off') return;
    const bpm = this.scene === 'town' ? 74 : 112;
    const stepLength = 60 / bpm / 4;
    while (this.nextStep < ctx.currentTime + LOOKAHEAD_S) {
      if (this.scene === 'town') this.townStep(this.nextStep, this.step, stepLength);
      else this.battleStep(this.nextStep, this.step, stepLength);
      this.nextStep += stepLength;
      this.step += 1;
    }
  }

  // ---------- música ----------

  /** Pueblo: laúd arpegiado sobre un bordón, con una flauta que aparece de vez en cuando. */
  private townStep(t: number, step: number, length: number): void {
    const bar = Math.floor(step / 16) % 8;
    const inBar = step % 16;
    const roots = [0, 0, -2, -2, -4, -4, -2, 0] as const; // re, re, do, do, si b, si b, do, re
    const root = roots[bar] ?? 0;
    const arp = [0, 2, 4, 2, 4, 2, 4, 2] as const;
    if (inBar % 2 === 0) {
      const index = arp[(inBar / 2) % arp.length] ?? 0;
      this.pluck(t, degree(root + index, 1), 0.2, length * 5);
    }
    if (inBar === 0) {
      this.pluck(t, degree(root, 0), 0.34, length * 12);
      this.drone(t, degree(0, -1), length * 16, 0.045);
    }
    if (inBar === 8) this.pluck(t, degree(root + 4, 0), 0.22, length * 8);
    if (bar % 2 === 1 && inBar % 4 === 0 && Math.random() < 0.55) {
      const notes = [4, 5, 6, 4, 2, 3] as const;
      const pick = notes[Math.floor(Math.random() * notes.length)] ?? 4;
      this.flute(t, degree(root + pick, 1), length * (Math.random() < 0.5 ? 4 : 6), 0.12);
    }
    if (inBar === 0 && bar % 4 === 0) this.drum(t, 'frame');
  }

  /** Combate: tambores de guerra, bajo insistente y una línea de laúd tensa. */
  private battleStep(t: number, step: number, length: number): void {
    const bar = Math.floor(step / 16) % 4;
    const inBar = step % 16;
    const roots = [0, 0, -2, -4] as const;
    const root = roots[bar] ?? 0;
    if (inBar === 0 || inBar === 6 || inBar === 10) this.drum(t, 'kick');
    if (inBar === 4 || inBar === 12) this.drum(t, 'snare');
    if (inBar % 2 === 0) this.pluck(t, degree(root, 0) + (inBar % 8 === 6 ? 7 : 0), 0.28, length * 2.5);
    if (inBar === 0) this.drone(t, degree(root, -1), length * 16, 0.07);
    const lead = [4, 4, 5, 4, 2, 4, 3, 2, 4, 4, 6, 5, 4, 2, 3, 1] as const;
    if (inBar % 2 === 0 && (inBar < 8 || bar % 2 === 1)) this.pluck(t, degree(root + (lead[inBar] ?? 4), 1), 0.17, length * 3);
    if (inBar === 8 && bar === 3) this.drum(t, 'tom');
  }

  // ---------- instrumentos ----------

  private env(t: number, peak: number, attack: number, hold: number, release: number): GainNode {
    const gain = this.ctx?.createGain();
    if (gain === undefined) throw new Error('Audio sin iniciar');
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return gain;
  }

  private play(source: AudioScheduledSourceNode, gain: GainNode, bus: GainNode | null, start: number, stop: number, filter?: BiquadFilterNode): void {
    if (filter !== undefined) source.connect(filter).connect(gain);
    else source.connect(gain);
    gain.connect(bus ?? this.master ?? gain);
    source.start(start);
    source.stop(stop);
  }

  private pluck(t: number, midi: number, volume: number, duration: number): void {
    const { ctx } = this;
    if (ctx === null) return;
    const hz = midiToHz(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(hz * 6, t);
    filter.frequency.exponentialRampToValueAtTime(hz * 1.4, t + duration);
    for (const [type, detune, level] of [['triangle', 0, 1], ['sawtooth', 7, 0.35]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      osc.detune.value = detune;
      const gain = this.env(t, volume * level, 0.004, 0.01, Math.max(0.12, duration));
      this.play(osc, gain, this.musicBus, t, t + duration + 0.2, filter);
    }
  }

  private flute(t: number, midi: number, duration: number, volume: number): void {
    const { ctx } = this;
    if (ctx === null) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToHz(midi);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.value = 6;
    lfo.connect(depth).connect(osc.detune);
    lfo.start(t);
    lfo.stop(t + duration + 0.3);
    const gain = this.env(t, volume, 0.08, duration * 0.5, duration * 0.6);
    this.play(osc, gain, this.musicBus, t, t + duration + 0.3);
  }

  private drone(t: number, midi: number, duration: number, volume: number): void {
    const { ctx } = this;
    if (ctx === null) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;
    for (const ratio of [1, 1.5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToHz(midi) * ratio;
      const gain = this.env(t, volume * (ratio === 1 ? 1 : 0.5), 0.4, duration * 0.7, 0.5);
      this.play(osc, gain, this.musicBus, t, t + duration + 1, filter);
    }
  }

  private drum(t: number, kind: 'kick' | 'snare' | 'tom' | 'frame'): void {
    const { ctx } = this;
    if (ctx === null) return;
    if (kind === 'snare') {
      this.noiseBurst(t, 0.16, 1800, 'bandpass', 0.35, this.musicBus);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const [from, to, length, level] = kind === 'kick' ? [130, 42, 0.22, 0.9] : kind === 'tom' ? [190, 80, 0.3, 0.7] : [150, 90, 0.5, 0.35];
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length);
    const gain = this.env(t, level, 0.003, 0.01, length);
    this.play(osc, gain, this.musicBus, t, t + length + 0.05);
  }

  // ---------- efectos ----------

  private blip(t: number, hz: number, duration: number, type: OscillatorType, volume: number): void {
    const { ctx } = this;
    if (ctx === null) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const gain = this.env(t, volume, 0.003, duration * 0.3, duration);
    this.play(osc, gain, this.sfxBus, t, t + duration * 1.4 + 0.03);
  }

  private sweep(t: number, from: number, to: number, duration: number, type: OscillatorType, volume: number, cutoff: number): void {
    const { ctx } = this;
    if (ctx === null) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.env(t, volume, 0.004, duration * 0.2, duration);
    this.play(osc, gain, this.sfxBus, t, t + duration * 1.3 + 0.03, filter);
  }

  private thump(t: number, hz: number, duration: number, volume: number): void {
    this.sweep(t, hz * 1.8, hz * 0.5, duration, 'sine', volume, 600);
  }

  private noiseBurst(t: number, duration: number, cutoff: number, type: BiquadFilterType, volume: number, bus: GainNode | null = this.sfxBus): void {
    const { ctx, noise } = this;
    if (ctx === null || noise === null) return;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const gain = this.env(t, volume, 0.003, duration * 0.15, duration);
    this.play(source, gain, bus, t, t + duration * 1.2 + 0.03, filter);
  }

  private noiseSweep(t: number, duration: number, from: number, to: number, volume: number): void {
    const { ctx, noise } = this;
    if (ctx === null || noise === null) return;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const gain = this.env(t, volume, duration * 0.35, duration * 0.1, duration * 0.55);
    this.play(source, gain, this.sfxBus, t, t + duration * 1.2, filter);
  }

  private bell(t: number, midi: number): void {
    for (const [ratio, level] of [[1, 1], [2.76, 0.4], [5.4, 0.2]] as const) this.blip(t, midiToHz(midi) * ratio, 0.9, 'sine', 0.16 * level);
  }

  private fanfare(t: number, intervals: readonly number[], spacing: number, minor = false): void {
    const base = minor ? 57 : 62;
    intervals.forEach((interval, index) => {
      const note = base + interval - (minor && interval % 12 === 4 ? 1 : 0);
      this.sweep(t + index * spacing, midiToHz(note), midiToHz(note) * 0.998, spacing * 2.2, 'sawtooth', 0.2, 1700);
      this.sweep(t + index * spacing, midiToHz(note + 12), midiToHz(note + 12), spacing * 1.6, 'square', 0.06, 2400);
    });
  }
}

export const audio = new AudioEngine();
