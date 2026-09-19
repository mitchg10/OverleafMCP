/**
 * Turning messy BibTeX values into things that can be compared or sent to an
 * API. Kept separate from the parser on purpose: the parser preserves evidence,
 * this module destroys it deliberately.
 */

const ACCENT_COMMANDS = /\\[`'^"~=.uvHtcdbkr]\s*\{?([A-Za-z])\}?/g;
const LIGATURES = { ss: 'ss', o: 'o', O: 'O', ae: 'ae', AE: 'AE', oe: 'oe', OE: 'OE', aa: 'aa', AA: 'AA', l: 'l', L: 'L' };
const ARXIV_ID = String.raw`(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})`;

/** Strip LaTeX markup down to plain text: accents, commands, braces, math. */
export function stripLatex(text) {
  return String(text ?? '')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(ACCENT_COMMANDS, '$1')
    .replace(/\\([A-Za-z]+)\s*/g, (all, cmd) => LIGATURES[cmd] ?? ' ')
    .replace(/[{}]/g, '')
    .replace(/\\(.)/g, '$1')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Comparable form of a title: plain text, lowercase, no punctuation.
 * Also what must be sent to OpenAlex, whose query parser rejects raw braces
 * with HTTP 400.
 */
export function normalizeTitle(raw) {
  return stripLatex(raw)
    // Registry titles carry inline markup where BibTeX carries LaTeX: Crossref
    // returns "Cohen's <i>d</i>" for what a .bib writes as "Cohen's {\emph{d}}".
    // Left as tag-shaped only, so a stray "<" in a title is not mistaken for one.
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleTokens(text) {
  return normalizeTitle(text).split(' ').filter(Boolean);
}

/** Jaccard overlap of two token sets. 1 is identical, 0 is disjoint. */
export function jaccard(a, b) {
  const setA = new Set(titleTokens(a));
  const setB = new Set(titleTokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/** Comparable surname: braces and accents removed, lowercased. */
export function normalizeSurname(text) {
  return stripLatex(text).toLowerCase().replace(/[^a-z\s-]/g, '').trim();
}

/**
 * Canonical DOI, or null.
 * Lowercasing is what reconciles this corpus's `10.48550/ARXIV.x` against
 * `10.48550/arXiv.x`, which would otherwise be two cache entries and two lookups.
 */
export function normalizeDoi(raw) {
  if (!raw) return null;
  const text = stripLatex(raw).trim();
  const match = text.match(/10\.\d{4,9}\/\S+/);
  return match ? match[0].replace(/[.,;)]+$/, '').toLowerCase() : null;
}

export function isArxivDoi(doi) {
  return Boolean(doi && doi.startsWith('10.48550/'));
}

/** Publication year as a number, or null. Reads `year`, falling back to `date`. */
export function yearOf(entry) {
  const raw = entry?.fields?.year?.value ?? entry?.fields?.date?.value ?? '';
  const match = stripLatex(raw).match(/\d{4}/);
  return match ? Number.parseInt(match[0], 10) : null;
}

/**
 * Every URL the entry carries, tagged with where it came from.
 * This corpus attaches URLs three different ways, sometimes two in one entry
 * with different targets, so the source tag is the whole point.
 */
export function urlsOf(entry) {
  const out = [];
  const push = (source, text) => {
    for (const m of String(text ?? '').matchAll(/https?:\/\/[^\s{}",]+/g)) {
      out.push({ url: m[0].replace(/[.,;]+$/, ''), source });
    }
  };
  push('url', entry?.fields?.url?.value);
  push('howpublished', entry?.fields?.howpublished?.value);
  push('note', entry?.fields?.note?.value);
  return out;
}

/**
 * arXiv identifier for an entry, or null.
 *
 * Deliberately broad. The textbook idiom `journal={arXiv preprint arXiv:NNNN}`
 * does not appear once in this corpus; what appears instead is some mixture of
 * `eprint`, `archiveprefix`, a `10.48550/ARXIV.*` DOI, `number={arXiv:NNNN}`
 * and a bare arxiv.org URL. Any one of them is enough.
 *
 * @returns {{ id: string, version: number|null, source: string }|null}
 */
export function arxivRef(entry) {
  const fields = entry?.fields ?? {};
  const candidates = [
    ['eprint', fields.eprint?.value],
    ['doi', fields.doi?.value],
    ['number', fields.number?.value],
    ['note', fields.note?.value],
    ['journal', fields.journal?.value],
    ['publisher', fields.publisher?.value],
    ...urlsOf(entry).map(u => [u.source, u.url]),
  ];

  for (const [source, raw] of candidates) {
    const found = extractArxivId(raw);
    if (found) return { ...found, source };
  }
  return null;
}

function extractArxivId(raw) {
  if (!raw) return null;
  const text = stripLatex(raw);
  const patterns = [
    new RegExp(String.raw`arxiv\.org\/(?:abs|pdf)\/${ARXIV_ID}(?:v(\d+))?`, 'i'),
    new RegExp(String.raw`10\.48550\/arxiv\.${ARXIV_ID}(?:v(\d+))?`, 'i'),
    new RegExp(String.raw`arxiv[:\s]\s*${ARXIV_ID}(?:v(\d+))?`, 'i'),
    new RegExp(String.raw`^\s*${ARXIV_ID}(?:v(\d+))?\s*$`, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return { id: m[1], version: m[2] ? Number.parseInt(m[2], 10) : null };
  }
  return null;
}

/**
 * Whether the entry presents itself as a preprint, and why.
 * @returns {{ isPreprint: boolean, arxiv: ReturnType<typeof arxivRef>, signals: string[] }}
 */
export function preprintSignals(entry) {
  const arxiv = arxivRef(entry);
  const signals = [];
  const fields = entry?.fields ?? {};

  if (fields.eprint) signals.push('eprint field');
  if (/arxiv/i.test(fields.archiveprefix?.value ?? fields.eprinttype?.value ?? '')) signals.push('archivePrefix=arXiv');
  if (isArxivDoi(normalizeDoi(fields.doi?.value))) signals.push('arXiv DOI (10.48550)');
  if (/arxiv/i.test(fields.publisher?.value ?? '')) signals.push('publisher=arXiv');
  if (/arxiv|preprint/i.test(fields.journal?.value ?? '')) signals.push('journal mentions arXiv/preprint');
  if (arxiv && signals.length === 0) signals.push(`arXiv id in ${arxiv.source}`);

  return { isPreprint: Boolean(arxiv) || signals.length > 0, arxiv, signals };
}
