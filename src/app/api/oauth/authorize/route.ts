import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/** For values put into the consent page's HTML: state and the rest come from the client. */
function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── GET — show consent page ────────────────────────────────────────────────
export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId      = url.searchParams.get('client_id') ?? '';
  const redirectUri   = url.searchParams.get('redirect_uri') ?? '';
  const state         = url.searchParams.get('state') ?? '';
  const codeChallenge = url.searchParams.get('code_challenge') ?? '';
  const ccMethod      = url.searchParams.get('code_challenge_method') ?? 'S256';
  const base          = process.env.NEXT_PUBLIC_APP_URL ?? 'https://brelio.eu';

  // Validate client
  const admin = createAdminClient();
  const { data: client } = await admin.from('oauth_clients').select('name, redirect_uris').eq('client_id', clientId).maybeSingle();
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return new Response('Invalid client or redirect_uri', { status: 400 });
  }
  // public clients only: the code is worthless without the PKCE verifier
  if (!codeChallenge || ccMethod !== 'S256') {
    const back = new URL(redirectUri);
    back.searchParams.set('error', 'invalid_request');
    back.searchParams.set('error_description', 'PKCE with S256 is required');
    if (state) back.searchParams.set('state', state);
    return NextResponse.redirect(back.toString(), 303);
  }

  // Check if user is already logged in
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, code_challenge: codeChallenge, code_challenge_method: ccMethod });

  if (!user) {
    const loginUrl = `/en/login?next=${encodeURIComponent(`/api/oauth/authorize?${params.toString()}`)}`;
    return NextResponse.redirect(new URL(loginUrl, base));
  }

  const deny = new URL(redirectUri);
  deny.searchParams.set('error', 'access_denied');
  if (state) deny.searchParams.set('state', state);
  const denyUrl = deny.toString();

  // Render consent page
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize ${esc(client.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 12px; padding: 32px 28px; max-width: 420px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    h1 { font-size: 22px; margin: 0 0 8px; color: #1a1a1a; }
    p { color: #666; font-size: 14px; margin: 0 0 24px; line-height: 1.5; }
    .app { display: flex; align-items: center; gap: 10px; background: #f0f0f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; }
    .app-icon { width: 36px; height: 36px; background: #7C3AED; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 16px; }
    .scopes { background: #f9f9f9; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; }
    .scope { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #444; margin-bottom: 6px; }
    .scope:last-child { margin-bottom: 0; }
    .actions { display: flex; gap: 10px; }
    .btn { flex: 1; padding: 11px; border-radius: 8px; border: none; cursor: pointer; font-size: 15px; font-weight: 600; }
    .btn-deny { background: #f0f0f0; color: #666; }
    .btn-allow { background: #7C3AED; color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize access</h1>
    <p>The following app is requesting access to your Brelio salon data.</p>
    <div class="app">
      <div class="app-icon">B</div>
      <strong>${esc(client.name)}</strong>
    </div>
    <div class="scopes">
      <div class="scope">✓ View appointments, clients, services</div>
      <div class="scope">✓ Create and update appointments</div>
      <div class="scope">✓ View salon statistics</div>
    </div>
    <div class="actions">
      <a href="${esc(denyUrl)}" class="btn btn-deny" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;">Deny</a>
      <form method="POST" action="/api/oauth/authorize" style="flex:1">
        <input type="hidden" name="client_id" value="${esc(clientId)}">
        <input type="hidden" name="redirect_uri" value="${esc(redirectUri)}">
        <input type="hidden" name="state" value="${esc(state)}">
        <input type="hidden" name="code_challenge" value="${esc(codeChallenge)}">
        <input type="hidden" name="code_challenge_method" value="${esc(ccMethod)}">
        <button type="submit" class="btn btn-allow" style="width:100%">Allow</button>
      </form>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// ── POST — user approved, issue code ──────────────────────────────────────
export async function POST(request: Request) {
  // only the consent page itself may approve: another site can't post this form for a signed-in user
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response('Forbidden', { status: 403 });
  if (!origin && request.headers.get('sec-fetch-site') !== 'same-origin') return new Response('Forbidden', { status: 403 });

  const form        = await request.formData();
  const clientId    = (form.get('client_id') as string) ?? '';
  const redirectUri = (form.get('redirect_uri') as string) ?? '';
  const state       = (form.get('state') as string) ?? '';
  const challenge   = (form.get('code_challenge') as string) ?? '';
  const ccMethod    = (form.get('code_challenge_method') as string) ?? 'S256';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthenticated', { status: 401 });

  const admin = createAdminClient();
  const { data: client } = await admin.from('oauth_clients').select('redirect_uris').eq('client_id', clientId).maybeSingle();
  if (!client?.redirect_uris.includes(redirectUri)) return new Response('Invalid client', { status: 400 });

  if (!challenge || ccMethod !== 'S256') return new Response('PKCE with S256 is required', { status: 400 });

  const code = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await admin.from('oauth_authorization_codes').insert({
    code,
    client_id: clientId,
    user_id: user.id,
    redirect_uri: redirectUri,
    scope: 'read write',
    code_challenge: challenge || null,
    code_challenge_method: ccMethod,
    expires_at: expiresAt,
  });

  const dest = new URL(redirectUri);
  dest.searchParams.set('code', code);
  if (state) dest.searchParams.set('state', state);

  return NextResponse.redirect(dest.toString(), 303);
}
