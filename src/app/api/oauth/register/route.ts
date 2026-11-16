import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Dynamic client registration (RFC 7591), which Claude, ChatGPT and other MCP clients use to get a client_id.
// Public clients only (PKCE, no secret); redirect URIs must be https, or http on localhost for desktop apps.

function validRedirect(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 500) return false;
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every(validRedirect)) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https (or http on localhost)' },
      { status: 400 },
    );
  }
  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'MCP client';
  const clientId = `mcp_${crypto.randomUUID().replace(/-/g, '')}`;

  const { error } = await createAdminClient()
    .from('oauth_clients')
    .insert({ client_id: clientId, name, redirect_uris: redirectUris, is_public: true });
  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201 },
  );
}
