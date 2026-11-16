import { createAdminClient } from '@/lib/supabase/admin';

export const MCP_TOOLS = [
  {
    name: 'get_appointments',
    title: 'Get appointments',
    annotations: { title: 'Get appointments', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: 'Get salon appointments within a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Start date ISO 8601 (e.g. 2026-05-01)' },
        date_to:   { type: 'string', description: 'End date ISO 8601 (e.g. 2026-05-31)' },
        status:    { type: 'string', enum: ['pending', 'confirmed', 'completed', 'cancelled'], description: 'Only appointments with this status' },
        limit:     { type: 'number', description: 'Max results, default 50' },
      },
    },
  },
  {
    name: 'get_clients',
    title: 'Find clients',
    annotations: { title: 'Find clients', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: 'Search salon clients by name or phone.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Name or phone fragment' },
        limit:  { type: 'number', description: 'Max results, default 20' },
      },
    },
  },
  {
    name: 'list_services',
    title: 'List services',
    annotations: { title: 'List services', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: 'List all active services offered by the salon.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_stats',
    title: 'Get stats',
    annotations: { title: 'Get stats', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: 'Get revenue and appointment statistics for a period.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'year'], description: 'Default: month' },
      },
    },
  },
  {
    name: 'create_appointment',
    title: 'Create appointment',
    annotations: { title: 'Create appointment', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Create a new confirmed appointment.',
    inputSchema: {
      type: 'object',
      required: ['client_name', 'service_name', 'start_at'],
      properties: {
        client_name:  { type: 'string', description: 'Existing or new client' },
        client_phone: { type: 'string', description: 'Finds an existing client, or is saved with a new one' },
        client_email: { type: 'string', description: 'Saved with a new client' },
        service_name: { type: 'string', description: 'Exact or partial service name' },
        start_at:     { type: 'string', description: 'ISO 8601 datetime' },
        notes:        { type: 'string', description: 'Shown on the appointment' },
      },
    },
  },
  {
    name: 'check_account',
    title: 'Check account',
    annotations: { title: 'Check account', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: 'Check whether a Brelio account exists for a given email and whether it is verified. Use when a user reports login or registration problems.',
    inputSchema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', description: 'Email address to look up' },
      },
    },
  },
] as const;

/** What MCP clients get: the support chat's account check stays in the chat. */
export const PUBLIC_MCP_TOOLS = MCP_TOOLS.filter((t) => t.name !== 'check_account');

type Args = Record<string, unknown>;

export async function callTool(name: string, args: Args, userId: string): Promise<unknown> {
  const supabase = createAdminClient();

  // ── get_appointments ──────────────────────────────────────────────────────
  if (name === 'get_appointments') {
    const limit = (args.limit as number | undefined) ?? 50;
    let q = supabase
      .from('appointments')
      .select('id, start_at, end_at, status, notes, client:clients(id,name,phone), service:services(id,name,duration_min,price)')
      .eq('user_id', userId)
      .order('start_at', { ascending: false })
      .limit(limit);

    if (args.date_from) q = q.gte('start_at', args.date_from as string);
    if (args.date_to)   q = q.lte('start_at', args.date_to as string);
    if (args.status)    q = q.eq('status', args.status as string);

    const { data, error } = await q;
    if (error) return { error: error.message };
    const { data: salon } = await supabase.from('salons').select('timezone').eq('user_id', userId).limit(1).maybeSingle();
    return { appointments: data, count: data?.length ?? 0, times_are: 'UTC', salon_timezone: salon?.timezone ?? 'Europe/Warsaw' };
  }

  // ── get_clients ────────────────────────────────────────────────────────────
  if (name === 'get_clients') {
    const limit = (args.limit as number | undefined) ?? 20;
    let q = supabase
      .from('clients')
      .select('id, name, phone, email, created_at')
      .eq('owner_id', userId)
      .order('name')
      .limit(limit);

    if (args.search) {
      // letters, digits, spaces, + and - only: commas or parentheses would change the filter
      const s = (args.search as string).replace(/[^\p{L}\p{N} +-]/gu, '').trim();
      if (s) q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
    }

    const { data, error } = await q;
    if (error) return { error: error.message };
    return { clients: data, count: data?.length ?? 0 };
  }

  // ── list_services ──────────────────────────────────────────────────────────
  if (name === 'list_services') {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, duration_min, price, description')
      .eq('owner_id', userId)
      .order('name');

    if (error) return { error: error.message };
    return { services: data };
  }

  // ── get_stats ──────────────────────────────────────────────────────────────
  if (name === 'get_stats') {
    const period = (args.period as string) ?? 'month';
    const now = new Date();
    let from: Date;

    if (period === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      from = new Date(now); from.setDate(from.getDate() - 7);
    } else if (period === 'year') {
      from = new Date(now.getFullYear(), 0, 1);
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const { data, error } = await supabase
      .from('appointments')
      .select('status, service:services(price)')
      .eq('user_id', userId)
      .gte('start_at', from.toISOString());

    if (error) return { error: error.message };

    const total = data?.length ?? 0;
    const completed = (data ?? []).filter(a => a.status === 'completed');
    const revenue = completed.reduce((sum, a) => {
      const svc = a.service as { price?: number } | null;
      return sum + (svc?.price ?? 0);
    }, 0);

    return { period, total_appointments: total, completed: completed.length, revenue_pln: revenue };
  }

  // ── create_appointment ─────────────────────────────────────────────────────
  if (name === 'create_appointment') {
    const startAt = new Date(args.start_at as string);
    if (isNaN(startAt.getTime())) return { error: 'Invalid start_at datetime' };

    // Find or create client
    let clientId: string | null = null;
    if (args.client_phone) {
      const { data: existing } = await supabase
        .from('clients').select('id').eq('owner_id', userId).eq('phone', args.client_phone as string).maybeSingle();
      clientId = existing?.id ?? null;
    }
    if (!clientId) {
      const { data: byName } = await supabase
        .from('clients').select('id').eq('owner_id', userId).ilike('name', (args.client_name as string).trim()).limit(1).maybeSingle();
      clientId = byName?.id ?? null;
    }
    if (!clientId) {
      const { data: created } = await supabase
        .from('clients')
        .insert({ owner_id: userId, name: args.client_name as string, phone: (args.client_phone as string) ?? null, email: (args.client_email as string) ?? null })
        .select('id').single();
      clientId = created?.id ?? null;
    }

    // Find service by name (partial)
    const { data: service } = await supabase
      .from('services').select('id, duration_min')
      .eq('owner_id', userId).ilike('name', `%${args.service_name}%`).order('name').limit(1).maybeSingle();

    const durationMin = service?.duration_min ?? 60;
    const endAt = new Date(startAt.getTime() + durationMin * 60000);

    const { data: appt, error } = await supabase
      .from('appointments')
      .insert({ user_id: userId, client_id: clientId, service_id: service?.id ?? null, start_at: startAt.toISOString(), end_at: endAt.toISOString(), status: 'confirmed', notes: (args.notes as string) ?? null })
      .select('id, start_at, end_at, status').single();

    if (error) return { error: error.message };
    return { success: true, appointment: appt };
  }

  // ── check_account ─────────────────────────────────────────────────────────
  if (name === 'check_account') {
    // only the signed-in person's own account: anyone else's would leak who uses Brelio
    const email = String(args.email ?? '').trim().toLowerCase();
    const { data } = await supabase.auth.admin.getUserById(userId);
    const u = data?.user;
    if (!u || u.email?.toLowerCase() !== email) return { error: 'Only your own account can be checked.' };
    return { exists: true, email_confirmed: !!u.email_confirmed_at, has_signed_in: !!u.last_sign_in_at };
  }

  return { error: `Unknown tool: ${name}` };
}
