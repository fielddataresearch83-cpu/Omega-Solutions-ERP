-- Server-side refresh-token families support single-use rotation, reuse detection, and logout revocation.
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  jti UUID PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_family_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_family ON auth_refresh_tokens(token_family_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user ON auth_refresh_tokens(user_id, created_at DESC);