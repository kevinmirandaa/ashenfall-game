import { ANGLE_RANGE, POWER_RANGE, WEAPON_IDS, type PlayerEvent, type PlayerMatchView } from '@ashenfall/domain';
import { Type, type Static } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 4 * 1024;

/** Códigos de cierre propios, además de 1001 (el servidor se apaga) y 1009 (mensaje demasiado grande). */
export const CloseCode = {
  GoingAway: 1001,
  HeartbeatLost: 4009,
  TooManyConnections: 4008,
  RateLimited: 4029,
} as const;

const Uuid = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' });

const Shoot = Type.Object(
  {
    v: Type.Literal(PROTOCOL_VERSION),
    type: Type.Literal('shoot'),
    matchId: Uuid,
    actionId: Uuid,
    expectedVersion: Type.Integer({ minimum: 1 }),
    weaponId: Type.Union(WEAPON_IDS.map((id) => Type.Literal(id))),
    angleDeg: Type.Number({ minimum: ANGLE_RANGE.min, maximum: ANGLE_RANGE.max }),
    power: Type.Number({ minimum: POWER_RANGE.min, maximum: POWER_RANGE.max }),
  },
  { additionalProperties: false },
);

const Sync = Type.Object(
  { v: Type.Literal(PROTOCOL_VERSION), type: Type.Literal('sync'), matchId: Uuid },
  { additionalProperties: false },
);

const ClientMessageSchema = Type.Union([Shoot, Sync]);
export type ClientMessage = Static<typeof ClientMessageSchema>;

const validator = TypeCompiler.Compile(ClientMessageSchema);

/** Devuelve el mensaje validado, o null si no cumple el esquema. Nada inválido llega al dominio. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validator.Check(parsed) ? parsed : null;
}

export type ServerMessage =
  | { readonly v: 1; readonly type: 'welcome'; readonly userId: string }
  | { readonly v: 1; readonly type: 'snapshot'; readonly view: PlayerMatchView }
  | { readonly v: 1; readonly type: 'event'; readonly matchId: string; readonly event: PlayerEvent }
  | { readonly v: 1; readonly type: 'ack'; readonly actionId: string; readonly seq: number; readonly duplicate: boolean }
  | { readonly v: 1; readonly type: 'error'; readonly code: string; readonly actionId?: string };
