import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { PublishedEvent } from '../matches/match-engine.js';

type BusMessage =
  | { readonly kind: 'events'; readonly matchId: string; readonly events: readonly PublishedEvent[] }
  | { readonly kind: 'user_suspended'; readonly userId: string };

export interface BusHandlers {
  deliver(matchId: string, events: readonly PublishedEvent[]): void;
  disconnectUser(userId: string): void;
}

/**
 * Difusión entre réplicas. Los eventos ya están confirmados en PostgreSQL: si Redis pierde un mensaje,
 * el cliente lo detecta por el hueco en `seq` y recupera el estado con `sync`.
 */
export class RedisEventBus {
  private readonly channel: string;
  private subscriber: Redis | null = null;

  constructor(
    private readonly redis: Redis,
    namespace: string,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.channel = `${namespace}match-events`;
  }

  async start(handlers: BusHandlers): Promise<void> {
    const subscriber = this.redis.duplicate();
    this.subscriber = subscriber;
    subscriber.on('error', (error: unknown) => {
      this.logger.warn({ err: error }, 'Error en la suscripción de Redis');
    });
    subscriber.on('message', (_channel: string, raw: string) => {
      try {
        const message = JSON.parse(raw) as BusMessage;
        if (message.kind === 'events') handlers.deliver(message.matchId, message.events);
        else handlers.disconnectUser(message.userId);
      } catch (error) {
        this.logger.error({ err: error }, 'Error repartiendo eventos');
      }
    });
    await subscriber.subscribe(this.channel);
  }

  publish(matchId: string, events: readonly PublishedEvent[]): void {
    this.send({ kind: 'events', matchId, events });
  }

  publishUserSuspended(userId: string): void {
    this.send({ kind: 'user_suspended', userId });
  }

  private send(message: BusMessage): void {
    void this.redis.publish(this.channel, JSON.stringify(message)).catch((error: unknown) => {
      this.logger.error({ err: error }, 'No se pudo difundir el mensaje');
    });
  }

  stop(): void {
    this.subscriber?.disconnect();
    this.subscriber = null;
  }
}
