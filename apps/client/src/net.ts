import type { PlayerEvent, PlayerMatchView } from '@ashenfall/domain';

export type ServerMessage =
  | { type: 'welcome'; userId: string }
  | { type: 'snapshot'; view: PlayerMatchView }
  | { type: 'event'; matchId: string; event: PlayerEvent }
  | { type: 'ack'; actionId: string; seq: number; duplicate: boolean }
  | { type: 'error'; code: string; actionId?: string };

interface Problem {
  code?: string;
  title?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Tokens solo en memoria: al recargar se vuelve a iniciar sesión. Nada queda en almacenamiento del navegador. */
export class Session {
  accessToken: string | null = null;
  private refreshToken: string | null = null;

  async authenticate(path: 'register' | 'login', body: object): Promise<void> {
    this.store(await this.send<Tokens>('POST', `/v1/auth/${path}`, body, false));
  }

  async logout(): Promise<void> {
    if (this.refreshToken !== null) await this.send('POST', '/v1/auth/logout', { refreshToken: this.refreshToken }, false);
    this.accessToken = null;
    this.refreshToken = null;
  }

  async call<T>(method: string, path: string, body?: object): Promise<T> {
    try {
      return await this.send<T>(method, path, body, true);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || this.refreshToken === null) throw error;
      this.store(await this.send<Tokens>('POST', '/v1/auth/refresh', { refreshToken: this.refreshToken }, false));
      return this.send<T>(method, path, body, true);
    }
  }

  private store(tokens: Tokens): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
  }

  private async send<T>(method: string, path: string, body: object | undefined, auth: boolean): Promise<T> {
    const response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(auth && this.accessToken !== null ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;
    const data = (await response.json()) as T & Problem;
    if (!response.ok) throw new ApiError(response.status, data.code ?? 'ERROR', data.title ?? 'Error');
    return data;
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const MAX_RETRY_MS = 8000;

/** WebSocket con reconexión: cada intento pide un ticket nuevo, porque son de un solo uso. */
export class GameSocket {
  private socket: WebSocket | null = null;
  private closedByUser = false;
  private retryMs = 500;

  constructor(
    private readonly session: Session,
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onStatus: (connected: boolean) => void,
  ) {}

  /** Volver al pueblo no debe abrir otra conexión: el servidor limita las conexiones por usuario. */
  async ensureConnected(): Promise<void> {
    const state = this.socket?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    await this.connect();
  }

  async connect(): Promise<void> {
    this.closedByUser = false;
    const { ticket } = await this.session.call<{ ticket: string }>('POST', '/v1/ws-ticket');
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/ws?ticket=${encodeURIComponent(ticket)}`);
    this.socket = socket;
    socket.onopen = () => {
      this.retryMs = 500;
      this.onStatus(true);
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      this.onMessage(JSON.parse(event.data) as ServerMessage);
    };
    socket.onclose = (event) => {
      this.onStatus(false);
      // 4003 suspendido y 4008 demasiadas conexiones: reintentar no serviría.
      if (this.closedByUser || event.code === 4003 || event.code === 4008) return;
      setTimeout(() => void this.connect().catch(() => this.scheduleAfterFailure()), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    };
  }

  private scheduleAfterFailure(): void {
    setTimeout(() => void this.connect().catch(() => this.scheduleAfterFailure()), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }

  send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ v: 1, ...message }));
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close();
  }
}
