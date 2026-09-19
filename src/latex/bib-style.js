import { stripComments } from './strip-comments.js';
import { createLineIndex } from './line-index.js';
import { readGroup, readOptionalArgs } from './groups.js';
import { NATBIB_COMMANDS, BIBLATEX_COMMANDS } from './cite-scan.js';

/**
 * Which bibliography backend and style a document uses, with the evidence.
 *
 * This cannot be inferred from citation syntax: `\citep` appears both under
 * BibTeX+natbib and under biblatex's `natbib=true` compatibility mode. It also
 * cannot be read from the `.tex` alone: AAAI's `aaai2027.sty` calls
 * `\bibliographystyle` internally and the `.tex` never mentions a style.
 * Every conclusion therefore carries its source and a confidence level.
 */

const PLAIN_BIBTEX_COMMANDS = ['cite', 'nocite'];
const BIBLATEX_CORE_COMMANDS = [...BIBLATEX_COMMANDS, 'cite', 'nocite', 'Cite'];

/**
 * @param {string} mainSource
 * @param {{ file?: string, styFiles?: Array<{path,source}>, texFiles?: Array<{path,source}> }} options
 * @returns {{ backend, package: string|null, style, styleSource, natbibCompat,
 *             allowedCommands, evidence, confidence, options }}
 */
export function detectBibStyle(mainSource, { file = 'main.tex', styFiles = [], texFiles = [] } = {}) {
  const sources = [
    { path: file, source: mainSource, kind: 'tex' },
    ...texFiles.map(f => ({ path: f.path, source: f.source, kind: 'tex' })),
    ...styFiles.map(f => ({ path: f.path, source: f.source, kind: 'sty' })),
  ];

  const evidence = [];
  const packages = new Map();
  const styles = [];
  const resources = [];

  for (const entry of sources) {
    const clean = stripComments(entry.source);
    const lineOf = createLineIndex(clean);
    collectPackages(clean, lineOf, entry, packages, evidence);
    collectStyles(clean, lineOf, entry, styles, evidence);
    collectResources(clean, lineOf, entry, resources, evidence);
  }

  return Object.freeze(
    packages.has('biblatex')
      ? biblatexResult(packages.get('biblatex'), styles, evidence)
      : bibtexResult(packages, styles, resources, evidence),
  );
}

function biblatexResult(pkg, styles, evidence) {
  const opts = pkg.options;
  const style = opts.style ?? opts.bibstyle ?? 'numeric';
  const natbibCompat = /^(true|)$/.test(opts.natbib ?? 'false');
  return {
    backend: opts.backend ?? 'biber',
    package: 'biblatex',
    style,
    styleSource: `${pkg.file}:${pkg.line}`,
    natbibCompat,
    allowedCommands: natbibCompat
      ? [...new Set([...BIBLATEX_CORE_COMMANDS, ...NATBIB_COMMANDS])]
      : BIBLATEX_CORE_COMMANDS,
    // A `.bst` alongside biblatex is a leftover, not the active style.
    options: opts,
    evidence,
    confidence: 'high',
    conflicts: styles.length ? styles.map(s => `\\bibliographystyle at ${s.file}:${s.line} is ignored under biblatex`) : [],
  };
}

function bibtexResult(packages, styles, resources, evidence) {
  const natbib = packages.get('natbib');
  const chosen = pickStyle(styles);
  return {
    backend: 'bibtex',
    package: natbib ? 'natbib' : null,
    style: chosen?.style ?? null,
    styleSource: chosen ? `${chosen.file}:${chosen.line}` : null,
    natbibCompat: Boolean(natbib),
    allowedCommands: natbib
      ? [...new Set([...NATBIB_COMMANDS, ...PLAIN_BIBTEX_COMMANDS])]
      : PLAIN_BIBTEX_COMMANDS,
    options: natbib?.options ?? {},
    evidence,
    confidence: confidenceOf(chosen, resources),
    conflicts: styles.length > 1
      ? [`${styles.length} \\bibliographystyle declarations; the last one executed wins`]
      : [],
  };
}

/** A style set in the document beats one set inside a class or package file. */
function pickStyle(styles) {
  return styles.find(s => s.kind === 'tex') ?? styles[0] ?? null;
}

function confidenceOf(chosen, resources) {
  if (chosen?.kind === 'tex') return 'high';
  if (chosen) return 'medium';
  return resources.length ? 'low' : 'none';
}

function collectPackages(clean, lineOf, entry, packages, evidence) {
  for (const match of clean.matchAll(/\\(?:usepackage|RequirePackage)\s*(?=[[{])/g)) {
    const opts = readOptionalArgs(clean, match.index + match[0].length);
    const group = readGroup(clean, opts.end);
    if (!group) continue;
    for (const name of group.content.split(',').map(n => n.trim())) {
      if (name !== 'biblatex' && name !== 'natbib') continue;
      const record = {
        file: entry.path,
        line: lineOf(match.index),
        kind: entry.kind,
        options: parseOptions(opts.args.join(',')),
      };
      // First declaration wins; a later duplicate load is a no-op in LaTeX.
      if (!packages.has(name)) packages.set(name, record);
      evidence.push({ file: entry.path, line: record.line, text: `\\usepackage{${name}}` });
    }
  }
}

function collectStyles(clean, lineOf, entry, styles, evidence) {
  for (const match of clean.matchAll(/\\bibliographystyle\s*(?=\{)/g)) {
    const group = readGroup(clean, match.index + match[0].length);
    if (!group) continue;
    const line = lineOf(match.index);
    styles.push({ style: group.content.trim(), file: entry.path, line, kind: entry.kind });
    evidence.push({ file: entry.path, line, text: `\\bibliographystyle{${group.content.trim()}}` });
  }
}

function collectResources(clean, lineOf, entry, resources, evidence) {
  for (const match of clean.matchAll(/\\(bibliography|addbibresource)\s*(?=\{)/g)) {
    const group = readGroup(clean, match.index + match[0].length);
    if (!group) continue;
    const line = lineOf(match.index);
    resources.push({ command: match[1], raw: group.content.trim(), file: entry.path, line });
    evidence.push({ file: entry.path, line, text: `\\${match[1]}{${group.content.trim()}}` });
  }
}

/** `style=apa,natbib=true,maxbibnames=99` into an object. Bare keys map to ''. */
function parseOptions(raw) {
  const out = {};
  for (const part of splitTopLevel(raw)) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      if (part.trim()) out[part.trim()] = '';
    } else {
      out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim().replace(/^\{|\}$/g, '');
    }
  }
  return out;
}

function splitTopLevel(raw) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '{') depth += 1;
    else if (raw[i] === '}') depth -= 1;
    else if (raw[i] === ',' && depth === 0) {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}
