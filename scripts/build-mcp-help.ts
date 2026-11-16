// Writes the help pages of the public MCP server (src/lib/mcp/help-pages.json) from the knowledge base's Markdown.
// Run after editing marketing-kb/obsidian/Brelio/{features,howto,troubleshooting}: npx tsx scripts/build-mcp-help.ts
import fs from 'fs';
import { loadHelp } from '../src/lib/mcp/help';

fs.writeFileSync('src/lib/mcp/help-pages.json', JSON.stringify(loadHelp(), null, 2) + '\n');
