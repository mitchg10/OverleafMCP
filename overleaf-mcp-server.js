#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config.js';
import { createServer } from './src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.OVERLEAF_MCP_CONFIG ?? path.join(here, 'projects.json');

async function main() {
  const config = await loadConfig(configPath);
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  console.error(`Overleaf MCP server running (${Object.keys(config.projects).length} projects, cache: ${config.cacheDir})`);
}

main().catch(error => {
  console.error('Fatal:', error.message);
  process.exit(1);
});
