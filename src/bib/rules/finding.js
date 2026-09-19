/**
 * Shared shapes for rules. Every rule returns new arrays and never touches
 * the model it was given.
 */

export const SEVERITIES = ['error', 'warning', 'info'];

/** @returns {{ rule, severity, file, line, key, message, hint }} */
export function finding(rule, severity, { file = null, line = null, key = null, message, hint = null }) {
  return Object.freeze({ rule, severity, file, line, key, message, hint });
}

/** Locate a specific field inside an entry, falling back to the entry itself. */
export function siteOf(entry, fieldName = null) {
  const field = fieldName ? entry.fields[fieldName] : null;
  return { file: entry.file, line: field?.line ?? entry.line, key: entry.key };
}

/**
 * The dominant convention in a set of observations, and everything that
 * deviates from it.
 *
 * This is how "each paper has its own reference style" is honoured: no
 * convention is imposed from outside, the document's own majority defines the
 * norm and only outliers are reported.
 *
 * @param {Array<{ value: string }>} observations
 * @param {{ minimum?: number, dominance?: number }} [options]
 * @returns {{ majority: string, count: number, total: number, outliers: [] }|null}
 */
export function majorityConvention(observations, { minimum = 4, dominance = 0.8 } = {}) {
  if (observations.length < minimum) return null;

  const counts = new Map();
  for (const o of observations) counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
  if (counts.size < 2) return null;

  const [majority, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  // A near-even split is a choice the author has not made, not an outlier.
  if (count / observations.length < dominance) return null;

  return {
    majority,
    count,
    total: observations.length,
    outliers: observations.filter(o => o.value !== majority),
  };
}
