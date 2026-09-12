import { getSectionContent } from './latex/section-content.js';

/**
 * Replace `oldString` with `newString`. Requires exactly one occurrence unless
 * replaceAll. Returns { content, count }.
 */
export function applyEdit(content, oldString, newString, { replaceAll = false } = {}) {
  if (!oldString) throw new Error('oldString must not be empty');
  if (oldString === newString) throw new Error('oldString and newString are identical');
  const count = countOccurrences(content, oldString);
  if (count === 0) {
    throw new Error(
      'oldString not found in file. Re-read the file (read_file returns exact text with line numbers) and copy the text verbatim, including whitespace.',
    );
  }
  if (count > 1 && !replaceAll) {
    throw new Error(
      `oldString occurs ${count} times; include more surrounding context to make it unique, or pass replaceAll: true.`,
    );
  }
  return {
    content: replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, () => newString),
    count,
  };
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/**
 * Replace the body of a section (heading line kept by default). The slice
 * covers subsections when includeSubsections (default), matching get_section_content.
 */
export function replaceSectionBody(source, { title, line, newContent, keepHeading = true, includeSubsections = true, headings }) {
  const { startLine, endLine } = getSectionContent(source, { title, line, includeSubsections, headings });
  const lines = source.split('\n');
  const headEnd = keepHeading ? startLine : startLine - 1;
  const body = ensureTrailingNewline(newContent).split('\n').slice(0, -1);
  return [...lines.slice(0, headEnd), ...body, ...lines.slice(endLine)].join('\n');
}

function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
}
