import { z } from 'zod';
import { projectKeys } from '../config.js';
import { walkFiles } from '../paths.js';
import { parseSections, formatOutline } from '../latex/sections.js';
import { getSectionContent } from '../latex/section-content.js';
import { searchText } from '../latex/search.js';
import { buildStatusSummary } from '../status-summary.js';
import { registerTool, text, projectNameSchema, filePathSchema, numberLines } from './shared.js';

const MAX_READ_LINES = 2000;
const MAX_SEARCH_HITS = 200;

export function registerReadTools(server, ctx) {
  registerTool(server, ctx, 'list_projects', {
    description:
      'List the Overleaf projects this server can access, with their keys. Call first when you do not know the projectName. ' +
      'Keys are what every other tool takes as projectName.',
    inputSchema: {},
  }, async (_args, { config }) => {
    const lines = projectKeys(config).map(k => {
      const p = config.projects[k];
      return `${k}\t${p.name}${p.mainFile ? `\t(main: ${p.mainFile})` : ''}`;
    });
    return text(`key\tname\n${lines.join('\n')}`);
  });

  registerTool(server, ctx, 'list_files', {
    description:
      'List files in a project (path and size in bytes), excluding .git and build output. Defaults to .tex and .bib; ' +
      'pass extensions: [] for everything (figures, .cls, .sty ...).',
    inputSchema: {
      projectName: projectNameSchema,
      extensions: z.array(z.string()).optional().describe('Extensions to include, e.g. [".tex", ".bib"]. Empty array = all files.'),
    },
  }, async ({ projectName, extensions }) => {
    const p = await ctx.open(projectName);
    const exts = extensions === undefined ? ['.tex', '.bib'] : extensions.length === 0 ? null : extensions;
    const files = await walkFiles(p.repoPath, { extensions: exts });
    return text(files.length ? files.map(f => `${f.path}\t${f.size}`).join('\n') : '(no matching files)');
  });

  registerTool(server, ctx, 'read_file', {
    description:
      'Read a file with line numbers (cat -n style) so you can cite lines and craft exact edit_file matches. ' +
      'Use startLine/endLine to read a slice instead of the whole file — prefer get_section_content or search for targeted reads. ' +
      `Whole-file reads are capped at ${MAX_READ_LINES} lines.`,
    inputSchema: {
      projectName: projectNameSchema,
      filePath: filePathSchema,
      startLine: z.number().int().min(1).optional().describe('First line to return (1-based).'),
      endLine: z.number().int().min(1).optional().describe('Last line to return (inclusive).'),
      refresh: z.boolean().optional().describe('Force a pull from Overleaf before reading.'),
    },
  }, async ({ projectName, filePath, startLine, endLine, refresh }) => {
    const p = await ctx.open(projectName, { refresh });
    const lines = (await p.readText(filePath)).split('\n');
    const from = startLine ?? 1;
    const to = Math.min(endLine ?? lines.length, lines.length, from + MAX_READ_LINES - 1);
    const body = numberLines(lines.slice(from - 1, to).join('\n'), from);
    const note = to < (endLine ?? lines.length) ? `\n[showing lines ${from}-${to} of ${lines.length}; pass startLine to continue]` : '';
    return text(body + note);
  });

  registerTool(server, ctx, 'get_sections', {
    description:
      'Outline of a LaTeX file: one line per heading as "L<line>\\t<type>\\t<title>", indented by depth. ' +
      'Commented-out headings are omitted unless includeCommented. Use the line numbers with get_section_content, read_file, or replace_section.',
    inputSchema: {
      projectName: projectNameSchema,
      filePath: filePathSchema,
      includeCommented: z.boolean().optional().describe('Also list headings that are commented out (flagged [commented]).'),
    },
  }, async ({ projectName, filePath, includeCommented }) => {
    const p = await ctx.open(projectName);
    return text(formatOutline(parseSections(await p.readText(filePath), { includeCommented, headings: p.project.headings })));
  });

  registerTool(server, ctx, 'get_section_content', {
    description:
      'Return the LaTeX source of one section, including its subsections by default, with line numbers. ' +
      'Identify the section by sectionTitle (case-insensitive) or, when titles repeat, by the heading line from get_sections.',
    inputSchema: {
      projectName: projectNameSchema,
      filePath: filePathSchema,
      sectionTitle: z.string().optional().describe('Heading title, e.g. "Methods".'),
      line: z.number().int().min(1).optional().describe('Line number of the heading (from get_sections). Use when titles are ambiguous.'),
      includeSubsections: z.boolean().optional().describe('Default true. False returns only text before the first nested heading.'),
    },
  }, async ({ projectName, filePath, sectionTitle, line, includeSubsections }) => {
    const p = await ctx.open(projectName);
    const r = getSectionContent(await p.readText(filePath), { title: sectionTitle, line, includeSubsections, headings: p.project.headings });
    return text(`${r.section.type} "${r.section.title}" — ${filePath} lines ${r.startLine}-${r.endLine}\n${numberLines(r.content, r.startLine)}`);
  });

  registerTool(server, ctx, 'search', {
    description:
      'Search project files for a string or regex. Returns "file:line: text" hits (case-insensitive by default). ' +
      'Use it to find citations (\\\\cite\\\\{key), labels, TODOs, figure includes, or where a phrase appears, instead of reading whole files.',
    inputSchema: {
      projectName: projectNameSchema,
      pattern: z.string().describe('Literal text, or a JavaScript regex when regex is true.'),
      regex: z.boolean().optional().describe('Treat pattern as a regular expression.'),
      caseSensitive: z.boolean().optional(),
      extensions: z.array(z.string()).optional().describe('File types to search; default [".tex", ".bib"].'),
      contextLines: z.number().int().min(0).max(10).optional().describe('Lines of context around each hit.'),
    },
  }, async ({ projectName, pattern, regex, caseSensitive, extensions, contextLines = 0 }) => {
    const p = await ctx.open(projectName);
    const files = await walkFiles(p.repoPath, { extensions: extensions ?? ['.tex', '.bib'] });
    const chunks = [];
    let total = 0;
    for (const f of files) {
      const hits = searchText(await p.readText(f.path), pattern, { regex, caseSensitive, contextLines });
      total += hits.length;
      chunks.push(...hits.slice(0, MAX_SEARCH_HITS - chunks.length).map(h => formatHit(f.path, h)));
      if (chunks.length >= MAX_SEARCH_HITS) break;
    }
    if (total === 0) return text(`No matches for "${pattern}" in ${files.length} files.`);
    const header = `${total} match${total === 1 ? '' : 'es'}${total > chunks.length ? ` (showing ${chunks.length})` : ''}`;
    return text(`${header}\n${chunks.join(contextLines ? '\n--\n' : '\n')}`);
  });

  registerTool(server, ctx, 'status_summary', {
    description:
      'Start here for a project: main file, full section outline, bib files, \\\\input/\\\\include tree, figures, word count, ' +
      'last Overleaf commit, and whether there are local edits not yet pushed.',
    inputSchema: {
      projectName: projectNameSchema,
      refresh: z.boolean().optional().describe('Force a pull from Overleaf first.'),
    },
  }, async ({ projectName, refresh }) => {
    const p = await ctx.open(projectName, { refresh });
    return text(await buildStatusSummary(p));
  });

  registerTool(server, ctx, 'sync', {
    description:
      'Pull the latest version from Overleaf now (reads otherwise reuse a clone refreshed within the last ' +
      `${ctx.config.syncTtlSeconds}s). Skipped when there are local edits pending — push or discard them first.`,
    inputSchema: { projectName: projectNameSchema },
  }, async ({ projectName }) => {
    const p = await ctx.open(projectName, { refresh: true });
    const last = await p.client.lastCommit();
    const verb = { cloned: 'Cloned', pulled: 'Pulled — now up to date', 'skipped-dirty': 'Skipped pull: local edits pending (see pending_changes)' }[p.syncResult.action] ?? p.syncResult.action;
    return text(`${verb}. Latest commit ${last.hash} (${last.date}): ${last.message}`);
  });
}

const HIT_WINDOW = 160;

function formatHit(file, h) {
  const before = h.before.map((l, i) => `${file}:${h.line - h.before.length + i}- ${l}`);
  const after = h.after.map((l, i) => `${file}:${h.line + 1 + i}- ${l}`);
  return [...before, `${file}:${h.line}: ${windowAround(h.text, h.column - 1)}`, ...after].join('\n');
}

/** Long paragraph lines: show a window around the match instead of the line start. */
function windowAround(line, col) {
  if (line.length <= 2 * HIT_WINDOW) return line;
  const start = Math.max(0, col - HIT_WINDOW);
  const end = Math.min(line.length, col + HIT_WINDOW);
  return `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`;
}
