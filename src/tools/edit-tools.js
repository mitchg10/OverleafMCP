import { access } from 'node:fs/promises';
import { z } from 'zod';
import { applyEdit, replaceSectionBody } from '../edit.js';
import { registerTool, text, projectNameSchema, filePathSchema, truncate } from './shared.js';

const MAX_DIFF_CHARS = 20_000;

async function fileExists(p) {
  return access(p).then(() => true, () => false);
}

async function diffReport(p, changedFile) {
  const diff = await p.client.diff();
  const only = extractFileDiff(diff, changedFile);
  return truncate(only || diff, MAX_DIFF_CHARS);
}

function extractFileDiff(diff, file) {
  const parts = diff.split(/^(?=diff --git )/m);
  return parts.find(part => part.includes(` b/${file}\n`)) ?? '';
}

export function registerEditTools(server, ctx) {
  registerTool(server, ctx, 'edit_file', {
    description:
      'Replace an exact string in a file (like a careful find-and-replace). oldString must match exactly once — copy it verbatim ' +
      'from read_file/get_section_content output, including whitespace and LaTeX escapes. Returns the resulting diff. ' +
      'Edits stay local until push_changes; run compile to verify first.',
    inputSchema: {
      projectName: projectNameSchema,
      filePath: filePathSchema,
      oldString: z.string().describe('Exact text to replace (must be unique in the file unless replaceAll).'),
      newString: z.string().describe('Replacement text.'),
      replaceAll: z.boolean().optional().describe('Replace every occurrence instead of requiring uniqueness.'),
    },
  }, async ({ projectName, filePath, oldString, newString, replaceAll }) => {
    const p = await ctx.open(projectName);
    const { content, count } = applyEdit(await p.readText(filePath), oldString, newString, { replaceAll });
    await p.writeText(filePath, content);
    return text(`Replaced ${count} occurrence${count === 1 ? '' : 's'} in ${filePath} (local, not yet pushed).\n\n${await diffReport(p, filePath)}`);
  });

  registerTool(server, ctx, 'replace_section', {
    description:
      'Replace the body of a section (heading line kept unless keepHeading is false; subsections included by default, matching get_section_content). ' +
      'Prefer edit_file for small changes; use this when rewriting a whole section. Local until push_changes.',
    inputSchema: {
      projectName: projectNameSchema,
      filePath: filePathSchema,
      sectionTitle: z.string().optional().describe('Heading title (case-insensitive).'),
      line: z.number().int().min(1).optional().describe('Heading line from get_sections, for ambiguous titles.'),
      newContent: z.string().describe('New LaTeX body (without the heading unless keepHeading is false).'),
      keepHeading: z.boolean().optional().describe('Default true.'),
      includeSubsections: z.boolean().optional().describe('Default true: nested headings are replaced too.'),
    },
  }, async ({ projectName, filePath, sectionTitle, line, newContent, keepHeading, includeSubsections }) => {
    const p = await ctx.open(projectName);
    const updated = replaceSectionBody(await p.readText(filePath), { title: sectionTitle, line, newContent, keepHeading, includeSubsections, headings: p.project.headings });
    await p.writeText(filePath, updated);
    return text(`Replaced section in ${filePath} (local, not yet pushed).\n\n${await diffReport(p, filePath)}`);
  });

  registerTool(server, ctx, 'write_file', {
    description:
      'Create a new file (e.g. a new section file or .bib). Refuses to overwrite an existing file unless overwrite is true — use edit_file for changes. Local until push_changes.',
    inputSchema: {
      projectName: projectNameSchema,
      filePath: filePathSchema,
      content: z.string(),
      overwrite: z.boolean().optional(),
    },
  }, async ({ projectName, filePath, content, overwrite }) => {
    const p = await ctx.open(projectName);
    if (!overwrite && (await fileExists(p.absPath(filePath)))) {
      throw new Error(`${filePath} already exists. Use edit_file to change it, or pass overwrite: true.`);
    }
    await p.writeText(filePath, content);
    return text(`Wrote ${filePath} (${content.length} chars; local, not yet pushed).`);
  });

  registerTool(server, ctx, 'pending_changes', {
    description: 'Show local edits not yet pushed to Overleaf: changed files and a unified diff. Review before push_changes.',
    inputSchema: { projectName: projectNameSchema },
  }, async ({ projectName }) => {
    const p = await ctx.open(projectName);
    const [files, unpushed] = await Promise.all([p.client.changedFiles(), p.client.hasUnpushedCommits()]);
    if (files.length === 0 && !unpushed) return text('No local changes. Clone matches Overleaf.');
    const diff = files.length ? truncate(await p.client.diff(), MAX_DIFF_CHARS) : '';
    const head = [
      files.length ? `Changed files: ${files.join(', ')}` : null,
      unpushed ? 'There are local commits not yet pushed (a previous push failed). push_changes will retry.' : null,
    ].filter(Boolean).join('\n');
    return text(`${head}\n\n${diff}`.trim());
  });

  registerTool(server, ctx, 'push_changes', {
    description:
      'Commit all local edits and push them to Overleaf (they appear in the project history like a normal save). ' +
      'Rebases onto any newer Overleaf changes first; on a real conflict nothing is pushed and the conflicting files are reported.',
    inputSchema: {
      projectName: projectNameSchema,
      message: z.string().optional().describe('Commit message describing the edit. Default "Edit via Claude".'),
    },
  }, async ({ projectName, message = 'Edit via Claude' }) => {
    const p = await ctx.open(projectName);
    const r = await p.client.commitAndPush(message);
    if (!r.pushed) return text(`Nothing to push: ${r.reason}.`);
    return text(`Pushed to Overleaf as ${r.commit.hash}: ${r.commit.message}`);
  });

  registerTool(server, ctx, 'discard_changes', {
    description:
      'Throw away ALL local edits and unpushed commits for a project and match Overleaf exactly. Irreversible; requires confirm: true.',
    inputSchema: {
      projectName: projectNameSchema,
      confirm: z.boolean().optional(),
    },
  }, async ({ projectName, confirm }) => {
    const p = await ctx.open(projectName);
    const files = await p.client.changedFiles();
    if (!confirm) {
      return text(`This would discard ${files.length} changed file(s)${files.length ? `: ${files.join(', ')}` : ''} and any unpushed commits. Call again with confirm: true.`);
    }
    await p.client.discard();
    return text('Discarded local changes; clone now matches Overleaf.');
  });
}
