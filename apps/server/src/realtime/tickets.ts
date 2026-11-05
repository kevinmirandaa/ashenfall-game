import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

const TICKET_TTL_SECONDS = 30;

/** Ticket de un solo uso y corta duración. Evita poner el JWT en la URL del WebSocket. */
export class WsTicketStore {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
  ) {}

  async issue(userId: string): Promise<{ ticket: string; expiresIn: number }> {
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.set(this.key(ticket), userId, 'EX', TICKET_TTL_SECONDS);
    return { ticket, expiresIn: TICKET_TTL_SECONDS };
  }

  /** GETDEL es atómico: aunque se use dos veces a la vez, solo una conexión obtiene el usuario. */
  consume(ticket: string): Promise<string | null> {
    return this.redis.getdel(this.key(ticket));
  }

  private key(ticket: string): string {
    return `${this.namespace}ws-ticket:${ticket}`;
  }
}
