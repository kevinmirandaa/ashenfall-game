import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ProblemError } from '../problem.js';

const WINDOW_SECONDS = 60;
const MAX_LOCAL_KEYS = 10_000;

/**
 * Ventana fija de intentos de login por cuenta. Es independiente del límite por IP del plugin, que solo
 * admite un límite por petición. El correo se guarda como hash para no dejar datos personales en Redis.
 */
export class LoginThrottle {
  private readonly local = new Map<string, { count: number; resetAtMs: number }>();

  constructor(
    private readonly maxPerMinute: number,
    private readonly redis: Redis | undefined,
    private readonly namespace: string,
  ) {}

  async check(email: string): Promise<void> {
    const key = `${this.namespace}login:${createHash('sha256').update(email.toLowerCase()).digest('hex')}`;
    const { count, retryAfterSeconds } = this.redis === undefined ? this.hitLocal(key) : await this.hitRedis(this.redis, key);
    if (count > this.maxPerMinute) {
      throw new ProblemError(429, 'RATE_LIMITED', 'Demasiadas peticiones', { 'retry-after': String(retryAfterSeconds) });
    }
  }

  private async hitRedis(redis: Redis, key: string): Promise<{ count: number; retryAfterSeconds: number }> {
    try {
      const count = await redis.incr(key);
      const ttl = await redis.ttl(key);
      // -1: la clave no caduca. Pasa en el primer intento y también si una réplica cayó entre INCR y EXPIRE;
      // sin esto ese contador nunca se borraría y la cuenta quedaría bloqueada para siempre.
      if (ttl === -1) await redis.expire(key, WINDOW_SECONDS);
      return { count, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
    } catch {
      // Si Redis cae, sigue el contador local: el límite se debilita a uno por réplica, pero no desaparece.
      return this.hitLocal(key);
    }
  }

  private hitLocal(key: string): { count: number; retryAfterSeconds: number } {
    const now = Date.now();
    if (this.local.size >= MAX_LOCAL_KEYS) {
      for (const [candidate, entry] of this.local) if (entry.resetAtMs <= now) this.local.delete(candidate);
      if (this.local.size >= MAX_LOCAL_KEYS) this.local.clear();
    }
    const current = this.local.get(key);
    const entry =
      current === undefined || current.resetAtMs <= now
        ? { count: 1, resetAtMs: now + WINDOW_SECONDS * 1000 }
        : { count: current.count + 1, resetAtMs: current.resetAtMs };
    this.local.set(key, entry);
    return { count: entry.count, retryAfterSeconds: Math.ceil((entry.resetAtMs - now) / 1000) };
  }
}
