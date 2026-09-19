import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { walkFiles } from '../paths.js';
import { findMainFile } from '../compile.js';
import { stripComments } from '../latex/strip-comments.js';
import { buildInputGraph, parseBibResources, bibResourceNames } from '../latex/declarations.js';
import { detectBibStyle } from '../latex/bib-style.js';
import { scanCitations, citedKeys, hasNociteAll } from '../latex/cite-scan.js';
import { parseBib } from './parse.js';
import { readBuildArtifacts } from './artifacts.js';

/**
 * The frozen model every citation rule reads.
 *
 * Reachability matters: a project routinely holds stale drafts and alternative
 * main files (EAAI-27 has both an anonymous and a camera-ready `.tex`). Only
 * files reachable from the chosen main file produce findings; the rest are
 * collected separately so they can be reported without being treated as errors.
 */

/**
 * @param {object} p project handle from ctx.open
 * @param {{ mainFile?: string, bibFile?: string }} [options]
 */
export async function collectBibliography(p, { mainFile, bibFile } = {}) {
  const main = mainFile ?? (await findMainFile(p.repoPath, p.project));
  if (!main) throw new Error('No main .tex file found. Pass mainFile explicitly.');

  const onDisk = await walkFiles(p.repoPath, { extensions: ['.tex', '.bib', '.sty', '.cls'] });
  const graph = await buildInputGraph(p.readText, main, { stripComments });

  const texFiles = await loadTex(p, graph.files);
  const unreachable = onDisk
    .filter(f => f.path.endsWith('.tex') && !graph.files.includes(f.path))
    .map(f => f.path);

  const styFiles = await loadAll(p, onDisk.filter(f => /\.(sty|cls)$/.test(f.path)).map(f => f.path));
  const style = detectBibStyle(texFiles[0]?.source ?? '', {
    file: main,
    texFiles: texFiles.slice(1),
    styFiles,
  });

  const declared = declaredBibFiles(texFiles, main);
  const wanted = bibFile ? [bibFile] : resolveBibFiles(declared, onDisk);
  const { bibFiles, missingBibFiles } = await loadBib(p, wanted);

  const citations = texFiles.flatMap(f => scanCitations(f.source, { file: f.path, extraCommands: p.project.citeCommands ?? [] }));
  const entries = bibFiles.flatMap(f => f.parsed.entries);
  const artifacts = await readBuildArtifacts(p.repoPath, main, { readFileText: abs => readFile(abs, 'utf8') });

  return Object.freeze({
    mainFile: main,
    style,
    texFiles,
    unreachableTexFiles: unreachable,
    missingInputs: graph.missing,
    bibFiles,
    missingBibFiles,
    declaredBibFiles: declared,
    entries,
    byKey: indexByKey(entries),
    duplicateKeys: duplicatesOf(entries),
    citations,
    citedKeys: citedKeys(citations),
    nociteAll: hasNociteAll(citations),
    artifacts,
    project: p.project,
  });
}

async function loadTex(p, files) {
  const loaded = await loadAll(p, files);
  return loaded.map(f => ({ ...f, source: f.source }));
}

async function loadAll(p, files) {
  const results = await Promise.all(
    files.map(async rel => {
      try {
        return { path: rel, source: await p.readText(rel) };
      } catch {
        return null;
      }
    }),
  );
  return results.filter(Boolean);
}

/** `.bib` files named by a declaration, with the declaring site kept for reporting. */
function declaredBibFiles(texFiles, mainFile) {
  const out = [];
  for (const f of texFiles) {
    for (const r of parseBibResources(stripComments(f.source))) {
      for (const name of bibResourceNames(r.raw)) {
        out.push({ name, command: r.command, file: f.path, line: r.line });
      }
    }
  }
  return out.length ? out : [];
}

/**
 * Declarations are relative to the main file and may omit directories, so a
 * declared name also matches a basename anywhere on disk.
 */
function resolveBibFiles(declared, onDisk) {
  const bibsOnDisk = onDisk.filter(f => f.path.toLowerCase().endsWith('.bib')).map(f => f.path);
  if (!declared.length) return bibsOnDisk;
  return [...new Set(declared.map(d => bibsOnDisk.find(b => matchesName(b, d.name)) ?? d.name))];
}

function matchesName(diskPath, declaredName) {
  return diskPath === declaredName || path.posix.basename(diskPath) === path.posix.basename(declaredName);
}

async function loadBib(p, wanted) {
  const bibFiles = [];
  const missingBibFiles = [];
  for (const rel of wanted) {
    try {
      // `%` is not a comment character in BibTeX, so the source is never stripped.
      bibFiles.push({ path: rel, parsed: parseBib(await p.readText(rel), { file: rel }) });
    } catch {
      missingBibFiles.push(rel);
    }
  }
  return { bibFiles, missingBibFiles };
}

function indexByKey(entries) {
  const map = new Map();
  for (const e of entries) if (!map.has(e.key)) map.set(e.key, e);
  return map;
}

function duplicatesOf(entries) {
  const seen = new Map();
  for (const e of entries) {
    if (!seen.has(e.key)) seen.set(e.key, []);
    seen.get(e.key).push(e);
  }
  return [...seen.entries()].filter(([, list]) => list.length > 1).map(([key, list]) => ({ key, entries: list }));
}
