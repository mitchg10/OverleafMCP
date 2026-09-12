/**
 * Remove LaTeX comments (unescaped `%` to end of line) while preserving
 * line count so downstream line numbers stay aligned with the source.
 */
export function stripComments(source) {
  return source
    .split('\n')
    .map(stripLineComment)
    .join('\n');
}

function stripLineComment(line) {
  const idx = findCommentStart(line);
  return idx === -1 ? line : line.slice(0, idx);
}

function findCommentStart(line) {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '%') return i;
    i += 1;
  }
  return -1;
}
