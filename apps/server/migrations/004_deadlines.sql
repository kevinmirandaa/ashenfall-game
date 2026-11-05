-- Próximo plazo de la partida (turno o gracia). Vive aquí para que cualquier réplica lo retome tras un reinicio.
ALTER TABLE matches ADD COLUMN next_deadline_ms bigint;
CREATE INDEX matches_next_deadline ON matches (next_deadline_ms) WHERE status = 'in_progress';
