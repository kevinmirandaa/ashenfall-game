CREATE TABLE matchmaking_queue (
  user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX matchmaking_queue_order ON matchmaking_queue (enqueued_at);
