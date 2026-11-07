-- Personajes y armas comprables, y limpieza de los cosméticos que dejan de existir.
-- Personajes: se empieza solo con el inicial; el resto se compra. Armas: cada una pertenece a una familia
-- (kind weapon_<familia>) y solo puede haber una equipada por familia. Los precios replican a los del dominio y una prueba los compara.
DELETE FROM player_cosmetics WHERE cosmetic_id IN (SELECT id FROM cosmetic_catalog WHERE kind IN ('weapon_skin', 'character_skin'));
DELETE FROM cosmetic_catalog WHERE kind IN ('weapon_skin', 'character_skin');
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
  ('char-rurik', 'Rurik', 'character', 800),
  ('wpn-dagger-2', 'Daga templada', 'weapon_dagger', 600),
  ('wpn-dagger-3', 'Daga ponzoñosa', 'weapon_dagger', 1500),
  ('wpn-bow-2', 'Arco largo', 'weapon_bow', 600),
  ('wpn-bow-3', 'Arco de brasas', 'weapon_bow', 1500),
  ('wpn-crossbow-2', 'Ballesta de guerra', 'weapon_crossbow', 600),
  ('wpn-crossbow-3', 'Ballesta de espinas', 'weapon_crossbow', 1500),
  ('wpn-axe-2', 'Hacha de guerra', 'weapon_axe', 600),
  ('wpn-axe-3', 'Hacha ardiente', 'weapon_axe', 2000),
  ('wpn-sword-2', 'Espada de acero', 'weapon_sword', 600),
  ('wpn-sword-3', 'Espada de fuego', 'weapon_sword', 1750),
  ('wpn-staff-2', 'Orbe de sombra', 'weapon_staff', 600),
  ('wpn-staff-3', 'Orbe venenoso', 'weapon_staff', 1750),
  ('wpn-flask-2', 'Frasco corrosivo', 'weapon_flask', 600),
  ('wpn-flask-3', 'Frasco de fuego líquido', 'weapon_flask', 1750),
  ('wpn-mace-2', 'Maza de hierro', 'weapon_mace', 600),
  ('wpn-mace-3', 'Maza bendita', 'weapon_mace', 1500);
