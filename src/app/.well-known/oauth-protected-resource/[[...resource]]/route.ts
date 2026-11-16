import { NextResponse } from 'next/server';

// Protected resource metadata (RFC 9728) for the MCP server: where an MCP client signs in. Served at the root and at
// /.well-known/oauth-protected-resource/api/mcp, the two places clients look.
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://brelio.eu';
  return NextResponse.json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
    resource_name: 'Brelio',
  });
}
