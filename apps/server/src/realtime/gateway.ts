import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { toPlayerEvent, toPlayerView, type MatchErrorCode } from '@ashenfall/domain';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { WebSocket, WebSocketServer } from 'ws';
import { MatchEngine, MatchNotFoundError, type PublishedEvent } from '../matches/match-engine.js';
import { activeMatchOf } from '../matches/start.js';
import {
  CloseCode,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from './protocol.js';
import type { WsTicketStore } from './tickets.js';

export interface GatewayOptions {
  readonly allowedOrigins: readonly string[];
  readonly heartbeatMs?: number;
  readonly maxConnectionsPerUser?: number;
  readonly maxMessagesPerSecond?: number;
}

interface Connection {
  readonly socket: WebSocket;
  readonly userId: string;
  alive: boolean;
  windowStartMs: number;
  messagesInWindow: number;
}

/** A partir de este múltiplo del límite se deja de avisar y se cierra la conexión. */
const RATE_LIMIT_CLOSE_FACTOR = 3;

export class RealtimeGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private readonly connections = new Map<string, Set<Connection>>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly maxConnectionsPerUser: number;
  private readonly maxMessagesPerSecond: number;

  constructor(
    private readonly server: Server,
    private readonly pool: pg.Pool,
    private readonly engineRef: () => MatchEngine,
    private readonly tickets: WsTicketStore,
    private readonly logger: FastifyBaseLogger,
    private readonly options: GatewayOptions,
  ) {
    this.maxConnectionsPerUser = options.maxConnectionsPerUser ?? 3;
    this.maxMessagesPerSecond = options.maxMessagesPerSecond ?? 20;
    this.server.on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => this.checkHeartbeats(), options.heartbeatMs ?? 15_000);
    this.heartbeat.unref();
  }

  /** Reparte eventos confirmados: cada jugador recibe su propia proyección. */
  deliver(matchId: string, events: readonly PublishedEvent[]): void {
    for (const { event, stateAfter } of events) {
      for (const { playerId } of stateAfter.players) {
        const playerEvent = toPlayerEvent(event, stateAfter, playerId);
        if (playerEvent === null) continue;
        this.sendToUser(playerId, { v: PROTOCOL_VERSION, type: 'event', matchId, event: playerEvent });
      }
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.server.off('upgrade', this.onUpgrade);
    for (const group of this.connections.values()) {
      for (const connection of group) connection.socket.close(CloseCode.GoingAway, 'El servidor se está apagando');
    }
    this.wss.close();
  }

  private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    void this.authenticateUpgrade(request, socket, head).catch((error: unknown) => {
      this.logger.error({ err: error }, 'Fallo en el handshake de WebSocket');
      this.reject(socket, '500 Internal Server Error');
    });
  };

  private async authenticateUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      this.reject(socket, '404 Not Found');
      return;
    }
    // Sin cabecera Origin no hay navegador que proteger; el ticket sigue siendo obligatorio.
    const { origin } = request.headers;
    if (origin !== undefined && !this.options.allowedOrigins.includes(origin)) {
      this.reject(socket, '403 Forbidden');
      return;
    }
    const ticket = url.searchParams.get('ticket');
    const userId = ticket === null ? null : await this.tickets.consume(ticket);
    if (userId === null) {
      this.reject(socket, '401 Unauthorized');
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.accept(ws, userId);
    });
  }

  private reject(socket: Duplex, status: string): void {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  private accept(socket: WebSocket, userId: string): void {
    const group = this.connections.get(userId) ?? new Set<Connection>();
    if (group.size >= this.maxConnectionsPerUser) {
      socket.close(CloseCode.TooManyConnections, 'Demasiadas conexiones');
      return;
    }
    const connection: Connection = { socket, userId, alive: true, windowStartMs: Date.now(), messagesInWindow: 0 };
    group.add(connection);
    this.connections.set(userId, group);

    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('close', () => {
      group.delete(connection);
      if (group.size === 0 && this.connections.get(userId) === group) this.connections.delete(userId);
    });
    // Un error de socket afecta solo a esa conexión; sin este oyente tumbaría el proceso.
    socket.on('error', (error) => {
      this.logger.warn({ err: error, userId }, 'Error en conexión WebSocket');
    });
    socket.on('message', (data, isBinary) => {
      if (!this.withinRateLimit(connection)) return;
      if (isBinary) {
        this.send(socket, { v: PROTOCOL_VERSION, type: 'error', code: 'INVALID_MESSAGE' });
        return;
      }
      const message = parseClientMessage(data.toString());
      if (message === null) {
        this.send(socket, { v: PROTOCOL_VERSION, type: 'error', code: 'INVALID_MESSAGE' });
        return;
      }
      void this.handle(connection, message).catch((error: unknown) => {
        this.logger.error({ err: error, userId, matchId: message.matchId }, 'Error procesando mensaje');
        this.send(socket, {
          v: PROTOCOL_VERSION,
          type: 'error',
          code: 'INTERNAL_ERROR',
          ...(message.type === 'shoot' ? { actionId: message.actionId } : {}),
        });
      });
    });

    this.send(socket, { v: PROTOCOL_VERSION, type: 'welcome', userId });
    void this.sendActiveSnapshot(connection).catch((error: unknown) => {
      this.logger.error({ err: error, userId }, 'Error enviando el estado inicial');
    });
  }

  private async sendActiveSnapshot(connection: Connection): Promise<void> {
    const matchId = await activeMatchOf(this.pool, connection.userId);
    if (matchId !== null) await this.sendSnapshot(connection, matchId);
  }

  private async sendSnapshot(connection: Connection, matchId: string): Promise<boolean> {
    let view;
    try {
      view = toPlayerView(await this.engineRef().state(matchId), connection.userId);
    } catch (error) {
      if (error instanceof MatchNotFoundError) view = null;
      else throw error;
    }
    if (view === null) return false;
    this.send(connection.socket, { v: PROTOCOL_VERSION, type: 'snapshot', view });
    return true;
  }

  private async handle(connection: Connection, message: ClientMessage): Promise<void> {
    const { socket, userId } = connection;
    if (message.type === 'sync') {
      if (!(await this.sendSnapshot(connection, message.matchId))) {
        this.send(socket, { v: PROTOCOL_VERSION, type: 'error', code: 'MATCH_NOT_FOUND' });
      }
      return;
    }

    const { actionId } = message;
    let decision;
    try {
      decision = await this.engineRef().execute(message.matchId, {
        type: 'shoot',
        playerId: userId,
        actionId,
        expectedVersion: message.expectedVersion,
        weaponId: message.weaponId,
        angleDeg: message.angleDeg,
        power: message.power,
        nowMs: Date.now(),
      });
    } catch (error) {
      if (!(error instanceof MatchNotFoundError)) throw error;
      this.send(socket, { v: PROTOCOL_VERSION, type: 'error', code: 'MATCH_NOT_FOUND', actionId });
      return;
    }

    switch (decision.kind) {
      case 'applied':
        this.send(socket, { v: PROTOCOL_VERSION, type: 'ack', actionId, seq: decision.events[0]?.seq ?? 0, duplicate: false });
        return;
      case 'duplicate':
        this.send(socket, { v: PROTOCOL_VERSION, type: 'ack', actionId, seq: decision.seq, duplicate: true });
        return;
      case 'rejected':
        this.send(socket, { v: PROTOCOL_VERSION, type: 'error', code: publicCode(decision.code), actionId });
    }
  }

  private withinRateLimit(connection: Connection): boolean {
    const now = Date.now();
    if (now - connection.windowStartMs >= 1000) {
      connection.windowStartMs = now;
      connection.messagesInWindow = 0;
    }
    connection.messagesInWindow += 1;
    if (connection.messagesInWindow <= this.maxMessagesPerSecond) return true;
    if (connection.messagesInWindow > this.maxMessagesPerSecond * RATE_LIMIT_CLOSE_FACTOR) {
      connection.socket.close(CloseCode.RateLimited, 'Demasiados mensajes');
    } else {
      this.send(connection.socket, { v: PROTOCOL_VERSION, type: 'error', code: 'RATE_LIMITED' });
    }
    return false;
  }

  private checkHeartbeats(): void {
    for (const group of this.connections.values()) {
      for (const connection of group) {
        if (!connection.alive) {
          connection.socket.close(CloseCode.HeartbeatLost, 'Sin respuesta al heartbeat');
          connection.socket.terminate();
          continue;
        }
        connection.alive = false;
        connection.socket.ping();
      }
    }
  }

  private sendToUser(userId: string, message: ServerMessage): void {
    for (const connection of this.connections.get(userId) ?? []) this.send(connection.socket, message);
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}

/** Quien no participa recibe lo mismo que si la partida no existiera. */
function publicCode(code: MatchErrorCode): string {
  return code === 'NOT_A_PARTICIPANT' ? 'MATCH_NOT_FOUND' : code;
}
