import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createProjectContext } from './project-context.js';
import { registerReadTools } from './tools/read-tools.js';
import { registerBuildTools } from './tools/build-tools.js';
import { registerEditTools } from './tools/edit-tools.js';
import { registerCitationTools } from './tools/citation-tools.js';

const INSTRUCTIONS = `Overleaf projects via their git bridge. Typical flow:
1. list_projects → status_summary (outline, main file, last commit)
2. get_sections / get_section_content / search / read_file (with line ranges) to pull only what you need
3. edit_file (exact-match replace) or replace_section / write_file — changes stay in a local clone
4. compile → fix errors; render_page or pdf_text to check the result visually
5. pending_changes to review, then push_changes to send to Overleaf (appears in project history)
check_citations is a cheap offline check of the bibliography (undefined citations, backend/command mismatches, formatting drift); it never uses the network and never edits files.
verify_references resolves each entry's DOI against Crossref and DataCite to check the work is real and correctly described; it uses the network, so run check_citations first. "unverified" means not found, never fabricated. Neither tool ever edits a .bib.
Reads reuse a clone refreshed within the last ~30s; pass refresh: true or call sync to force a pull.`;

/** Build the MCP server with every tool registered. `options.remoteUrlFor` is a test seam. */
export function createServer(config, options = {}) {
  const server = new McpServer({ name: 'overleaf-mcp-server', version: '2.0.0' }, { instructions: INSTRUCTIONS });
  const ctx = createProjectContext(config, options);
  registerReadTools(server, ctx);
  registerBuildTools(server, ctx);
  registerEditTools(server, ctx);
  registerCitationTools(server, ctx);
  return server;
}
