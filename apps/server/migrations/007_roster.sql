-- La tienda solo vende personajes. Se empieza con uno; el resto se compra con nivel y dinero.
-- Los precios replican a los del dominio y una prueba los compara; el nivel mínimo vive en el dominio.
DELETE FROM player_cosmetics;
DELETE FROM cosmetic_catalog;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_character_id_check;
ALTER TABLE users ADD CONSTRAINT users_character_id_check CHECK (character_id IN ('edrik', 'sylwen', 'borgrim', 'aldric', 'vaela', 'corvus', 'anselmo', 'mirelle', 'morveth', 'rurik'));
INSERT INTO cosmetic_catalog (id, name, kind, price) VALUES
  ('char-sylwen', 'Sylwen', 'character', 500),
  ('char-borgrim', 'Borgrim', 'character', 600),
  ('char-aldric', 'Aldric', 'character', 700),
  ('char-vaela', 'Vaela', 'character', 900),
  ('char-corvus', 'Corvus', 'character', 1000),
  ('char-anselmo', 'Anselmo', 'character', 900),
  ('char-mirelle', 'Mirelle', 'character', 700),
  ('char-morveth', 'Morveth', 'character', 1200),
  ('char-rurik', 'Rurik', 'character', 800);
