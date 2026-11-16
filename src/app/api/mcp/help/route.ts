import { NextResponse } from 'next/server';
import { HELP_INSTRUCTIONS, HELP_TOOLS, callHelpTool } from '@/lib/mcp/help';

// The public help server: help pages, blog and plans, no sign-in (the salon's own data stays behind /api/mcp).

const SERVER_INFO = {
  name: 'brelio-help',
  version: '1.0.0',
  title: 'Brelio Help',
  websiteUrl: 'https://brelio.eu',
  icons: [{ src: 'https://brelio.eu/icons/icon-512x512.png', mimeType: 'image/png', sizes: ['512x512'] }],
};
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CORS = { 'Access-Control-Allow-Origin': '*' };

const jsonrpc = (id: unknown, result: unknown) => NextResponse.json({ jsonrpc: '2.0', id, result }, { headers: CORS });
const jsonrpcError = (id: unknown, code: number, message: string) =>
  NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { headers: CORS });

export async function POST(request: Request) {
  let body: { id?: unknown; method?: string; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonrpcError(null, -32700, 'Parse error');
  }
  const { id, method, params } = body;

  if (method === 'initialize') {
    const asked = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
    return jsonrpc(id, {
      protocolVersion: asked && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: HELP_INSTRUCTIONS,
    });
  }
  if (method?.startsWith('notifications/')) return new Response(null, { status: 202, headers: CORS });
  if (method === 'ping') return jsonrpc(id, {});
  if (method === 'tools/list') return jsonrpc(id, { tools: HELP_TOOLS });

  if (method === 'tools/call') {
    const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (!p?.name) return jsonrpcError(id, -32602, 'Missing tool name');
    if (!HELP_TOOLS.some((t) => t.name === p.name)) return jsonrpcError(id, -32602, `Unknown tool: ${p.name}`);
    try {
      const result = await callHelpTool(p.name, p.arguments ?? {});
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return jsonrpc(id, { content: [{ type: 'text', text }] });
    } catch (err) {
      return jsonrpc(id, {
        content: [{ type: 'text', text: err instanceof Error ? err.message : 'Tool execution failed' }],
        isError: true,
      });
    }
  }
  return jsonrpcError(id, -32601, 'Method not found');
}

// Streamable HTTP without server-initiated messages: no stream to open
export function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST', ...CORS } });
}

export function OPTIONS() {
  return new Response(null, {
    headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Mcp-Protocol-Version' },
  });
}
