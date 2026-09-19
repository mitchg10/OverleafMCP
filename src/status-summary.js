import { execFile as execFileCb } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { findMainFile } from './compile.js';
import { walkFiles } from './paths.js';
import { parseSections, formatOutline } from './latex/sections.js';
import { stripComments } from './latex/strip-comments.js';
import { parseInputs, parseBibResources, bibResourceNames } from './latex/declarations.js';

const execFile = promisify(execFileCb);
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg'];

/** Human/agent-readable project overview. `p` is an opened project context. */
export async function buildStatusSummary(p) {
  const mainFile = await findMainFile(p.repoPath, p.project);
  const [allFiles, last, changed, unpushed] = await Promise.all([
    walkFiles(p.repoPath),
    p.client.lastCommit(),
    p.client.changedFiles(),
    p.client.hasUnpushedCommits(),
  ]);
  const main = mainFile ? stripComments(await p.readText(mainFile)) : '';
  const sections = mainFile ? parseSections(main, { headings: p.project.headings }) : [];
  const words = mainFile ? await wordCount(p.repoPath, mainFile) : null;

  return [
    `Project: ${p.project.key} — ${p.project.name}`,
    `Main file: ${mainFile ?? '(none found)'}${p.project.engine ? `  (engine: ${p.project.engine})` : ''}`,
    `Last Overleaf commit: ${last.hash} ${last.date} — ${last.message}`,
    localState(changed, unpushed),
    '',
    `Files: ${allFiles.length} total — ${countBy(allFiles, '.tex')} .tex, ${countBy(allFiles, '.bib')} .bib, ${allFiles.filter(f => IMAGE_EXTS.includes(path.extname(f.path).toLowerCase())).length} figures/images`,
    `Bibliography: ${listOr(bibFiles(main, allFiles))}`,
    `Inputs from main: ${listOr(parseInputs(main).map(i => i.raw))}`,
    words === null ? null : `Word count (texcount, main + inputs): ${words}`,
    '',
    `Outline of ${mainFile ?? 'main file'} (${sections.length} headings):`,
    formatOutline(sections),
  ].filter(l => l !== null).join('\n');
}

function localState(changed, unpushed) {
  if (changed.length === 0 && !unpushed) return 'Local state: clean (matches Overleaf)';
  const parts = [
    changed.length ? `${changed.length} file(s) with unpushed edits: ${changed.join(', ')}` : null,
    unpushed ? 'local commits not yet pushed' : null,
  ].filter(Boolean);
  return `Local state: ${parts.join('; ')} — use pending_changes / push_changes`;
}

function bibFiles(main, allFiles) {
  const declared = parseBibResources(main).flatMap(r => bibResourceNames(r.raw));
  const onDisk = allFiles.filter(f => f.path.endsWith('.bib')).map(f => f.path);
  return [...new Set([...declared, ...onDisk])];
}

function countBy(files, ext) {
  return files.filter(f => f.path.endsWith(ext)).length;
}

function listOr(items) {
  return items.length ? items.join(', ') : '(none)';
}

async function wordCount(repoPath, mainFile) {
  try {
    const { stdout } = await execFile('texcount', ['-1', '-sum', '-merge', '-q', mainFile], { cwd: repoPath, timeout: 20_000 });
    const n = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}
