-- Shared, database-backed throttling for public authentication endpoints.
-- Key hashes are stored instead of client IP addresses or submitted identifiers.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash CHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key_hash, window_started_at)
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at
  ON auth_rate_limits(updated_at);
