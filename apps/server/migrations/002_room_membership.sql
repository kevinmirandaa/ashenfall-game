-- Un usuario solo puede estar en una sala a la vez. Al iniciar la partida se borran los miembros de la sala.
CREATE UNIQUE INDEX room_members_one_room ON room_members (user_id);
CREATE INDEX rooms_open_public ON rooms (created_at) WHERE status = 'open' AND visibility = 'public';
