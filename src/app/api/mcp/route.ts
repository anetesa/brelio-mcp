import { NextResponse } from 'next/server';
import { resolveSalonFromBearer } from '@/lib/mcp/auth';
import { PUBLIC_MCP_TOOLS, callTool } from '@/lib/mcp/tools';

const SERVER_INFO = {
  name: 'brelio',
  version: '1.0.0',
  title: 'Brelio',
  websiteUrl: 'https://brelio.eu',
  icons: [{ src: 'https://brelio.eu/icons/icon-512x512.png', mimeType: 'image/png', sizes: ['512x512'] }],
};
/** Newest first: the client's version when it is one of these, else the newest. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** 401 that tells an MCP client where to sign in (RFC 9728). */
function unauthorized() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://brelio.eu';
  return NextResponse.json(
    { error: 'Unauthorized' },
    {
      status: 401,
      headers: { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp"` },
    },
  );
}

function jsonrpc(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

function jsonrpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } });
}

export async function POST(request: Request) {
  const auth = await resolveSalonFromBearer(request.headers.get('authorization'));
  if (!auth) return unauthorized();

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonrpcError(null, -32700, 'Parse error');
  }

  const { id, method, params } = body;

  // ── initialize ─────────────────────────────────────────────────────────────
  if (method === 'initialize') {
    const asked = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
    return jsonrpc(id, {
      protocolVersion: asked && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  // ── notifications/initialized ──────────────────────────────────────────────
  if (method?.startsWith('notifications/')) {
    return new Response(null, { status: 202 });
  }

  // ── ping ───────────────────────────────────────────────────────────────────
  if (method === 'ping') {
    return jsonrpc(id, {});
  }

  // ── tools/list ────────────────────────────────────────────────────────────
  if (method === 'tools/list') {
    return jsonrpc(id, { tools: PUBLIC_MCP_TOOLS });
  }

  // ── tools/call ────────────────────────────────────────────────────────────
  if (method === 'tools/call') {
    const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (!p?.name) return jsonrpcError(id, -32602, 'Missing tool name');

    if (!PUBLIC_MCP_TOOLS.some((t) => t.name === p.name)) return jsonrpcError(id, -32602, `Unknown tool: ${p.name}`);
    try {
      const result = await callTool(p.name, p.arguments ?? {}, auth.userId);
      return jsonrpc(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      return jsonrpcError(id, -32603, err instanceof Error ? err.message : 'Tool execution failed');
    }
  }

  return jsonrpcError(id, -32601, 'Method not found');
}

// Streamable HTTP without server-initiated messages: no stream to open
export async function GET(request: Request) {
  const auth = await resolveSalonFromBearer(request.headers.get('authorization'));
  if (!auth) return unauthorized();
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}
