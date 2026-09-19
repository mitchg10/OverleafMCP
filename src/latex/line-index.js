/**
 * Offset-to-line lookup. Building the index once and binary searching beats
 * counting newlines per lookup, which matters for a .bib with hundreds of
 * fields where every field wants its own line number.
 */
export function createLineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }

  /** 1-based line number containing `index`. */
  return function lineOf(index) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
