import { normalizeDoi } from '../../bib/normalize.js';
import { doiPath, first, freezeRecord, yearFromParts } from './shared.js';

/**
 * Crossref: the DOI authority for everything except DataCite's registrants.
 *
 * Strong where it applies - a real DOI returns 200 and a fabricated one returns
 * a clean 404 - and that is the single highest-precision signal available.
 *
 * Two limits matter enough to state in output rather than only in code:
 * it does not index arXiv DOIs (`10.48550/*` are DataCite), and it does not
 * index NeurIPS, ICLR or ICML proceedings. For a machine-learning bibliography
 * that is a large share of the entries, so "not in Crossref" carries almost no
 * evidential weight and must never be rendered as "fabricated".
 *
 * It is also the only free source of retraction data, via `updated-by`.
 */

const BASE = 'https://api.crossref.org/works';
const RETRACTION_TYPES = /retraction|withdrawal|removal/i;

export const SOURCE = 'crossref';

/** Look a DOI up directly. `mailto` opts in to the polite pool and is never inferred. */
export async function fetchByDoi(http, doi, { mailto = null, forceRefresh = false } = {}) {
  const response = await http.get(`${BASE}/${doiPath(doi)}${mailto ? `?mailto=${encodeURIComponent(mailto)}` : ''}`, {
    source: SOURCE,
    kind: 'record',
    forceRefresh,
  });
  return { ...response, record: response.ok ? toRecord(response.data?.message) : null };
}

export function toRecord(message) {
  if (!message) return null;
  return freezeRecord({
    source: SOURCE,
    id: message.DOI ?? null,
    doi: normalizeDoi(message.DOI),
    title: first(message.title),
    authors: (message.author ?? []).map(a => ({ family: a.family ?? a.name ?? null, given: a.given ?? null })),
    // `issued` is the earliest known date; the print/online dates can be later.
    year: yearFromParts(message.issued, message['published-print'], message['published-online'], message.created),
    venue: first(message['container-title']) ?? message.event?.name ?? null,
    publisher: message.publisher ?? null,
    type: message.type ?? null,
    url: message.URL ?? null,
    isPreprint: message.type === 'posted-content' || message.subtype === 'preprint',
    retractions: retractionsOf(message),
  });
}

/**
 * Retraction notices pointing at this work.
 *
 * `updated-by` also carries corrections and errata, which are not retractions
 * and must not be reported as one, hence the type filter.
 */
function retractionsOf(message) {
  return (message['updated-by'] ?? [])
    .filter(u => RETRACTION_TYPES.test(u?.type ?? '') || RETRACTION_TYPES.test(u?.label ?? ''))
    .map(u => ({
      type: u.type ?? u.label ?? 'retraction',
      doi: u.DOI ?? null,
      date: u.updated?.['date-time'] ?? null,
      source: u.source ?? null,
    }));
}
