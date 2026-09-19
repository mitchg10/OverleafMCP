import { fieldValue } from '../bib/parse.js';
import { arxivRef, isArxivDoi, normalizeDoi } from '../bib/normalize.js';
import { classifyUnverifiable } from '../bib/rules/unverifiable.js';
import * as crossref from './sources/crossref.js';
import * as datacite from './sources/datacite.js';
import * as doiHandle from './sources/doi-handle.js';
import { scoreMatch } from './match.js';

/**
 * The tier ladder.
 *
 * Order is deliberate and load-bearing:
 *
 * 1. The design gate runs before anything else, so an entry marked
 *    `pubstate={submitted}` never leaves the machine. That is the user's own
 *    unpublished work and no third party gets to see it.
 * 2. Identifiers before searches. A DOI is an exact claim that can be checked
 *    exactly; a title search is a guess that can collide.
 * 3. Authority is per-source and never pooled. DataCite decides arXiv DOIs,
 *    Crossref decides the rest. OpenAlex is corroboration only, because it has
 *    confirmed-wrong records and promoting it would launder them into verdicts.
 */

/** DataCite registers arXiv's DOIs under this prefix, one per version. */
const ARXIV_DOI_PREFIX = '10.48550/arxiv.';

/**
 * @param {object} entry Parsed bib entry.
 * @param {{ http: object, thresholds?: object, mailto?: string|null,
 *           forceRefresh?: boolean, selfAuthors?: string[] }} options
 */
export async function resolveEntry(entry, { http, thresholds = {}, mailto = null, forceRefresh = false, selfAuthors = [] } = {}) {
  const base = { key: entry.key, file: entry.file, line: entry.line, requests: [] };

  // Checked by its flag, never by truthiness: this classifier always returns
  // an object, and reading it as a boolean would exclude the whole bibliography.
  const excluded = classifyUnverifiable(entry, { selfAuthors });
  if (excluded.unverifiable) {
    return verdict(base, 'unverifiable-by-design', { reason: excluded.reason, notes: [excluded.reason] });
  }

  const identifier = identifierOf(entry);
  if (!identifier) {
    return verdict(base, 'unverified', {
      notes: ['no DOI or arXiv id in the entry; only identifier lookups are enabled'],
    });
  }

  const looked = await lookUp(http, identifier, { mailto, forceRefresh });
  const requests = looked.responses.map(describe);

  if (!looked.record) {
    // A transient failure and a definitive 404 are different claims and must
    // not collapse into the same tier.
    if (!looked.responses.every(r => r.status === 404)) {
      return verdict({ ...base, requests }, 'error', {
        identifier,
        notes: looked.responses.filter(r => !r.ok).map(r => `${r.source}: ${r.error}`),
      });
    }
    return unresolved(entry, identifier, { http, forceRefresh, base, requests, consulted: looked.consulted });
  }

  const match = scoreMatch(entry, looked.record, thresholds);
  const notes = [];
  if (identifier.derived) notes.push(`DOI derived from the entry's arXiv id (${identifier.from})`);

  if (looked.record.retractions.length) {
    return verdict({ ...base, requests }, 'retracted', { identifier, record: looked.record, match, notes });
  }
  // The identifier already resolved, so the work exists; the match only decides
  // whether the entry describes it correctly.
  const tier = match.mismatches.length ? 'verified-with-mismatch' : 'verified';
  return verdict({ ...base, requests }, tier, { identifier, record: looked.record, match, notes });
}

/**
 * Nothing holds the metadata. Before calling the identifier invalid, ask the
 * Handle System whether the DOI exists at all - a metadata gap is common and
 * says nothing about the citation, while a missing registration is the real
 * signal.
 */
async function unresolved(entry, identifier, { http, forceRefresh, base, requests, consulted }) {
  const handle = await doiHandle.lookUp(http, identifier.value, { forceRefresh });
  const withHandle = [...requests, describe(handle.response)];

  if (handle.status === 'exists') {
    return verdict({ ...base, requests: withHandle }, 'unverified', {
      identifier,
      resolvesTo: handle.target,
      notes: [
        `the DOI is registered and resolves to ${handle.target ?? 'its publisher'}, ` +
        `but ${consulted.join(' and ')} hold no metadata for it, so the entry's fields could not be checked`,
      ],
    });
  }
  if (handle.status === 'unknown') {
    return verdict({ ...base, requests: withHandle }, 'error', {
      identifier,
      notes: [`could not reach the DOI registry: ${handle.response.error}`],
    });
  }
  return verdict({ ...base, requests: withHandle }, 'invalid-identifier', {
    identifier,
    notes: [`${identifier.type} ${identifier.value} is not registered with ${consulted.join(', ')}, or with the DOI registry itself`],
  });
}

/** The strongest identifier the entry offers, preferring one it states outright. */
export function identifierOf(entry) {
  const doi = normalizeDoi(fieldValue(entry, 'doi'));
  if (doi) return { type: 'doi', value: doi, arxiv: isArxivDoi(doi), derived: false, from: 'doi' };

  const arxiv = arxivRef(entry);
  if (arxiv) {
    return {
      type: 'doi',
      value: `${ARXIV_DOI_PREFIX}${arxiv.id}`,
      arxiv: true,
      derived: true,
      from: arxiv.source,
      arxivId: arxiv.id,
    };
  }
  return null;
}

/**
 * Ask the authority for this identifier, and only fall back where a fallback
 * could plausibly hold the record.
 */
async function lookUp(http, identifier, { mailto, forceRefresh }) {
  const responses = [];
  if (identifier.arxiv) {
    // Crossref is not consulted at all: it holds no 10.48550 DOI, so asking
    // would spend a request to learn nothing.
    const response = await datacite.fetchByDoi(http, identifier.value, { forceRefresh });
    responses.push(response);
    return { record: response.record, responses, consulted: ['DataCite'] };
  }

  const primary = await crossref.fetchByDoi(http, identifier.value, { mailto, forceRefresh });
  responses.push(primary);
  if (primary.record) return { record: primary.record, responses, consulted: ['Crossref'] };
  // Plenty of real DOIs are DataCite registrations (datasets, software,
  // institutional repositories), so a Crossref 404 is not the end of it.
  if (primary.status === 404) {
    const fallback = await datacite.fetchByDoi(http, identifier.value, { forceRefresh });
    responses.push(fallback);
    return { record: fallback.record, responses, consulted: ['Crossref', 'DataCite'] };
  }
  return { record: null, responses, consulted: ['Crossref'] };
}

/** Provenance for one request, so any claim in the output can be audited. */
function describe(response) {
  return Object.freeze({
    source: response.source,
    url: response.url,
    status: response.status,
    fromCache: response.fromCache,
    error: response.error ?? null,
  });
}

function verdict(base, tier, extra = {}) {
  return Object.freeze({
    identifier: null, record: null, match: null, notes: [], reason: null, resolvesTo: null,
    ...base, ...extra, tier,
  });
}
