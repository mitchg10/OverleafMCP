import { parseSections } from './sections.js';
import { stripComments } from './strip-comments.js';

/**
 * Find a single section by title (case-insensitive) or by heading line.
 * Throws a descriptive error on zero or multiple matches.
 */
export function resolveSection(source, { title, line, headings }) {
  const sections = parseSections(source, { headings });
  if (line !== undefined) return byLine(sections, line);
  if (title) return byTitle(sections, title);
  throw new Error('Provide either sectionTitle or line');
}

function byLine(sections, line) {
  const hit = sections.find(s => s.line === line);
  if (hit) return { section: hit, sections };
  const near = sections.filter(s => Math.abs(s.line - line) <= 5).map(describe);
  throw new Error(`No section heading on line ${line}.${near.length ? ` Nearby: ${near.join(', ')}` : ''}`);
}

function byTitle(sections, title) {
  const want = normalize(title);
  const hits = sections.filter(s => normalize(s.title) === want);
  if (hits.length === 1) return { section: hits[0], sections };
  if (hits.length > 1) {
    throw new Error(
      `Section title "${title}" is ambiguous (${hits.map(describe).join(', ')}). Pass line instead.`,
    );
  }
  const fuzzy = sections.filter(s => normalize(s.title).includes(want)).map(describe);
  const available = fuzzy.length ? fuzzy : sections.map(describe);
  throw new Error(`Section "${title}" not found. Available: ${available.join(', ')}`);
}

function describe(s) {
  return `${s.type} "${s.title}" (L${s.line})`;
}

function normalize(t) {
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Slice the source for a section. Returns { section, content, startLine, endLine }.
 * With includeSubsections (default) the slice runs until the next heading of
 * equal-or-higher level; otherwise until the next heading of any level.
 */
export function getSectionContent(source, { title, line, includeSubsections = true, headings }) {
  const { section, sections } = resolveSection(source, { title, line, headings });
  const lines = source.split('\n');
  const startLine = section.line;
  const docEnd = findDocumentEnd(source, lines.length);
  const endLine = trimTrailingBlank(lines, startLine, findEndLine(section, sections, docEnd, includeSubsections));
  return {
    section,
    startLine,
    endLine,
    content: lines.slice(startLine - 1, endLine).join('\n'),
  };
}

function findEndLine(section, sections, docEndExclusive, includeSubsections) {
  const after = sections.filter(s => s.line > section.line);
  const stop = includeSubsections
    ? after.find(s => s.level <= section.level)
    : after[0];
  return (stop ? stop.line : docEndExclusive) - 1;
}

function trimTrailingBlank(lines, startLine, endLine) {
  let end = endLine;
  while (end > startLine && lines[end - 1].trim() === '') end -= 1;
  return end;
}

/** 1-based line of \end{document} (exclusive bound), or one past the last line. */
function findDocumentEnd(source, totalLines) {
  const idx = stripComments(source).split('\n').findIndex(l => /\\end\{document\}/.test(l));
  return idx === -1 ? totalLines + 1 : idx + 1;
}
