import { fieldValue } from '../bib/parse.js';
import { authorSurnames } from '../bib/names.js';
import { jaccard, normalizeSurname, normalizeTitle, titleTokens, yearOf } from '../bib/normalize.js';

/**
 * Deciding whether a registry record is the work an entry cites.
 *
 * Pure and fully testable offline; no module here touches the network.
 *
 * Title similarity alone is not enough. "Attention is all you need" scores 1.00
 * against a 2025 preprint that is not the NeurIPS 2017 paper, so an accept also
 * requires an author surname in common or a year within one. Conversely a
 * fabricated but plausible title scored 0.12 against its nearest real record,
 * so the gate does separate the two cases.
 */

const DEFAULT_THRESHOLDS = Object.freeze({ accept: 0.85, consider: 0.6 });
/**
 * Venue comparison uses containment, not similarity.
 *
 * A bib entry says "Proceedings of the 16th Conference on Creativity &
 * Cognition" where Crossref says "Creativity and Cognition". Those are the same
 * venue, but they share only two tokens out of nine, so a similarity measure
 * calls it a mismatch and would do so on most proceedings entries in a
 * bibliography. Containment asks the question that matters instead: is the
 * shorter name essentially inside the longer one?
 *
 * The accepted cost is that "Nature" no longer mismatches "Nature
 * Communications". That is a rarer error than the noise it replaces, and the
 * identifier has already resolved by the time this runs.
 */
const VENUE_CONTAINMENT_FLOOR = 0.6;
/** Structural words carry no venue identity and swamp the short side. */
const VENUE_STOPWORDS = new Set([
  'proceedings', 'proc', 'the', 'of', 'on', 'in', 'and', 'for', 'a', 'an',
  'conference', 'international', 'annual', 'workshop', 'symposium', 'acm', 'ieee',
]);
const YEAR_TOLERANCE = 1;

/** Token-set similarity of two titles, 0 when either side is missing. */
export function titleScore(a, b) {
  const left = titleTokens(normalizeTitle(a ?? ''));
  const right = titleTokens(normalizeTitle(b ?? ''));
  if (!left.length || !right.length) return 0;
  return jaccard(left, right);
}

/** The venue an entry claims, whatever field it chose to claim it in. */
export function containerOf(entry) {
  for (const name of ['journal', 'journaltitle', 'booktitle', 'series', 'publisher']) {
    const value = fieldValue(entry, name);
    if (value) return value;
  }
  return null;
}

function recordSurnames(record) {
  return (record?.authors ?? [])
    .map(a => normalizeSurname(a?.family ?? a?.name ?? '').toLowerCase())
    .filter(Boolean);
}

/**
 * Score a record against a bib entry.
 *
 * @returns {{ score: number, verdict: 'accept'|'consider'|'reject',
 *             corroboration: { surname: boolean, year: boolean, shared: string[] },
 *             mismatches: Array<{ field: string, bib: string, source: string }> }}
 */
export function scoreMatch(entry, record, thresholds = {}) {
  const { accept, consider } = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const bibTitle = fieldValue(entry, 'title');
  const score = titleScore(bibTitle, record?.title);

  const bibNames = authorSurnames(entry);
  const shared = recordSurnames(record).filter(n => bibNames.includes(n));
  const bibYear = yearOf(entry);
  const year = Number.isFinite(bibYear) && Number.isFinite(record?.year)
    ? Math.abs(bibYear - record.year) <= YEAR_TOLERANCE
    : false;

  const corroboration = { surname: shared.length > 0, year, shared };
  const corroborated = corroboration.surname || corroboration.year;

  return Object.freeze({
    score: Number(score.toFixed(3)),
    // A high title score with nothing else agreeing is exactly the collision
    // case, so it lands in `consider` rather than `accept`.
    verdict: score >= accept && corroborated ? 'accept' : score >= consider ? 'consider' : 'reject',
    corroboration: Object.freeze(corroboration),
    mismatches: Object.freeze(findMismatches(entry, record, { bibTitle, bibYear, score })),
  });
}

/**
 * Fields where both sides state something and the statements differ.
 *
 * Only ever reported for a record we already believe is the right work, so
 * these are corrections to an entry, not evidence against it.
 */
function findMismatches(entry, record, { bibTitle, bibYear, score }) {
  const out = [];
  if (Number.isFinite(bibYear) && Number.isFinite(record?.year) && bibYear !== record.year) {
    out.push({ field: 'year', bib: String(bibYear), source: String(record.year) });
  }
  if (bibTitle && record?.title && score < 1) {
    out.push({ field: 'title', bib: bibTitle, source: record.title });
  }
  const container = containerOf(entry);
  if (container && record?.venue && venueContainment(container, record.venue) < VENUE_CONTAINMENT_FLOOR) {
    out.push({ field: 'venue', bib: container, source: record.venue });
  }
  return out;
}

/** How much of the shorter venue name appears in the longer one, 0 to 1. */
export function venueContainment(a, b) {
  const left = venueTokens(a);
  const right = venueTokens(b);
  // One meaningful token cannot be compared: "Proc. NeurIPS" against "Advances
  // in Neural Information Processing Systems" shares nothing, yet names the
  // same venue. An acronym is unmatchable by tokens, so the honest answer is
  // to say nothing rather than to guess wrong.
  if (Math.min(left.size, right.size) < 2) return 1;
  const shared = [...left].filter(t => right.has(t)).length;
  return shared / Math.min(left.size, right.size);
}

function venueTokens(text) {
  return new Set(titleTokens(normalizeTitle(text ?? '')).filter(t => !VENUE_STOPWORDS.has(t) && !/^\d+(st|nd|rd|th)?$/.test(t)));
}

/** Best-scoring record, or null when none clears `consider`. */
export function bestMatch(entry, records, thresholds = {}) {
  const scored = (records ?? [])
    .filter(Boolean)
    .map(record => ({ record, ...scoreMatch(entry, record, thresholds) }))
    .filter(m => m.verdict !== 'reject')
    .sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}
