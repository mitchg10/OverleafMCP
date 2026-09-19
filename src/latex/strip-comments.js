/**
 * Environments whose body is typeset literally, so a `%` inside one is a
 * percent sign rather than the start of a comment.
 */
const VERBATIM_ENVIRONMENTS = ['verbatim', 'Verbatim', 'lstlisting', 'minted', 'alltt'];

const BEGIN_VERBATIM = new RegExp(`\\\\begin\\{((?:${VERBATIM_ENVIRONMENTS.join('|')})\\*?)\\}`);

/**
 * Resolve comments and verbatim bodies in a single forward pass, because
 * neither can be decided alone: whether a `%` opens a comment depends on
 * being inside a verbatim body, and spotting `\begin{verbatim}` depends on
 * knowing which `%` are comments.
 *
 * Returns one entry per source line, `{ text, verbatim }`, where `text` has
 * its comment removed unless the line sits inside a verbatim body. The
 * `\begin` and `\end` lines are not themselves marked verbatim — they are
 * ordinary LaTeX and may carry a trailing comment.
 */
function scanLines(source) {
  const out = [];
  let open = null;
  for (const line of source.split('\n')) {
    if (open) {
      const marker = `\\end{${open}}`;
      const at = line.indexOf(marker);
      if (at === -1) {
        out.push({ text: line, verbatim: true });
        continue;
      }
      const upToEnd = at + marker.length;
      open = null;
      out.push({ text: line.slice(0, upToEnd) + stripLineComment(line.slice(upToEnd)), verbatim: false });
      continue;
    }
    const text = stripLineComment(line);
    const begun = BEGIN_VERBATIM.exec(text);
    if (begun) open = begun[1];
    out.push({ text, verbatim: false });
  }
  return out;
}

/**
 * Remove LaTeX comments (unescaped `%` to end of line) while preserving
 * line count so downstream line numbers stay aligned with the source.
 * Verbatim bodies are left untouched.
 */
export function stripComments(source) {
  return scanLines(source).map(l => l.text).join('\n');
}

/**
 * Blank the body of every verbatim-like environment, preserving line count, so
 * that sample LaTeX shown as code is not read as real markup — a `\section{…}`
 * inside a listing is not a heading. Comments are left in place; compose with
 * stripComments where both are wanted.
 */
export function stripVerbatim(source) {
  const lines = source.split('\n');
  return scanLines(source).map((l, i) => (l.verbatim ? '' : lines[i])).join('\n');
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
