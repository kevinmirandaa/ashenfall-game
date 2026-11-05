import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { PublishedEvent } from '../matches/match-engine.js';

interface BusMessage {
  readonly matchId: string;
  readonly events: readonly PublishedEvent[];
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

  async start(deliver: (matchId: string, events: readonly PublishedEvent[]) => void): Promise<void> {
    const subscriber = this.redis.duplicate();
    this.subscriber = subscriber;
    subscriber.on('error', (error: unknown) => {
      this.logger.warn({ err: error }, 'Error en la suscripción de Redis');
    });
    subscriber.on('message', (_channel: string, raw: string) => {
      try {
        const { matchId, events } = JSON.parse(raw) as BusMessage;
        deliver(matchId, events);
      } catch (error) {
        this.logger.error({ err: error }, 'Error repartiendo eventos');
      }
    });
    await subscriber.subscribe(this.channel);
  }

  publish(matchId: string, events: readonly PublishedEvent[]): void {
    const message: BusMessage = { matchId, events };
    void this.redis.publish(this.channel, JSON.stringify(message)).catch((error: unknown) => {
      this.logger.error({ err: error, matchId }, 'No se pudo difundir el evento');
    });
  }

  stop(): void {
    this.subscriber?.disconnect();
    this.subscriber = null;
  }
}
