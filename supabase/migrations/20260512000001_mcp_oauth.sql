-- API key for MCP (token-based access)
ALTER TABLE salons ADD COLUMN IF NOT EXISTS mcp_api_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS salons_mcp_api_key_idx ON salons(mcp_api_key) WHERE mcp_api_key IS NOT NULL;

-- OAuth clients (pre-seed Claude.ai)
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id    TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL DEFAULT '{}',
  is_public    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Short-lived authorization codes (PKCE)
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code                   TEXT PRIMARY KEY,
  client_id              TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri           TEXT NOT NULL,
  scope                  TEXT NOT NULL DEFAULT 'read write',
  code_challenge         TEXT,
  code_challenge_method  TEXT DEFAULT 'S256',
  expires_at             TIMESTAMPTZ NOT NULL,
  used_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Access tokens (1 hour)
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT UNIQUE NOT NULL,
  client_id   TEXT NOT NULL REFERENCES oauth_clients(client_id),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL DEFAULT 'read write',
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Refresh tokens (30 days)
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       TEXT UNIQUE NOT NULL,
  access_token_id  UUID REFERENCES oauth_access_tokens(id) ON DELETE SET NULL,
  client_id        TEXT NOT NULL,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: only service role
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Seed Claude.ai
INSERT INTO oauth_clients (client_id, name, redirect_uris, is_public)
VALUES ('claude-ai', 'Claude.ai', ARRAY['https://claude.ai/api/mcp/auth_callback'], true)
ON CONFLICT DO NOTHING;
