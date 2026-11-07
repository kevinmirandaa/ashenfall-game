-- Modo historia contra monstruos.
-- Los monstruos son usuarios de verdad (sin contraseña) para que partidas, historial y claves foráneas funcionen igual
-- que con humanos; nadie puede iniciar sesión con ellos.
ALTER TABLE users ADD COLUMN is_bot boolean NOT NULL DEFAULT false;
INSERT INTO users (id, email, display_name, password_hash, is_bot) VALUES
  ('00000000-0000-4000-8000-000000000001', 'bot-skeleton@bots.ashenfall.invalid', 'skeleton', '!no-login', true),
  ('00000000-0000-4000-8000-000000000002', 'bot-spider@bots.ashenfall.invalid', 'spider', '!no-login', true),
  ('00000000-0000-4000-8000-000000000003', 'bot-werewolf@bots.ashenfall.invalid', 'werewolf', '!no-login', true),
  ('00000000-0000-4000-8000-000000000004', 'bot-specter@bots.ashenfall.invalid', 'specter', '!no-login', true),
  ('00000000-0000-4000-8000-000000000005', 'bot-witch@bots.ashenfall.invalid', 'witch', '!no-login', true),
  ('00000000-0000-4000-8000-000000000006', 'bot-vampire@bots.ashenfall.invalid', 'vampire', '!no-login', true),
  ('00000000-0000-4000-8000-000000000007', 'bot-treant@bots.ashenfall.invalid', 'treant', '!no-login', true),
  ('00000000-0000-4000-8000-000000000008', 'bot-wraith@bots.ashenfall.invalid', 'wraith', '!no-login', true),
  ('00000000-0000-4000-8000-000000000009', 'bot-dark-knight@bots.ashenfall.invalid', 'dark_knight', '!no-login', true),
  ('00000000-0000-4000-8000-000000000010', 'bot-golem@bots.ashenfall.invalid', 'golem', '!no-login', true);

-- Un bot puede estar en varias partidas a la vez; los humanos, solo en una.
ALTER TABLE match_players ADD COLUMN is_bot boolean NOT NULL DEFAULT false;
DROP INDEX match_players_one_active;
CREATE UNIQUE INDEX match_players_one_active ON match_players (user_id) WHERE active AND NOT is_bot;

-- pvp: dos humanos; story: nivel del modo historia contra un monstruo.
ALTER TABLE matches ADD COLUMN mode text NOT NULL DEFAULT 'pvp' CHECK (mode IN ('pvp', 'story'));
ALTER TABLE matches ADD COLUMN monster_id text;
ALTER TABLE matches ADD COLUMN reward integer NOT NULL DEFAULT 100 CHECK (reward >= 0);
-- Instante a partir del cual le toca mover al bot. Vive en la base para que cualquier réplica lo retome tras un reinicio.
ALTER TABLE matches ADD COLUMN bot_due_ms bigint;
CREATE INDEX matches_bot_due ON matches (bot_due_ms) WHERE status = 'in_progress' AND bot_due_ms IS NOT NULL;

CREATE TABLE story_progress (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  cleared integer NOT NULL DEFAULT 0 CHECK (cleared >= 0)
);
