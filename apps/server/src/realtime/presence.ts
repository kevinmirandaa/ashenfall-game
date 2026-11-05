import type { Redis } from 'ioredis';

/**
 * Conexiones vivas de cada usuario en todas las réplicas. Cada una caduca si su réplica deja de renovarla,
 * así una réplica caída no deja a un jugador "conectado" para siempre.
 */
export class Presence {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
    private readonly ttlMs: number,
  ) {}

  async touch(userId: string, connectionId: string): Promise<void> {
    const key = this.key(userId);
    await this.redis.zadd(key, Date.now() + this.ttlMs, connectionId);
    await this.redis.pexpire(key, this.ttlMs * 2);
  }

  /** Quita la conexión y dice si al usuario le queda alguna viva en cualquier réplica. */
  async removeAndCheck(userId: string, connectionId: string): Promise<boolean> {
    const key = this.key(userId);
    await this.redis.zrem(key, connectionId);
    return (await this.redis.zcount(key, Date.now(), '+inf')) > 0;
  }

  private key(userId: string): string {
    return `${this.namespace}presence:${userId}`;
  }
}
