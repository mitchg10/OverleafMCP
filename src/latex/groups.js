/**
 * Balanced-group reading for LaTeX arguments.
 *
 * Regexes of the `\{([^}]*)\}` shape break on nested braces, which are routine
 * in citation arguments (`\citep[see][]{Key}`, `\cite[\textbf{p.~3}]{Key}`).
 */

/**
 * Read a balanced group starting at `open` at or after `index`, skipping
 * intervening whitespace only.
 *
 * @returns {{ content: string, start: number, end: number }|null}
 *   `end` is the index just past the closing delimiter. null if there is no
 *   group here, or if it is never closed.
 */
export function readGroup(source, index, open = '{', close = '}') {
  const start = skipSpace(source, index);
  if (source[start] !== open) return null;

  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return { content: source.slice(start + 1, i), start, end: i + 1 };
    }
  }
  return null;
}

/** Read `[...]` optional arguments, returning their contents and the new index. */
export function readOptionalArgs(source, index) {
  const args = [];
  let i = index;
  for (;;) {
    const group = readGroup(source, i, '[', ']');
    if (!group) return { args, end: i };
    args.push(group.content);
    i = group.end;
  }
}

export function skipSpace(source, index) {
  let i = index;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}
