import { CLIENT_MESSAGES, CloseCode, MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from '../realtime/protocol.js';
import { serverMessages, WS_ERROR_CODES } from './messages.js';

const MATCH = '6f1c2f5e-3a54-4a7e-9b1d-2c8f0a4e7d11';
const ACTION = '0b9a7c3e-52d1-4f60-8a2b-7e1d3c5f9a22';
const USER = 'c4e8a1d2-7b36-49f0-a5c3-1f2e6d8b0a33';

const CLOSE_CODES = [
  { code: CloseCode.GoingAway, meaning: 'El servidor se apaga; reconectar con un ticket nuevo' },
  { code: 1009, meaning: `Mensaje mayor a ${MAX_MESSAGE_BYTES} bytes` },
  { code: CloseCode.Suspended, meaning: 'Usuario suspendido' },
  { code: CloseCode.TooManyConnections, meaning: 'Demasiadas conexiones de este usuario' },
  { code: CloseCode.HeartbeatLost, meaning: 'No respondió al ping del heartbeat' },
  { code: CloseCode.RateLimited, meaning: 'Abuso sostenido del límite de mensajes' },
];

const clientExamples: Record<keyof typeof CLIENT_MESSAGES, unknown> = {
  shoot: { v: 1, type: 'shoot', matchId: MATCH, actionId: ACTION, expectedVersion: 3, weaponId: 'dagger', angleDeg: 42.5, power: 70 },
  use_potion: { v: 1, type: 'use_potion', matchId: MATCH, actionId: ACTION, expectedVersion: 3, potionId: 'vital' },
  sync: { v: 1, type: 'sync', matchId: MATCH },
};

const serverExamples: Record<keyof typeof serverMessages, unknown> = {
  welcome: { v: 1, type: 'welcome', userId: USER },
  snapshot: {
    v: 1,
    type: 'snapshot',
    view: {
      matchId: MATCH,
      status: 'in_progress',
      seq: 3,
      version: 3,
      arenaId: 'frozen_bridge',
      windAccel: -40,
      maxRounds: 12,
      round: 1,
      physicsVersion: 4,
      turn: { playerId: USER, round: 1, deadlineMs: 1793906164944 },
      you: { playerId: USER, hp: 100, position: { x: 450, y: 0 }, facing: 1, connected: true, characterId: 'edrik', displayName: 'Edrik', weaponId: 'dagger', buffs: { ward: false, fury: true, focus: false }, potions: ['vital', 'ward'] },
      opponent: { playerId: ACTION, hp: 78, position: { x: 1550, y: 0 }, facing: -1, connected: true, characterId: 'skeleton', displayName: 'Esqueleto guerrero', weaponId: 'bow', buffs: { ward: false, fury: false, focus: false } },
      result: null,
    },
  },
  event: {
    v: 1,
    type: 'event',
    matchId: MATCH,
    event: { seq: 4, atMs: 1793906140000, payload: { type: 'turn_started', playerId: USER, round: 2, deadlineMs: 1793906170000 } },
  },
  ack: { v: 1, type: 'ack', actionId: ACTION, seq: 4, duplicate: false },
  error: { v: 1, type: 'error', code: 'NOT_YOUR_TURN', actionId: ACTION },
};

const messageDescriptions: Record<string, string> = {
  shoot: 'Intención de disparo. Nunca incluye daño ni resultados. Reenviar el mismo actionId no lo aplica dos veces. Errores posibles: ver el mensaje error.',
  use_potion: 'Usa una poción de las que llevas a la partida. Ocupa el turno y solo vale con tu turno y tu versión; el servidor comprueba que la llevas. Errores posibles: ver el mensaje error.',
  sync: 'Pide el estado actual, por ejemplo al detectar un hueco en seq.',
  welcome: 'Primer mensaje tras autenticar la conexión.',
  snapshot: 'Estado autorizado de la partida para este jugador, también al reconectar.',
  event: 'Evento confirmado en PostgreSQL. seq crece sin huecos por partida; el orden de llegada frente al ack no está garantizado.',
  ack: 'La jugada quedó confirmada, o ya lo estaba si duplicate es true.',
  error: `Rechazo tipado que no cierra la conexión. Códigos: ${WS_ERROR_CODES.join(', ')}.`,
};

function message(name: string, payload: unknown, example: unknown): Record<string, unknown> {
  return {
    name,
    contentType: 'application/json',
    description: messageDescriptions[name],
    payload,
    examples: [{ name: 'ejemplo', payload: example }],
  };
}

export function buildAsyncApi(): Record<string, unknown> {
  const client = Object.entries(CLIENT_MESSAGES).map(([name, schema]) => [
    name,
    message(name, schema, clientExamples[name as keyof typeof CLIENT_MESSAGES]),
  ]);
  const server = Object.entries(serverMessages).map(([name, schema]) => [
    name,
    message(name, schema, serverExamples[name as keyof typeof serverMessages]),
  ]);
  const ref = (name: string) => ({ $ref: `#/channels/game/messages/${name}` });
  const channelRef = (name: string) => ({ $ref: `#/components/messages/${name}` });
  return {
    asyncapi: '3.0.0',
    info: {
      title: 'ASHENFALL tiempo real',
      version: `${PROTOCOL_VERSION}.0.0`,
      description: [
        `Protocolo versión ${PROTOCOL_VERSION}, campo v en cada mensaje. Tamaño máximo por mensaje: ${MAX_MESSAGE_BYTES} bytes.`,
        'Autenticación en el handshake con un ticket de un solo uso de POST /v1/ws-ticket; sin ticket válido responde 401 y con origen no permitido 403.',
        'Heartbeat: el servidor envía ping y cierra si no recibe pong antes del siguiente.',
        `Códigos de cierre: ${CLOSE_CODES.map(({ code, meaning }) => `${String(code)} ${meaning}`).join('; ')}.`,
      ].join('\n\n'),
    },
    servers: {
      production: {
        host: 'ashenfall.example',
        protocol: 'wss',
        description: 'El host real se define al desplegar.',
        security: [{ $ref: '#/components/securitySchemes/ticket' }],
      },
    },
    channels: {
      game: {
        address: '/ws',
        messages: Object.fromEntries([...client, ...server].map(([name]) => [name as string, channelRef(name as string)])),
      },
    },
    operations: {
      sendToServer: {
        action: 'receive',
        channel: { $ref: '#/channels/game' },
        summary: 'Mensajes que el cliente envía',
        messages: client.map(([name]) => ref(name as string)),
      },
      sendToClient: {
        action: 'send',
        channel: { $ref: '#/channels/game' },
        summary: 'Mensajes que el servidor envía',
        messages: server.map(([name]) => ref(name as string)),
      },
    },
    components: {
      messages: Object.fromEntries([...client, ...server] as [string, unknown][]),
      securitySchemes: {
        ticket: { type: 'httpApiKey', name: 'ticket', in: 'query', description: 'Ticket de un solo uso, válido 30 s' },
      },
    },
    'x-close-codes': CLOSE_CODES,
  };
}
