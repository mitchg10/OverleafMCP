import { yearOf } from '../normalize.js';
import { firstAuthorSurname } from '../names.js';
import { normalizeSurname } from '../normalize.js';

/**
 * Entries that cannot be checked against the outside world, by design.
 *
 * These are almost always the author's own submissions under review. They must
 * be excluded from field rules, and they must never be sent to a third-party
 * API: doing so would leak an unpublished title to a service that logs queries.
 */

const UNVERIFIABLE_STATES = ['submitted', 'inpreparation', 'inpress', 'forthcoming', 'underreview'];
const DEFAULT_NOTE = /\b(under\s+review|submitted|in\s+preparation|forthcoming|to\s+appear)\b/i;

/**
 * @returns {{ unverifiable: boolean, reason: string|null }}
 */
export function classifyUnverifiable(entry, { selfAuthors = [], notePattern = DEFAULT_NOTE } = {}) {
  const state = (entry.fields.pubstate?.value ?? '').toLowerCase().replace(/\s+/g, '');
  if (UNVERIFIABLE_STATES.includes(state)) return reason(`pubstate=${state}`);

  const note = entry.fields.note?.value ?? '';
  if (note && notePattern.test(note)) return reason(`note says "${note.trim().slice(0, 40)}"`);

  const howpublished = entry.fields.howpublished?.value ?? '';
  if (howpublished && notePattern.test(howpublished)) return reason('howpublished marks it unpublished');

  if (entry.type === 'unpublished') return reason('@unpublished');

  // A missing year on the author's own work means it has no publication date yet.
  if (yearOf(entry) === null && isSelfAuthored(entry, selfAuthors)) {
    return reason('no year, and first author is a configured selfAuthor');
  }

  return { unverifiable: false, reason: null };
}

function isSelfAuthored(entry, selfAuthors) {
  if (!selfAuthors.length) return false;
  const first = normalizeSurname(firstAuthorSurname(entry) ?? '');
  return first !== '' && selfAuthors.some(s => normalizeSurname(s) === first);
}

function reason(text) {
  return { unverifiable: true, reason: text };
}

/** Partition entries into checkable and excluded. Neither array shares objects. */
export function partitionUnverifiable(entries, options) {
  const checkable = [];
  const excluded = [];
  for (const entry of entries) {
    const verdict = classifyUnverifiable(entry, options);
    if (verdict.unverifiable) excluded.push({ entry, reason: verdict.reason });
    else checkable.push(entry);
  }
  return { checkable, excluded };
}
