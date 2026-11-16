import { createAdminClient } from '@/lib/supabase/admin';

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface McpAuth {
  salonId: string;
  userId: string;
}

export async function resolveSalonFromBearer(authHeader: string | null): Promise<McpAuth | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const supabase = createAdminClient();

  // 1. API key — direct match on salons.mcp_api_key
  const { data: salon } = await supabase
    .from('salons')
    .select('id, user_id')
    .eq('mcp_api_key', token)
    .maybeSingle();

  if (salon) return { salonId: salon.id, userId: salon.user_id };

  // 2. OAuth access token — hashed lookup
  const tokenHash = await sha256hex(token);
  const { data: oauthToken } = await supabase
    .from('oauth_access_tokens')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!oauthToken || new Date(oauthToken.expires_at) <= new Date()) return null;

  const { data: salonByUser } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', oauthToken.user_id)
    .maybeSingle();

  if (!salonByUser) return null;
  return { salonId: salonByUser.id, userId: oauthToken.user_id };
}

export { sha256hex };
