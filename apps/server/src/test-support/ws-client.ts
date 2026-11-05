import type { PlayerEventPayload } from '@ashenfall/domain';
import type { WebSocket } from 'ws';
import type { ServerMessage } from '../realtime/protocol.js';

export class WsTestClient {
  readonly messages: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  closeCode: number | null = null;

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
      this.notify();
    });
    socket.on('close', (code) => {
      this.closeCode = code;
      this.notify();
    });
  }

  private notify(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  async until<T>(find: (messages: readonly ServerMessage[]) => T | undefined, timeoutMs = 3000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = find(this.messages);
      if (found !== undefined) return found;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Tiempo agotado. Mensajes: ${JSON.stringify(this.messages).slice(0, 800)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  closed(): Promise<number> {
    return this.until(() => this.closeCode ?? undefined);
  }

  send(message: object): void {
    this.socket.send(JSON.stringify({ v: 1, ...message }));
  }

  /** Espera un evento de partida de ese tipo y devuelve su carga. */
  async untilEvent(type: PlayerEventPayload['type']): Promise<PlayerEventPayload> {
    return this.until((messages) => {
      for (const message of messages) {
        if (message.type === 'event' && message.event.payload.type === type) return message.event.payload;
      }
      return undefined;
    });
  }
}
