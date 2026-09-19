import { normalizeDoi } from '../../bib/normalize.js';
import { asYear, doiPath, first, freezeRecord } from './shared.js';

/**
 * DataCite: the registration authority for arXiv DOIs (`10.48550/*`).
 *
 * This is the one place an arXiv DOI can be checked at all - Crossref returns
 * 404 for every single one of them - so for a preprint-heavy bibliography
 * DataCite carries the identifier verdict that Crossref carries elsewhere.
 *
 * It is also correct in the one case where OpenAlex is known to be wrong
 * (`10.48550/arxiv.2310.06770`), which is why the resolver treats DataCite as
 * an authority and OpenAlex only as corroboration.
 */

const BASE = 'https://api.datacite.org/dois';

export const SOURCE = 'datacite';

export async function fetchByDoi(http, doi, { forceRefresh = false } = {}) {
  const response = await http.get(`${BASE}/${doiPath(doi)}`, { source: SOURCE, kind: 'record', forceRefresh });
  return { ...response, record: response.ok ? toRecord(response.data?.data) : null };
}

export function toRecord(data) {
  const a = data?.attributes;
  if (!a) return null;
  const type = a.types?.resourceTypeGeneral ?? a.types?.resourceType ?? null;
  return freezeRecord({
    source: SOURCE,
    id: data.id ?? a.doi ?? null,
    doi: normalizeDoi(a.doi ?? data.id),
    title: first((a.titles ?? []).map(t => t?.title)),
    authors: (a.creators ?? []).map(c => ({
      // Organizational creators carry only `name`, and splitting it would
      // invent a surname that does not exist.
      family: c.familyName ?? familyFromName(c),
      given: c.givenName ?? null,
    })),
    year: a.publicationYear ?? asYear(a.dates?.find(d => d.dateType === 'Issued')?.date),
    venue: a.container?.title ?? null,
    publisher: typeof a.publisher === 'string' ? a.publisher : (a.publisher?.name ?? null),
    type,
    url: a.url ?? null,
    isPreprint: /preprint/i.test(type ?? '') || /arxiv/i.test(a.publisher?.name ?? a.publisher ?? ''),
    retractions: [],
    /** arXiv registers one DOI per version, so this is how many exist. */
    version: a.version ?? null,
  });
}

function familyFromName(creator) {
  if (creator?.nameType === 'Organizational') return creator.name ?? null;
  const name = creator?.name ?? '';
  // DataCite's personal `name` is conventionally "Family, Given".
  return name.includes(',') ? name.split(',')[0].trim() : (name.trim() || null);
}
