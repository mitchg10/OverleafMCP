import path from 'node:path';
import { createLineIndex } from './line-index.js';

/**
 * Declarations that point at other files: \input/\include/\subfile and the two
 * bibliography-resource forms. Kept in one place because several tools need to
 * follow the same edges, and because the two regexes below used to live in
 * status-summary.js where nothing else could reach them.
 *
 * Every function builds its own RegExp. A shared /g regex carries mutable
 * lastIndex state across callers, which is exactly the kind of shared mutation
 * that produces intermittent, order-dependent bugs.
 */

const INPUT_PATTERN = String.raw`\\(?:input|include|subfile)\{([^}]+)\}`;
const BIB_PATTERN = String.raw`\\(bibliography|addbibresource)\{([^}]+)\}`;

export const inputRe = () => new RegExp(INPUT_PATTERN, 'g');
export const bibRe = () => new RegExp(BIB_PATTERN, 'g');

/** 1-based line number of a character offset. */
export function lineAt(source, index) {
  return createLineIndex(source)(index);
}

/**
 * \input/\include/\subfile targets, in source order.
 * Pass comment-stripped source: commented-out \input lines are not edges.
 * @returns {{ raw: string, line: number }[]}
 */
export function parseInputs(source) {
  const lineOf = createLineIndex(source);
  return [...source.matchAll(inputRe())].map(m => ({
    raw: m[1].trim(),
    line: lineOf(m.index),
  }));
}

/**
 * \bibliography{...} and \addbibresource{...} declarations, in source order.
 * `raw` is the un-split argument; use bibResourceNames to expand it.
 * @returns {{ raw: string, command: 'bibliography'|'addbibresource', line: number }[]}
 */
export function parseBibResources(source) {
  const lineOf = createLineIndex(source);
  return [...source.matchAll(bibRe())].map(m => ({
    raw: m[2].trim(),
    command: m[1],
    line: lineOf(m.index),
  }));
}

/**
 * Expand one declaration argument into .bib paths.
 * \bibliography takes a comma-separated list without extensions, but both
 * \bibliography{refs.bib} and \addbibresource{refs.bib} occur in the wild.
 */
export function bibResourceNames(raw) {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => (s.toLowerCase().endsWith('.bib') ? s : `${s}.bib`));
}

/** Resolve an \input target relative to the including file, adding .tex if absent. */
export function resolveInputPath(fromFile, raw) {
  const withExt = path.extname(raw) ? raw : `${raw}.tex`;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), withExt));
}

/**
 * Walk the \input tree from a root .tex file.
 * `readText` is the project's reader; files it cannot read are recorded in
 * `missing` rather than throwing, because a stale \input is a finding, not a crash.
 *
 * @param {(rel: string) => Promise<string>} readText
 * @param {string} mainFile
 * @param {{ stripComments?: (s: string) => string }} [options]
 * @returns {Promise<{ files: string[], missing: {from: string, raw: string, line: number}[], edges: {from: string, to: string}[] }>}
 */
export async function buildInputGraph(readText, mainFile, { stripComments = s => s } = {}) {
  const visited = new Set();
  const missing = [];
  const edges = [];

  async function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);

    let source;
    try {
      source = stripComments(await readText(file));
    } catch {
      return;
    }

    for (const { raw, line } of parseInputs(source)) {
      const target = resolveInputPath(file, raw);
      edges.push({ from: file, to: target });
      if (visited.has(target)) continue;
      try {
        await readText(target);
      } catch {
        missing.push({ from: file, raw, line });
        continue;
      }
      await visit(target);
    }
  }

  await visit(mainFile);
  return { files: [...visited], missing, edges };
}
