import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sha256hex } from '@/lib/mcp/auth';

async function base64urlSha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: Request) {
  let body: Record<string, string>;
  const ct = request.headers.get('content-type') ?? '';

  if (ct.includes('application/json')) {
    body = await request.json();
  } else {
    const form = await request.formData();
    body = Object.fromEntries([...form.entries()].map(([k, v]) => [k, v.toString()]));
  }

  const grantType = body.grant_type;
  const admin = createAdminClient();

  // ── authorization_code ────────────────────────────────────────────────────
  if (grantType === 'authorization_code') {
    const { code, redirect_uri, client_id, code_verifier } = body;

    const { data: authCode } = await admin
      .from('oauth_authorization_codes')
      .select('*')
      .eq('code', code)
      .eq('client_id', client_id)
      .eq('redirect_uri', redirect_uri)
      .is('used_at', null)
      .maybeSingle();

    if (!authCode) return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
    if (new Date(authCode.expires_at) <= new Date()) return NextResponse.json({ error: 'invalid_grant', error_description: 'Code expired' }, { status: 400 });

    // PKCE verification: a code issued with a challenge needs its verifier
    if (authCode.code_challenge) {
      const computed = code_verifier ? await base64urlSha256(code_verifier) : '';
      if (computed !== authCode.code_challenge) {
        return NextResponse.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, { status: 400 });
      }
    }

    // Mark code as used
    await admin.from('oauth_authorization_codes').update({ used_at: new Date().toISOString() }).eq('code', code);

    // Issue tokens
    const accessToken  = generateToken();
    const refreshToken = generateToken();
    const accessExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
    const refreshExpiry = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    const { data: tokenRow } = await admin
      .from('oauth_access_tokens')
      .insert({ token_hash: await sha256hex(accessToken), client_id, user_id: authCode.user_id, scope: authCode.scope, expires_at: accessExpiry })
      .select('id').single();

    await admin.from('oauth_refresh_tokens').insert({ token_hash: await sha256hex(refreshToken), access_token_id: tokenRow?.id ?? null, client_id, user_id: authCode.user_id, expires_at: refreshExpiry });

    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: authCode.scope,
    });
  }

  // ── refresh_token ─────────────────────────────────────────────────────────
  if (grantType === 'refresh_token') {
    const { refresh_token, client_id } = body;
    if (!refresh_token || !client_id) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    const tokenHash = await sha256hex(refresh_token);

    const { data: rt } = await admin
      .from('oauth_refresh_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .eq('client_id', client_id)
      .maybeSingle();

    if (!rt || new Date(rt.expires_at) <= new Date()) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
    }

    const newAccessToken = generateToken();
    const newExpiry = new Date(Date.now() + 3600 * 1000).toISOString();

    const { data: tokenRow } = await admin
      .from('oauth_access_tokens')
      .insert({ token_hash: await sha256hex(newAccessToken), client_id, user_id: rt.user_id, scope: 'read write', expires_at: newExpiry })
      .select('id').single();

    // Rotate refresh token
    const newRefreshToken = generateToken();
    const newRefreshExpiry = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await admin.from('oauth_refresh_tokens').delete().eq('token_hash', tokenHash);
    await admin.from('oauth_refresh_tokens').insert({ token_hash: await sha256hex(newRefreshToken), access_token_id: tokenRow?.id ?? null, client_id, user_id: rt.user_id, expires_at: newRefreshExpiry });

    return NextResponse.json({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: 'read write',
    });
  }

  return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
}
