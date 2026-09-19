/**
 * Search a text for a literal or regex pattern. Returns
 * [{ line, text, before: [], after: [] }] with 1-based line numbers.
 */
export function searchText(text, pattern, { regex = false, caseSensitive = false, contextLines = 0 } = {}) {
  const re = buildRegex(pattern, { regex, caseSensitive });
  const lines = text.split('\n');
  return lines.flatMap((lineText, i) => {
    const m = re.exec(lineText);
    return m
      ? [{
          line: i + 1,
          column: m.index + 1,
          text: lineText,
          before: lines.slice(Math.max(0, i - contextLines), i),
          after: lines.slice(i + 1, i + 1 + contextLines),
        }]
      : [];
  });
}

function buildRegex(pattern, { regex, caseSensitive }) {
  const flags = caseSensitive ? '' : 'i';
  const source = regex ? pattern : escapeRegex(pattern);
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new Error(`Invalid regex "${pattern}": ${error.message}`);
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
