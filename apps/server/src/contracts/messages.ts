import { ARENA_IDS, CHARACTER_IDS, WEAPON_IDS } from '@ashenfall/domain';
import { Type, type TSchema } from '@sinclair/typebox';

const strict = { additionalProperties: false } as const;

function literalUnion(values: readonly string[]): TSchema {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

const Id = Type.String({ description: 'UUID' });
const Point = Type.Object({ x: Type.Number(), y: Type.Number() }, strict);

export const MatchResultSchema = Type.Object(
  {
    winnerId: Type.Union([Id, Type.Null()]),
    loserId: Type.Union([Id, Type.Null()]),
    reason: literalUnion(['knockout', 'round_limit', 'timeout_forfeit', 'disconnect_forfeit', 'both_abandoned', 'admin_terminated']),
    finalHp: Type.Array(Type.Integer(), { minItems: 2, maxItems: 2 }),
    rounds: Type.Integer(),
  },
  strict,
);

const Side = Type.Object(
  {
    playerId: Id,
    hp: Type.Integer(),
    position: Point,
    facing: Type.Union([Type.Literal(1), Type.Literal(-1)]),
    connected: Type.Boolean(),
    characterId: literalUnion(CHARACTER_IDS),
    weaponId: literalUnion(WEAPON_IDS),
    displayName: Type.String(),
  },
  strict,
);

const Turn = Type.Object({ playerId: Id, round: Type.Integer(), deadlineMs: Type.Number() }, strict);

export const PlayerMatchViewSchema = Type.Object(
  {
    matchId: Id,
    status: literalUnion(['in_progress', 'finished']),
    seq: Type.Integer(),
    version: Type.Integer(),
    arenaId: literalUnion(ARENA_IDS),
    windAccel: Type.Number(),
    maxRounds: Type.Integer(),
    round: Type.Integer(),
    physicsVersion: Type.Integer(),
    turn: Type.Union([Turn, Type.Null()]),
    you: Side,
    opponent: Side,
    result: Type.Union([MatchResultSchema, Type.Null()]),
  },
  strict,
);

const eventPayloads = [
  Type.Object({ type: Type.Literal('match_started'), view: PlayerMatchViewSchema }, strict),
  Type.Object(
    {
      type: Type.Literal('shot_resolved'),
      shooterId: Id,
      weaponId: literalUnion(WEAPON_IDS),
      impactKind: literalUnion(['player', 'obstacle', 'ground', 'out_of_bounds']),
      impact: Point,
      flightMs: Type.Integer(),
      path: Type.Array(Point),
      damage: Type.Integer(),
      zone: Type.Union([literalUnion(['head', 'body', 'legs']), Type.Null()]),
      targetHpAfter: Type.Integer(),
      effect: Type.Union([
        Type.Object({ kind: literalUnion(['poison', 'burn']), perSecond: Type.Integer(), seconds: Type.Integer() }, { ...strict, description: 'Veneno o fuego del arma; ya descontado de targetHpAfter' }),
        Type.Null(),
      ]),
      targetPosition: Point,
      own: Type.Optional(
        Type.Object({ actionId: Id, angleDeg: Type.Number(), power: Type.Number() }, { ...strict, description: 'Solo lo recibe quien disparó' }),
      ),
    },
    strict,
  ),
  Type.Object({ type: Type.Literal('turn_timed_out'), playerId: Id }, strict),
  Type.Object({ type: Type.Literal('turn_started'), playerId: Id, round: Type.Integer(), deadlineMs: Type.Number() }, strict),
  Type.Object({ type: Type.Literal('player_disconnected'), playerId: Id, graceDeadlineMs: Type.Number() }, strict),
  Type.Object({ type: Type.Literal('player_reconnected'), playerId: Id }, strict),
  Type.Object({ type: Type.Literal('match_finished'), result: MatchResultSchema }, strict),
];

export const PlayerEventSchema = Type.Object(
  { seq: Type.Integer({ minimum: 1 }), atMs: Type.Number(), payload: Type.Union(eventPayloads) },
  strict,
);

export const WS_ERROR_CODES = [
  'INVALID_MESSAGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'MATCH_NOT_FOUND',
  'MATCH_FINISHED',
  'NOT_YOUR_TURN',
  'STALE_VERSION',
  'TURN_EXPIRED',
  'INVALID_WEAPON',
  'INVALID_ANGLE',
  'INVALID_POWER',
  'ACTION_ID_CONFLICT',
] as const;

const v = Type.Literal(1);

export const serverMessages = {
  welcome: Type.Object({ v, type: Type.Literal('welcome'), userId: Id }, strict),
  snapshot: Type.Object({ v, type: Type.Literal('snapshot'), view: PlayerMatchViewSchema }, strict),
  event: Type.Object({ v, type: Type.Literal('event'), matchId: Id, event: PlayerEventSchema }, strict),
  ack: Type.Object({ v, type: Type.Literal('ack'), actionId: Id, seq: Type.Integer(), duplicate: Type.Boolean() }, strict),
  error: Type.Object({ v, type: Type.Literal('error'), code: literalUnion(WS_ERROR_CODES), actionId: Type.Optional(Id) }, strict),
} as const;

export const ServerMessageSchema = Type.Union(Object.values(serverMessages));
