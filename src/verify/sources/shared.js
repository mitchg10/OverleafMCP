/**
 * The one record shape every source normalizes into.
 *
 * Sources disagree about almost everything - field names, author encoding,
 * where the year lives, what counts as a venue - so each adapter flattens its
 * own API into this, and `match.js` never learns that any of them exist.
 *
 * @typedef {object} VerifiedRecord
 * @property {string} source           'crossref' | 'datacite' | 'openalex' | 'arxiv' | 'semantic-scholar'
 * @property {string|null} id          The source's own identifier.
 * @property {string|null} doi         Lowercased.
 * @property {string|null} title
 * @property {Array<{family: string|null, given: string|null}>} authors
 * @property {number|null} year
 * @property {string|null} venue       Journal, proceedings or event name.
 * @property {string|null} publisher
 * @property {string|null} type        The source's own type string, left raw for display.
 * @property {string|null} url
 * @property {boolean} isPreprint
 * @property {Array<{type: string, doi: string|null, date: string|null, source: string|null}>} retractions
 */

/** DOIs are path segments, but their slashes are structural and must stay. */
export function doiPath(doi) {
  return String(doi).split('/').map(encodeURIComponent).join('/');
}

export function first(list) {
  return Array.isArray(list) ? (list.find(v => typeof v === 'string' && v.trim()) ?? null) : (list ?? null);
}

/** Crossref and DataCite both express dates as nested date-parts arrays. */
export function yearFromParts(...candidates) {
  for (const candidate of candidates) {
    const year = candidate?.['date-parts']?.[0]?.[0];
    if (Number.isFinite(year)) return year;
  }
  return null;
}

export function asYear(value) {
  const year = Number.parseInt(String(value ?? '').slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

export function freezeRecord(record) {
  return Object.freeze({
    id: null, doi: null, title: null, authors: [], year: null, venue: null,
    publisher: null, type: null, url: null, isPreprint: false, retractions: [],
    ...record,
  });
}

/** Whether a query should be sent at all, given how little the entry states. */
export function hasQueryableTitle(title) {
  return typeof title === 'string' && title.trim().length >= 8;
}
