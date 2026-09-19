import { stripComments, stripVerbatim } from './strip-comments.js';

const SECTION_TYPES = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
const LEVEL = Object.fromEntries(SECTION_TYPES.map((t, i) => [t, i - 1]));

function headingRegex(extra) {
  const names = [...SECTION_TYPES, ...extra].map(escapeRegex).join('|');
  // \name{...}, \name*{...}, \name[short]{...}, or \begin{name}{...}
  return new RegExp(`\\\\(?:begin\\{(${names})\\}|(${names})(\\*?))\\s*(?=\\[|\\{)`, 'g');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function levelOf(type) {
  if (type in LEVEL) return LEVEL[type];
  return /sub/i.test(type) ? 2 : 1;
}

/**
 * Parse sectioning commands into an outline.
 * Each entry: { type, title, shortTitle, starred, level, line, commented, index }.
 * `line` is 1-based. Commented-out headings are skipped unless includeCommented.
 */
export function parseSections(source, { includeCommented = false, headings = [] } = {}) {
  const re = headingRegex(headings);
  // Verbatim bodies are blanked on both passes: a heading shown as sample code
  // is neither a live heading nor a commented-out one, it is not markup at all.
  const clean = stripVerbatim(stripComments(source));
  const live = scan(clean, re).map(s => ({ ...s, commented: false }));
  if (!includeCommented) return live;

  const liveKeys = new Set(live.map(s => s.index));
  const all = scan(stripVerbatim(source), re).map(s => ({ ...s, commented: !liveKeys.has(s.index) }));
  return all;
}

function scan(text, re) {
  const lineStarts = computeLineStarts(text);
  const out = [];
  for (const m of text.matchAll(re)) {
    const parsed = parseHeading(text, m.index + m[0].length);
    if (!parsed) continue;
    const type = m[1] ?? m[2];
    out.push({
      type,
      starred: m[3] === '*',
      level: levelOf(type),
      title: parsed.title,
      shortTitle: parsed.shortTitle,
      index: m.index,
      line: lineAt(lineStarts, m.index),
    });
  }
  return out;
}

function parseHeading(text, pos) {
  let shortTitle = null;
  let cursor = pos;
  if (text[cursor] === '[') {
    const opt = readBalanced(text, cursor, '[', ']');
    if (!opt) return null;
    shortTitle = opt.inner;
    cursor = opt.end;
  }
  if (text[cursor] !== '{') return null;
  const main = readBalanced(text, cursor, '{', '}');
  if (!main) return null;
  return { title: main.inner.trim(), shortTitle };
}

function readBalanced(text, start, open, close) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(lineStarts, index) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Compact, line-anchored text outline for agents. */
export function formatOutline(sections) {
  if (sections.length === 0) return '(no sections found)';
  return sections
    .map(s => {
      const indent = '  '.repeat(Math.max(0, s.level - 1));
      const flag = s.commented ? ' [commented]' : '';
      const type = `${s.type}${s.starred ? '*' : ''}`;
      return `L${s.line}\t${type}\t${indent}${s.title}${flag}`;
    })
    .join('\n');
}
