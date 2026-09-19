import { stripComments } from './strip-comments.js';
import { createLineIndex } from './line-index.js';
import { readGroup, readOptionalArgs } from './groups.js';

/**
 * Citation commands seen across the corpus, natbib and biblatex together.
 * Command syntax cannot identify the backend: `\citep` is valid under both
 * natbib and biblatex's `natbib=true` compatibility mode, so this list is
 * deliberately permissive and `bib-style.js` decides what is legal.
 */
export const NATBIB_COMMANDS = [
  'cite', 'citep', 'citet', 'citealp', 'citealt', 'citeauthor', 'citeyear',
  'citeyearpar', 'citenum', 'citetext', 'citefullauthor', 'citeauthoryear',
  'Citep', 'Citet', 'Citealp', 'Citealt', 'Citeauthor',
];

export const BIBLATEX_COMMANDS = [
  'parencite', 'Parencite', 'autocite', 'Autocite', 'textcite', 'Textcite',
  'smartcite', 'Smartcite', 'footcite', 'footcitetext', 'supercite',
  'fullcite', 'citetitle', 'citedate', 'citeurl',
  'parencites', 'autocites', 'textcites', 'smartcites', 'footcites', 'cites',
];

const OTHER_COMMANDS = ['nocite', 'citeA'];

/** Commands taking repeated `[pre][post]{keys}` blocks (biblatex multicite). */
const MULTICITE = new Set(BIBLATEX_COMMANDS.filter(c => c.endsWith('s')));

const ALL_COMMANDS = [...NATBIB_COMMANDS, ...BIBLATEX_COMMANDS, ...OTHER_COMMANDS];

function commandRegex(extra) {
  const names = [...new Set([...ALL_COMMANDS, ...extra])]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
  return new RegExp(String.raw`\\(${names})(\*?)`, 'g');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find every citation command in a `.tex` source.
 *
 * Comments are stripped first, since templates ship commented decoys such as
 * `% \cite{Example}`. `stripComments` preserves line count, so the line and
 * column reported here still point into the original file.
 *
 * @returns {Array<{ command, keys, optionalArgs, starred, multi, line, column, file, raw }>}
 */
export function scanCitations(source, { file = null, extraCommands = [] } = {}) {
  const clean = stripComments(source);
  const lineOf = createLineIndex(clean);
  const re = commandRegex(extraCommands);
  const out = [];

  for (const match of clean.matchAll(re)) {
    const at = match.index;
    if (isEscaped(clean, at) || isCommandPrefix(clean, at + match[0].length)) continue;

    const parsed = readArguments(clean, at + match[0].length, MULTICITE.has(match[1]));
    if (!parsed) continue;

    out.push(Object.freeze({
      command: match[1],
      starred: match[2] === '*',
      keys: parsed.keys,
      optionalArgs: parsed.optionalArgs,
      multi: parsed.groups > 1,
      file,
      line: lineOf(at),
      column: at - clean.lastIndexOf('\n', at - 1),
      raw: clean.slice(at, parsed.end),
    }));
  }
  return out;
}

/** Read `[opt]...{keys}`, repeated for multicite commands. */
function readArguments(source, index, multi) {
  const optionalArgs = [];
  const keys = [];
  let i = index;
  let groups = 0;

  for (;;) {
    const opts = readOptionalArgs(source, i);
    const group = readGroup(source, opts.end);
    if (!group) break;
    optionalArgs.push(...opts.args);
    keys.push(...splitKeys(group.content));
    groups += 1;
    i = group.end;
    if (!multi) break;
  }

  return groups === 0 ? null : { optionalArgs, keys, groups, end: i };
}

/** `\nocite{*}` keeps its `*`; the integrity rules key off it. */
function splitKeys(content) {
  return content.split(',').map(k => k.trim()).filter(Boolean);
}

/** A backslash escaped by another backslash does not start a command. */
function isEscaped(source, index) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/** Guard against `\citepx` matching as `\citep`. */
function isCommandPrefix(source, endIndex) {
  return /[A-Za-z]/.test(source[endIndex] ?? '');
}

/** Distinct keys cited, in first-appearance order. `\nocite{*}` excluded. */
export function citedKeys(citations) {
  const seen = new Set();
  for (const c of citations) for (const k of c.keys) if (k !== '*') seen.add(k);
  return [...seen];
}

export function hasNociteAll(citations) {
  return citations.some(c => c.command === 'nocite' && c.keys.includes('*'));
}
