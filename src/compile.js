import { execFile as execFileCb } from 'node:child_process';
import { access, appendFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseLatexLog } from './latex/log-parser.js';
import { stripComments } from './latex/strip-comments.js';
import { walkFiles } from './paths.js';

const execFile = promisify(execFileCb);
export const BUILD_DIR = '.build';
const ENGINE_FLAGS = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' };
const SOURCE_EXTS = ['.tex', '.bib', '.cls', '.sty', '.bst', '.png', '.jpg', '.jpeg', '.pdf', '.eps'];

export function buildLatexmkArgs({ engine, hasRc, mainFile }) {
  const engineFlag = engine ? [ENGINE_FLAGS[engine]] : hasRc ? [] : ['-pdf'];
  return [
    ...engineFlag,
    '-interaction=nonstopmode',
    '-file-line-error',
    '-synctex=0',
    `-outdir=${BUILD_DIR}`,
    mainFile,
  ];
}

/** Config mainFile → first .tex with a live \documentclass → main.tex → first .tex. */
export async function findMainFile(repoPath, { mainFile } = {}) {
  const tex = (await walkFiles(repoPath, { extensions: ['.tex'] })).map(f => f.path);
  if (mainFile && tex.includes(mainFile)) return mainFile;
  for (const rel of tex) {
    const text = stripComments(await readFile(path.join(repoPath, rel), 'utf8'));
    if (/\\documentclass/.test(text)) return rel;
  }
  return tex.find(f => f === 'main.tex') ?? tex[0] ?? null;
}

async function exists(p) {
  return access(p).then(() => true, () => false);
}

async function hasLatexmkrc(repoPath) {
  return (await exists(path.join(repoPath, 'latexmkrc'))) || exists(path.join(repoPath, '.latexmkrc'));
}

/** Keep the build directory out of `git status` without touching tracked files. */
async function excludeBuildDir(repoPath) {
  const excludeFile = path.join(repoPath, '.git', 'info', 'exclude');
  if (!(await exists(excludeFile))) return;
  const current = await readFile(excludeFile, 'utf8');
  if (!current.split('\n').includes(`${BUILD_DIR}/`)) await appendFile(excludeFile, `${BUILD_DIR}/\n`);
}

export function pdfPathFor(repoPath, mainFile) {
  return path.join(repoPath, BUILD_DIR, `${path.basename(mainFile, '.tex')}.pdf`);
}

/** Run latexmk and return compact diagnostics (never the raw log). */
export async function compileProject({ repoPath, mainFile, engine, timeoutMs = 120_000 }) {
  const started = Date.now();
  await excludeBuildDir(repoPath);
  const args = buildLatexmkArgs({ engine, hasRc: await hasLatexmkrc(repoPath), mainFile });
  const run = await execFile('latexmk', args, { cwd: repoPath, timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 })
    .then(() => ({ exitCode: 0 }))
    .catch(error => ({ exitCode: error.code ?? 1, killed: error.killed, stderr: error.stderr ?? '' }));

  const logPath = path.join(repoPath, BUILD_DIR, `${path.basename(mainFile, '.tex')}.log`);
  const log = await readFile(logPath, 'utf8').catch(() => '');
  const diagnostics = parseLatexLog(log);
  const pdfPath = pdfPathFor(repoPath, mainFile);
  const pdfExists = await exists(pdfPath);
  const ok = run.exitCode === 0 && diagnostics.errors.length === 0 && pdfExists;

  return {
    ok,
    mainFile,
    pdfPath: pdfExists ? pdfPath : null,
    durationMs: Date.now() - started,
    ...diagnostics,
    ...(run.killed ? { timedOut: true } : {}),
    ...(ok ? {} : { logTail: tail(log, 40), latexmkStderr: tail(run.stderr ?? '', 10) }),
  };
}

function tail(text, n) {
  return text.split('\n').slice(-n).join('\n');
}

/** True when the PDF is missing or any source file is newer than it. */
export async function isPdfStale(repoPath, pdfPath) {
  if (!(await exists(pdfPath))) return true;
  const pdfTime = (await stat(pdfPath)).mtimeMs;
  const sources = await walkFiles(repoPath, { extensions: SOURCE_EXTS });
  const times = await Promise.all(sources.map(f => stat(path.join(repoPath, f.path)).then(s => s.mtimeMs)));
  return times.some(t => t > pdfTime);
}
