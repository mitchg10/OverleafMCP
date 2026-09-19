import { stat } from 'node:fs/promises';
import path from 'node:path';
import { readGroup, readOptionalArgs } from '../latex/groups.js';
import { createLineIndex } from '../latex/line-index.js';
import { resolveInside, walkFiles } from '../paths.js';
import { BUILD_DIR } from '../compile.js';

/**
 * Readers for what the build actually did, as opposed to what the source says.
 *
 * Artifacts outrank source inference wherever they exist: `.aux` `\bibstyle`
 * names the style that really ran, `.bbl` is what the reader sees, and the
 * `.blg` already contains the resolver's own warnings. They are only usable
 * when fresh, so every read reports staleness alongside the content.
 *
 * `.build` is excluded from `walkFiles`, so these reads go through
 * `resolveInside` directly.
 */

const SOURCE_EXTS = ['.tex', '.bib'];

/** Parse a BibTeX or biblatex `.aux` file. */
export function parseAux(source) {
  const citations = [];
  const bibcites = [];
  const lineOf = createLineIndex(source);

  for (const m of source.matchAll(/\\citation\s*(?=\{)/g)) {
    const g = readGroup(source, m.index + m[0].length);
    if (g) citations.push(...splitKeys(g.content));
  }
  // biblatex writes \abx@aux@cite{0}{key} in recent versions, \abx@aux@cite{key} in older ones.
  for (const m of source.matchAll(/\\abx@aux@cite\s*(?=\{)/g)) {
    const first = readGroup(source, m.index + m[0].length);
    if (!first) continue;
    const second = readGroup(source, first.end);
    citations.push(...splitKeys((second ?? first).content));
  }
  for (const m of source.matchAll(/\\bibcite\s*(?=\{)/g)) {
    const key = readGroup(source, m.index + m[0].length);
    const label = key && readGroup(source, key.end);
    if (key) bibcites.push({ key: key.content.trim(), label: label?.content ?? null, line: lineOf(m.index) });
  }

  return Object.freeze({
    citations: [...new Set(citations)],
    bibcites,
    bibdata: argsOf(source, 'bibdata').flatMap(splitKeys),
    bibstyle: argsOf(source, 'bibstyle')[0] ?? null,
  });
}

/** Parse the `.bbl` the reader actually sees. */
export function parseBbl(source) {
  const lineOf = createLineIndex(source);
  const items = [];

  for (const m of source.matchAll(/\\bibitem\s*(?=[[{])/g)) {
    const opts = readOptionalArgs(source, m.index + m[0].length);
    const key = readGroup(source, opts.end);
    if (key) items.push({ key: key.content.trim(), label: opts.args[0] ?? null, line: lineOf(m.index) });
  }
  // biblatex .bbl uses \entry{key}{type}{} instead of \bibitem.
  for (const m of source.matchAll(/\\entry\s*(?=\{)/g)) {
    const key = readGroup(source, m.index + m[0].length);
    const type = key && readGroup(source, key.end);
    if (key) items.push({ key: key.content.trim(), label: null, type: type?.content ?? null, line: lineOf(m.index) });
  }

  return Object.freeze({ items, keys: items.map(i => i.key), format: /\\entry\s*\{/.test(source) ? 'biblatex' : 'bibtex' });
}

/**
 * Warnings from a `.blg`, in either resolver's dialect.
 * BibTeX writes `Warning--can't use both author and editor fields in X`;
 * biber writes `WARN - I didn't find a database entry for 'X'`, sometimes
 * prefixed with an elapsed-time stamp.
 */
export function parseBibLog(source) {
  const lineOf = createLineIndex(source);
  const messages = [];

  for (const m of source.matchAll(/^Warning--(.*)$/gm)) {
    messages.push({ level: 'warning', message: m[1].trim(), key: keyFromBibtexWarning(m[1]), line: lineOf(m.index) });
  }
  // Real biber lines look like `[0.31] Utils.pm:410> WARN - message`, so the
  // prefix has to be skipped generically rather than enumerated.
  for (const m of source.matchAll(/^.*?\b(WARN|ERROR) - (.*)$/gm)) {
    messages.push({
      level: m[1] === 'ERROR' ? 'error' : 'warning',
      message: m[2].trim(),
      // Citekeys never contain spaces, which is what distinguishes the real
      // quoted key from the apostrophe in biber's own "I didn't find ...".
      key: m[2].match(/'([^'\s]+)'/)?.[1] ?? null,
      line: lineOf(m.index),
    });
  }
  for (const m of source.matchAll(/^(I couldn't open|I found no \\\w+ command).*$/gm)) {
    messages.push({ level: 'error', message: m[0].trim(), key: null, line: lineOf(m.index) });
  }

  return Object.freeze({
    // biber's banner is itself inside a log line, so it is not line-anchored.
    engine: /\bThis is Biber\b/.test(source) ? 'biber' : /\bThis is BibTeX\b/.test(source) ? 'bibtex' : 'unknown',
    messages,
    entryCount: numberOr(source.match(/You've used (\d+) entries/)?.[1]),
  });
}

/** Citekeys and datasources from a biblatex `.bcf`, read as text rather than XML. */
export function parseBcf(source) {
  return Object.freeze({
    citekeys: [...new Set([...source.matchAll(/<bcf:citekey[^>]*>([^<]+)<\/bcf:citekey>/g)].map(m => m[1].trim()))],
    datasources: [...source.matchAll(/<bcf:datasource[^>]*>([^<]+)<\/bcf:datasource>/g)].map(m => m[1].trim()),
    style: source.match(/<bcf:option[^>]*\bname="style"[^>]*>\s*<bcf:value>([^<]+)</)?.[1] ?? null,
  });
}

/**
 * Read whatever build artifacts exist for `mainFile`.
 * Missing artifacts are normal (the project may never have been compiled), so
 * they are reported as absent rather than raised.
 *
 * @returns {Promise<{ present: string[], stale: boolean, aux, bbl, blg, bcf, newestSourceMs, oldestArtifactMs }>}
 */
export async function readBuildArtifacts(repoPath, mainFile, { readFileText }) {
  const base = path.basename(mainFile, path.extname(mainFile));
  const parsers = { aux: parseAux, bbl: parseBbl, blg: parseBibLog, bcf: parseBcf };
  const out = { present: [], aux: null, bbl: null, blg: null, bcf: null };
  const times = [];

  for (const [ext, parse] of Object.entries(parsers)) {
    const rel = path.posix.join(BUILD_DIR, `${base}.${ext}`);
    const read = await readArtifact(repoPath, rel, readFileText);
    if (!read) continue;
    out.present.push(rel);
    out[ext] = parse(read.text);
    times.push(read.mtimeMs);
  }

  const newestSourceMs = await newestSourceTime(repoPath);
  const oldestArtifactMs = times.length ? Math.min(...times) : null;
  return Object.freeze({
    ...out,
    newestSourceMs,
    oldestArtifactMs,
    stale: oldestArtifactMs === null || newestSourceMs > oldestArtifactMs,
  });
}

async function readArtifact(repoPath, rel, readFileText) {
  try {
    const abs = resolveInside(repoPath, rel);
    const [text, info] = await Promise.all([readFileText(abs), stat(abs)]);
    return { text, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

/** Mirrors isPdfStale in compile.js, but only .tex and .bib can invalidate a bibliography. */
async function newestSourceTime(repoPath) {
  const files = await walkFiles(repoPath, { extensions: SOURCE_EXTS });
  const times = await Promise.all(
    files.map(f => stat(path.join(repoPath, f.path)).then(s => s.mtimeMs).catch(() => 0)),
  );
  return times.length ? Math.max(...times) : 0;
}

function argsOf(source, command) {
  const out = [];
  for (const m of source.matchAll(new RegExp(String.raw`\\${command}\s*(?=\{)`, 'g'))) {
    const g = readGroup(source, m.index + m[0].length);
    if (g) out.push(g.content.trim());
  }
  return out;
}

function splitKeys(content) {
  return content.split(',').map(k => k.trim()).filter(Boolean);
}

function keyFromBibtexWarning(message) {
  return message.match(/\bin ([^\s,]+)\s*$/)?.[1] ?? null;
}

function numberOr(value) {
  return value === undefined ? null : Number.parseInt(value, 10);
}
