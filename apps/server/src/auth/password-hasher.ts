import argon2 from 'argon2';
import { ProblemError } from '../problem.js';

/** Configuración mínima de OWASP para Argon2id: 19 MiB, t=2, p=1. El valor por defecto de la librería usa 64 MiB. */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export interface HasherLimits {
  /** Contraseñas procesadas a la vez; acota CPU y memoria (19 MiB por cada una). */
  readonly maxConcurrent: number;
  /** Peticiones en espera; si se llena se rechaza, en lugar de acumular trabajo. */
  readonly maxQueued: number;
}

const DEFAULT_LIMITS: HasherLimits = { maxConcurrent: 1, maxQueued: 32 };

/**
 * Un pico de logins nunca debe tumbar las partidas en curso: el trabajo caro pasa por una fila acotada
 * y lo que no cabe recibe 503 con Retry-After de inmediato.
 */
export class PasswordHasher {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limits: HasherLimits = DEFAULT_LIMITS) {}

  hash(password: string): Promise<string> {
    return this.limited(() => argon2.hash(password, ARGON2_OPTIONS));
  }

  verify(hash: string, password: string): Promise<boolean> {
    return this.limited(() => argon2.verify(hash, password));
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.limits.maxConcurrent) {
      if (this.waiting.length >= this.limits.maxQueued) {
        throw new ProblemError(503, 'AUTH_BUSY', 'Servicio ocupado, inténtalo de nuevo', { 'retry-after': '1' });
      }
      // Quien libera el cupo lo traspasa directamente al siguiente en la fila.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next === undefined) this.running -= 1;
      else next();
    }
  }
}
