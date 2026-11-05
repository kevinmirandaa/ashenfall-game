CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  suspended_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- Solo se guarda el hash del token. family_id permite revocar toda la cadena si se reutiliza un token ya rotado.
CREATE TABLE refresh_tokens (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id  uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family ON refresh_tokens (family_id);

CREATE TABLE matches (
  id         uuid PRIMARY KEY,
  status     text NOT NULL CHECK (status IN ('in_progress', 'finished')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz
);
CREATE INDEX matches_active ON matches (status) WHERE status = 'in_progress';

CREATE TABLE match_players (
  match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users (id),
  active   boolean NOT NULL DEFAULT true,
  PRIMARY KEY (match_id, user_id)
);
-- Un jugador nunca queda asignado a dos partidas activas: lo garantiza la base de datos.
CREATE UNIQUE INDEX match_players_one_active ON match_players (user_id) WHERE active;

-- Log de eventos append-only. La clave primaria impide que dos réplicas confirmen la misma secuencia.
CREATE TABLE match_events (
  match_id uuid   NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  seq      integer NOT NULL CHECK (seq > 0),
  at_ms    bigint NOT NULL,
  payload  jsonb  NOT NULL,
  PRIMARY KEY (match_id, seq)
);

CREATE TABLE match_results (
  match_id  uuid PRIMARY KEY REFERENCES matches (id),
  winner_id uuid REFERENCES users (id),
  loser_id  uuid REFERENCES users (id),
  reason    text NOT NULL,
  result    jsonb NOT NULL,
  ended_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rooms (
  id          uuid PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES users (id),
  visibility  text NOT NULL CHECK (visibility IN ('public', 'private')),
  invite_code text UNIQUE,
  capacity    integer NOT NULL DEFAULT 2 CHECK (capacity >= 2),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'started', 'closed')),
  match_id    uuid REFERENCES matches (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_members (
  room_id uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  ready   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE wallets (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0)
);

-- idempotency_key única: una recompensa o compra reintentada no se aplica dos veces.
CREATE TABLE wallet_transactions (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users (id),
  amount          integer NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('match_reward', 'purchase')),
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cosmetic_catalog (
  id    text PRIMARY KEY,
  name  text NOT NULL,
  kind  text NOT NULL,
  price integer NOT NULL CHECK (price >= 0)
);

CREATE TABLE player_cosmetics (
  user_id     uuid NOT NULL REFERENCES users (id),
  cosmetic_id text NOT NULL REFERENCES cosmetic_catalog (id),
  equipped    boolean NOT NULL DEFAULT false,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cosmetic_id)
);

CREATE TABLE admin_audit_logs (
  id         uuid PRIMARY KEY,
  admin_id   uuid NOT NULL REFERENCES users (id),
  action     text NOT NULL,
  target     text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
