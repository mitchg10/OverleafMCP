import { z } from 'zod';
import { compileProject, findMainFile, isPdfStale, pdfPathFor } from '../compile.js';
import { renderPage, pdfText } from '../render.js';
import { registerTool, text, projectNameSchema } from './shared.js';

const MAX_PAGES_PER_CALL = 4;

/**
 * A caller-supplied mainFile bypasses findMainFile, and with it the allowlist
 * that checks the name against the files actually in the clone. It reaches
 * latexmk as an argv entry with cwd set to the repo, so a `..` path would
 * compile a file outside the project; p.absPath rejects that. The relative
 * form is what callers need, so the resolved path is only used as the check.
 */
async function resolveMain(p, mainFile) {
  if (mainFile) {
    p.absPath(mainFile);
    return mainFile;
  }
  const main = await findMainFile(p.repoPath, p.project);
  if (!main) throw new Error('No .tex file with \\documentclass found; pass mainFile explicitly.');
  return main;
}

/** Compile only when the PDF is missing or older than the sources. */
async function ensurePdf(p, mainFile) {
  const pdfPath = pdfPathFor(p.repoPath, mainFile);
  if (!(await isPdfStale(p.repoPath, pdfPath))) return { pdfPath, compiled: null };
  const result = await compileProject({ repoPath: p.repoPath, mainFile, engine: p.project.engine });
  if (!result.pdfPath) throw new Error(`Compile failed, no PDF produced. ${summarize(result)}`);
  return { pdfPath: result.pdfPath, compiled: result };
}

function summarize(r) {
  const lines = [
    `${r.ok ? 'OK' : 'FAILED'} — ${r.mainFile} → ${r.pages ?? '?'} page(s) in ${(r.durationMs / 1000).toFixed(1)}s${r.timedOut ? ' (TIMED OUT)' : ''}`,
    r.pdfPath ? `PDF: ${r.pdfPath}` : 'PDF: not produced',
  ];
  if (r.errors.length) lines.push(`Errors (${r.errors.length}):`, ...r.errors.map(e => `  ${e.file}:${e.line}: ${e.message}`));
  if (r.fatal.length) lines.push(`Fatal: ${r.fatal.join(' | ')}`);
  if (r.undefinedReferences.length) lines.push(`Undefined references: ${r.undefinedReferences.join(', ')}`);
  if (r.undefinedCitations.length) lines.push(`Undefined citations: ${r.undefinedCitations.join(', ')}`);
  if (r.overfullBoxes.length) {
    lines.push(`Overfull hboxes (${r.overfullBoxes.length}): ${r.overfullBoxes.slice(0, 10).map(b => `${b.pt}pt @ lines ${b.lines}`).join('; ')}`);
  }
  if (r.underfullBoxes) lines.push(`Underfull boxes: ${r.underfullBoxes}`);
  if (!r.ok && r.logTail) lines.push('', 'Log tail:', r.logTail);
  if (!r.ok && r.latexmkStderr?.trim()) lines.push('', 'latexmk:', r.latexmkStderr.trim());
  return lines.join('\n');
}

export function registerBuildTools(server, ctx) {
  registerTool(server, ctx, 'compile', {
    description:
      'Compile the project locally with latexmk (pdflatex by default; honours a project latexmkrc or a configured engine). ' +
      'Returns a compact report: errors as file:line, undefined references/citations, overfull boxes, page count, PDF path — not the raw log. ' +
      'Run after edits and before push_changes.',
    inputSchema: {
      projectName: projectNameSchema,
      mainFile: z.string().optional().describe('Root .tex to compile; defaults to the configured/auto-detected main file.'),
    },
  }, async ({ projectName, mainFile }) => {
    const p = await ctx.open(projectName);
    const main = await resolveMain(p, mainFile);
    const result = await compileProject({ repoPath: p.repoPath, mainFile: main, engine: p.project.engine });
    return text(summarize(result));
  });

  registerTool(server, ctx, 'render_page', {
    description:
      'Render PDF page(s) as PNG images so you can inspect layout, figures, tables, and page breaks. ' +
      `Compiles first if the PDF is missing or stale. Up to ${MAX_PAGES_PER_CALL} pages per call; use dpi 60-80 for overview, 120+ for detail.`,
    inputSchema: {
      projectName: projectNameSchema,
      pages: z.array(z.number().int().min(1)).min(1).max(MAX_PAGES_PER_CALL).describe('1-based page numbers, e.g. [1] or [3, 4].'),
      dpi: z.number().int().min(30).max(200).optional().describe('Resolution; default 90.'),
      mainFile: z.string().optional(),
    },
  }, async ({ projectName, pages, dpi = 90, mainFile }) => {
    const p = await ctx.open(projectName);
    const main = await resolveMain(p, mainFile);
    const { pdfPath, compiled } = await ensurePdf(p, main);
    const images = [];
    for (const page of pages) images.push(await renderPage({ pdfPath, page, dpi }));
    const note = compiled ? `Recompiled first: ${summarize(compiled).split('\n')[0]}\n` : '';
    return {
      content: [
        { type: 'text', text: `${note}${images.map(i => `Page ${i.page} of ${i.totalPages}`).join(', ')} at ${dpi} dpi — ${pdfPath}` },
        ...images.map(({ type, data, mimeType }) => ({ type, data, mimeType })),
      ],
    };
  });

  registerTool(server, ctx, 'pdf_text', {
    description:
      'Extract layout-preserving text from the compiled PDF for a page range. Cheap way to check what actually rendered ' +
      '(pagination, resolved references, bibliography) without images. Compiles first if needed.',
    inputSchema: {
      projectName: projectNameSchema,
      firstPage: z.number().int().min(1).optional().describe('Default 1.'),
      lastPage: z.number().int().min(1).optional().describe('Default = firstPage.'),
      mainFile: z.string().optional(),
    },
  }, async ({ projectName, firstPage = 1, lastPage, mainFile }) => {
    const p = await ctx.open(projectName);
    const main = await resolveMain(p, mainFile);
    const { pdfPath, compiled } = await ensurePdf(p, main);
    const body = await pdfText({ pdfPath, firstPage, lastPage });
    const note = compiled ? `Recompiled first: ${summarize(compiled).split('\n')[0]}\n\n` : '';
    return text(note + body);
  });
}
