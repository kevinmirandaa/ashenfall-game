-- Personaje elegido; su arma se deduce de él y el servidor la valida en cada disparo.
ALTER TABLE users ADD COLUMN character_id text NOT NULL DEFAULT 'edrik' CHECK (character_id IN ('edrik', 'sylwen', 'borgrim'));
