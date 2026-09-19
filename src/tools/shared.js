import { z } from 'zod';
import { scrubSecrets } from '../git-client.js';

export const projectNameSchema = z
  .string()
  .describe('Project key from list_projects (e.g. "EAAI-27"). Required.');

export const filePathSchema = z
  .string()
  .describe('Path relative to the project root, as shown by list_files (e.g. "main.tex" or "sections/intro.tex").');

export function text(str) {
  return { content: [{ type: 'text', text: str }] };
}

export function errorResult(error, scrub = scrubSecrets) {
  return { content: [{ type: 'text', text: `Error: ${scrub(error.message)}` }], isError: true };
}

/**
 * Register a tool whose handler receives (args, ctx) and returns a result;
 * thrown errors become isError results with any tokens scrubbed.
 */
export function registerTool(server, ctx, name, { description, inputSchema }, handler) {
  server.registerTool(name, { description, inputSchema }, async args => {
    try {
      return await handler(args ?? {}, ctx);
    } catch (error) {
      return errorResult(error, ctx.scrub ?? scrubSecrets);
    }
  });
}

export function numberLines(content, startLine = 1) {
  return content
    .split('\n')
    .map((line, i) => `${String(startLine + i).padStart(6)}\t${line}`)
    .join('\n');
}

export function truncate(str, max) {
  return str.length <= max ? str : `${str.slice(0, max)}\n... [truncated ${str.length - max} chars]`;
}
