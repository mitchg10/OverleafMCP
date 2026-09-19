import { doiPath } from './shared.js';

/**
 * The Handle System: the only authority on whether a DOI exists at all.
 *
 * This exists because Crossref's works API is not that authority, and treating
 * it as one produces false accusations. `10.1609/aimag.v17i1.1208` is a real AI
 * Magazine DOI that resolves to AAAI, and the `10.1609` prefix is registered
 * with Crossref, yet the works API returns 404 for it - AAAI registered the
 * prefix without depositing queryable metadata for the article. Without this
 * check, every such citation would be reported as an unregistered identifier,
 * which is the worst kind of wrong answer this tool can give.
 *
 * Consulted only when every metadata source has already 404ed, so it costs one
 * extra request in the rare case where the verdict actually turns on it.
 */

const BASE = 'https://doi.org/api/handles';

export const SOURCE = 'doi-handle';

/** responseCode 1 means registered; 100 (with HTTP 404) means it is not. */
const FOUND = 1;

/**
 * @returns {{ status: 'exists'|'absent'|'unknown', target: string|null, response: object }}
 */
export async function lookUp(http, doi, { forceRefresh = false } = {}) {
  const response = await http.get(`${BASE}/${doiPath(doi)}`, { source: SOURCE, kind: 'record', forceRefresh });

  if (response.ok && response.data?.responseCode === FOUND) {
    return { status: 'exists', target: targetOf(response.data), response };
  }
  // Anything other than a clean 404 is our problem, not evidence about the DOI.
  if (response.status === 404) return { status: 'absent', target: null, response };
  return { status: 'unknown', target: null, response };
}

function targetOf(data) {
  return (data?.values ?? []).find(v => v?.type === 'URL')?.data?.value ?? null;
}
