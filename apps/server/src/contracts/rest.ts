import { Type, type TSchema } from '@sinclair/typebox';
import { MatchResultSchema, PlayerEventSchema } from './messages.js';

const strict = { additionalProperties: false } as const;
const Id = Type.String({ description: 'UUID' });
const Timestamp = Type.String({ description: 'Fecha ISO 8601' });

export const ProblemSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer(),
    code: Type.String(),
    instance: Type.String(),
    errors: Type.Optional(Type.Array(Type.Unknown())),
  },
  { ...strict, description: 'RFC 9457 Problem Details (application/problem+json)' },
);

const Ok = Type.Object({ status: Type.String() }, strict);
const Tokens = Type.Object({ accessToken: Type.String(), refreshToken: Type.String(), expiresIn: Type.Integer() }, strict);
const Profile = Type.Object(
  { id: Id, email: Type.String(), displayName: Type.String(), role: Type.String(), balance: Type.Integer(), characterId: Type.String() },
  strict,
);
const Room = Type.Object(
  {
    id: Id,
    visibility: Type.String(),
    status: Type.String(),
    capacity: Type.Integer(),
    ownerId: Id,
    inviteCode: Type.Optional(Type.String({ description: 'Solo para miembros de la sala' })),
    members: Type.Array(Type.Object({ userId: Id, displayName: Type.String(), ready: Type.Boolean() }, strict)),
    matchId: Type.Union([Id, Type.Null()]),
  },
  strict,
);
const Queue = Type.Union([
  Type.Object({ status: Type.Literal('idle') }, strict),
  Type.Object({ status: Type.Literal('timed_out') }, strict),
  Type.Object({ status: Type.Literal('queued'), expiresAt: Timestamp }, strict),
  Type.Object({ status: Type.Literal('matched'), matchId: Id }, strict),
]);
const Cosmetic = Type.Object({ id: Type.String(), name: Type.String(), kind: Type.String(), price: Type.Integer() }, strict);
const Owned = Type.Object({ id: Type.String(), name: Type.String(), kind: Type.String() }, strict);
const Stats = Type.Object(
  {
    played: Type.Integer(),
    wins: Type.Integer(),
    losses: Type.Integer(),
    draws: Type.Integer(),
    level: Type.Integer(),
    xp: Type.Integer(),
    xpInLevel: Type.Integer(),
    xpForNext: Type.Integer(),
  },
  strict,
);
const Story = Type.Object(
  {
    cleared: Type.Integer(),
    levels: Type.Array(
      Type.Object(
        { level: Type.Integer(), monsterId: Type.String(), name: Type.String(), title: Type.String(), weaponId: Type.String(), reward: Type.Integer(), unlocked: Type.Boolean(), cleared: Type.Boolean() },
        strict,
      ),
    ),
  },
  strict,
);
const Page = (item: TSchema) => Type.Object({ items: Type.Array(item) }, strict);
const History = Type.Object(
  {
    total: Type.Integer(),
    items: Type.Array(
      Type.Object(
        { matchId: Id, outcome: Type.String(), reason: Type.String(), rounds: Type.Integer(), endedAt: Timestamp },
        strict,
      ),
    ),
  },
  strict,
);
const Replay = Type.Object(
  { matchId: Id, result: Type.Union([MatchResultSchema, Type.Null()]), events: Type.Array(PlayerEventSchema) },
  strict,
);
const AdminMatch = Type.Object(
  {
    matchId: Id,
    createdAt: Timestamp,
    round: Type.Integer(),
    players: Type.Array(Type.Object({ playerId: Id, connected: Type.Boolean(), hp: Type.Integer() }, strict)),
  },
  strict,
);
const AuditEntry = Type.Object(
  { id: Id, adminId: Id, action: Type.String(), target: Type.String(), details: Type.Unknown(), createdAt: Timestamp },
  strict,
);
const Empty = Type.Null({ description: 'Sin contenido' });

export interface RouteContract {
  readonly tag: string;
  readonly summary: string;
  /** false solo en las rutas públicas. */
  readonly auth: boolean;
  readonly status: number;
  readonly response: TSchema;
  /** Errores posibles además de 400, 429 y 500; 401 se añade a las rutas autenticadas. */
  readonly errors?: readonly number[];
}

function route(
  tag: string,
  summary: string,
  status: number,
  response: TSchema,
  errors: readonly number[] = [],
  auth = true,
): RouteContract {
  return { tag, summary, auth, status, response, errors };
}

/** Toda ruta debe figurar aquí: si falta, el servidor no arranca. Así el contrato no puede quedar atrás. */
export const REST_CONTRACT: Readonly<Record<string, RouteContract>> = {
  'GET /health/live': route('Salud', 'El proceso está vivo', 200, Ok, [], false),
  'GET /health/ready': route('Salud', 'Las dependencias responden', 200, Ok, [503], false),

  'POST /v1/auth/register': route('Usuarios', 'Registrar usuario', 201, Tokens, [409, 503], false),
  'POST /v1/auth/login': route('Usuarios', 'Iniciar sesión', 200, Tokens, [401, 403, 503], false),
  'POST /v1/auth/refresh': route('Usuarios', 'Rotar el refresh token', 200, Tokens, [401, 403], false),
  'POST /v1/auth/logout': route('Usuarios', 'Cerrar sesión', 204, Empty, [], false),
  'GET /v1/me': route('Usuarios', 'Perfil propio', 200, Profile, [403]),
  'POST /v1/me/character': route('Usuarios', 'Elegir personaje; se aplica desde la siguiente partida', 204, Empty, [403]),
  'GET /v1/me/match': route('Partidas', 'Partida activa propia', 200, Type.Object({ matchId: Type.Union([Id, Type.Null()]) }, strict), [403]),
  'GET /v1/me/matches': route('Partidas', 'Historial paginado propio', 200, History, [403]),
  'GET /v1/matches/:matchId/replay': route('Partidas', 'Reproducir una partida terminada propia', 200, Replay, [403, 404, 409]),
  'POST /v1/ws-ticket': route('Tiempo real', 'Pedir un ticket de un solo uso para el WebSocket', 201, Type.Object({ ticket: Type.String(), expiresIn: Type.Integer() }, strict), [403]),

  'POST /v1/rooms': route('Salas', 'Crear sala pública o privada', 201, Room, [403, 409]),
  'GET /v1/rooms': route('Salas', 'Listar salas públicas abiertas', 200, Page(Room), [403]),
  'GET /v1/rooms/:roomId': route('Salas', 'Ver una sala', 200, Room, [403, 404]),
  'POST /v1/rooms/:roomId/join': route('Salas', 'Unirse a una sala pública', 200, Room, [403, 404, 409]),
  'POST /v1/rooms/join-by-code': route('Salas', 'Unirse con código de invitación', 200, Room, [403, 404, 409]),
  'POST /v1/rooms/:roomId/leave': route('Salas', 'Salir de la sala', 204, Empty, [403, 404]),
  'POST /v1/rooms/:roomId/ready': route('Salas', 'Marcarse listo; con todos listos inicia la partida', 200, Room, [403, 404, 409]),

  'POST /v1/matchmaking': route('Emparejamiento', 'Entrar en la cola rápida', 200, Queue, [403, 409]),
  'GET /v1/matchmaking': route('Emparejamiento', 'Estado en la cola, para recuperar tras reconectar', 200, Queue, [403]),
  'DELETE /v1/matchmaking': route('Emparejamiento', 'Salir de la cola', 204, Empty, [403]),

  'GET /v1/shop/catalog': route('Tienda', 'Catálogo de personajes', 200, Page(Cosmetic), [403]),
  'POST /v1/shop/purchases': route(
    'Tienda',
    'Comprar un personaje (exige nivel y dinero); reintentar con el mismo purchaseId no cobra de nuevo',
    200,
    Type.Object({ cosmeticId: Type.String(), balance: Type.Integer(), duplicate: Type.Boolean() }, strict),
    [403, 404, 409],
  ),
  'GET /v1/me/stats': route('Partidas', 'Partidas, victorias, derrotas, empates y nivel propios', 200, Stats, [403]),
  'GET /v1/me/story': route('Partidas', 'Niveles del modo historia y cuáles están desbloqueados', 200, Story, [403]),
  'POST /v1/matches/bot': route('Partidas', 'Empezar un nivel del modo historia contra un monstruo', 201, Type.Object({ matchId: Id, monsterId: Type.String() }, strict), [403, 404, 409]),
  'GET /v1/me/inventory': route('Tienda', 'Personajes comprados', 200, Page(Owned), [403]),

  'GET /v1/admin/matches': route('Administración', 'Partidas activas y conexión de sus jugadores', 200, Page(AdminMatch), [403]),
  'POST /v1/admin/matches/:matchId/terminate': route('Administración', 'Terminar una partida', 204, Empty, [403, 404, 409]),
  'POST /v1/admin/users/:userId/suspend': route('Administración', 'Suspender usuario', 204, Empty, [403, 404, 409]),
  'POST /v1/admin/users/:userId/unsuspend': route('Administración', 'Reactivar usuario', 204, Empty, [403, 404]),
  'GET /v1/admin/audit': route('Administración', 'Registro de auditoría', 200, Page(AuditEntry), [403]),
};

const ALWAYS = [400, 429, 500];

/** Convierte una entrada del contrato en las opciones de esquema de Fastify. */
export function contractSchema(contract: RouteContract): Record<string, unknown> {
  const errors = new Set([...ALWAYS, ...(contract.auth ? [401] : []), ...(contract.errors ?? [])]);
  const response: Record<number, unknown> = {
    [contract.status]:
      contract.status === 204
        ? { type: 'null', description: 'Sin contenido' }
        : { ...contract.response, description: 'Respuesta correcta' },
  };
  for (const status of errors) response[status] = { ...ProblemSchema, description: 'Problem Details (RFC 9457)' };
  return {
    tags: [contract.tag],
    summary: contract.summary,
    ...(contract.auth ? { security: [{ bearerAuth: [] }] } : {}),
    response,
  };
}
