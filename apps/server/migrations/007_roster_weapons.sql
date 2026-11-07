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
  ('wpn-dagger-2', 'Daga dentada', 'weapon_dagger', 600),
  ('wpn-dagger-3', 'Daga curva ponzoñosa', 'weapon_dagger', 1600),
  ('wpn-dagger-4', 'Daga del nigromante', 'weapon_dagger', 2800),
  ('wpn-bow-2', 'Arco recurvo', 'weapon_bow', 600),
  ('wpn-bow-3', 'Arco de hueso ardiente', 'weapon_bow', 1700),
  ('wpn-bow-4', 'Arco carmesí', 'weapon_bow', 2900),
  ('wpn-crossbow-2', 'Ballesta de guerra', 'weapon_crossbow', 650),
  ('wpn-crossbow-3', 'Ballesta de espinas', 'weapon_crossbow', 1800),
  ('wpn-crossbow-4', 'Ballesta del cazador', 'weapon_crossbow', 3000),
  ('wpn-axe-2', 'Hacha de guerra', 'weapon_axe', 700),
  ('wpn-axe-3', 'Hacha de verdugo', 'weapon_axe', 2000),
  ('wpn-axe-4', 'Hacha del destino', 'weapon_axe', 3200),
  ('wpn-sword-2', 'Espada de acero', 'weapon_sword', 650),
  ('wpn-sword-3', 'Espada rúnica', 'weapon_sword', 1900),
  ('wpn-sword-4', 'Espada real', 'weapon_sword', 3000),
  ('wpn-staff-2', 'Cometa de escarcha', 'weapon_staff', 700),
  ('wpn-staff-3', 'Llama venenosa', 'weapon_staff', 1700),
  ('wpn-staff-4', 'Bola infernal', 'weapon_staff', 2800),
  ('wpn-flask-2', 'Frasco de hielo', 'weapon_flask', 600),
  ('wpn-flask-3', 'Frasco de peste', 'weapon_flask', 1600),
  ('wpn-flask-4', 'Fuego líquido', 'weapon_flask', 2700),
  ('wpn-mace-2', 'Maza de hierro', 'weapon_mace', 650),
  ('wpn-mace-3', 'Maza de gema', 'weapon_mace', 1900),
  ('wpn-mace-4', 'Maza maldita', 'weapon_mace', 3000);
