/**
 * Data tables driving the field rules.
 *
 * Kept as data rather than code so a project with different conventions can be
 * accommodated by editing a table, and so the reasoning behind each entry stays
 * readable.
 */

/**
 * Required fields per entry type. A nested array means "at least one of".
 * `year` accepts biblatex's `date`, and `journal` accepts `journaltitle`,
 * because both spellings occur depending on the backend.
 */
export const REQUIRED_FIELDS = Object.freeze({
  article: [['author'], ['title'], ['journal', 'journaltitle'], ['year', 'date']],
  book: [['author', 'editor'], ['title'], ['publisher'], ['year', 'date']],
  inbook: [['author', 'editor'], ['title'], ['chapter', 'pages'], ['publisher'], ['year', 'date']],
  incollection: [['author'], ['title'], ['booktitle'], ['publisher'], ['year', 'date']],
  inproceedings: [['author'], ['title'], ['booktitle'], ['year', 'date']],
  conference: [['author'], ['title'], ['booktitle'], ['year', 'date']],
  proceedings: [['title'], ['year', 'date']],
  techreport: [['author'], ['title'], ['institution'], ['year', 'date']],
  phdthesis: [['author'], ['title'], ['school', 'institution'], ['year', 'date']],
  mastersthesis: [['author'], ['title'], ['school', 'institution'], ['year', 'date']],
  unpublished: [['author'], ['title'], ['note']],
  manual: [['title']],
  booklet: [['title']],
  // @misc and @online deliberately require nothing: they are the escape hatch.
});

/**
 * Types where BibTeX genuinely rejects having both author and editor.
 *
 * Scoped deliberately. The real `aaai2027.blg` warns about the `@inbook` with
 * both fields but says nothing about the `@article` and `@incollection` that
 * also have both, so a type-blind rule would produce two false positives that
 * the resolver itself does not consider problems.
 */
export const AUTHOR_EDITOR_EXCLUSIVE = Object.freeze(['book', 'inbook']);

/**
 * Outlets whose items are news stories rather than journal articles.
 * `@article` renders them with journal-article semantics (volume, issue,
 * pages), which is why this is worth flagging.
 */
export const NEWS_OUTLETS = Object.freeze([
  'the new york times', 'new york times', 'the washington post', 'washington post',
  'the guardian', 'the atlantic', 'wired', 'mit technology review',
  'technology review', 'the verge', 'forbes', 'bloomberg', 'reuters',
  'the wall street journal', 'wall street journal', 'ars technica', 'techcrunch',
  'the economist', 'financial times', 'npr', 'bbc news', 'cnn', 'axios', 'vox',
]);

/** Fields whose values are URLs, and the convention each represents. */
export const URL_BEARING_FIELDS = Object.freeze(['url', 'howpublished', 'note']);

/** Phrases that duplicate what `urldate` already records. */
export const ACCESSED_PHRASE = /\b(accessed|retrieved|last\s+visited|viewed)\b/i;

/**
 * Fields that carry a place of publication or conference location.
 * `address` is BibTeX, `location` is biblatex.
 */
export const LOCATION_FIELDS = Object.freeze(['address', 'location']);

/** Location values that are legitimately not a place. */
export const NON_PLACE_LOCATIONS = Object.freeze(['virtual', 'online', 'hybrid', 'remote']);

/** Lowercase, no diacritics, no trailing periods: the form `COUNTRIES` is keyed on. */
export function normalizePlace(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/\.+$/, '')
    .trim();
}

/**
 * Spellings that proceedings front matter uses but ICU's canonical region
 * names do not: abbreviations, constituent countries, and shortened forms.
 * Already normalized (see `normalizePlace`).
 */
const COUNTRY_ALIASES = Object.freeze([
  'usa', 'us', 'u.s', 'u.s.a', 'united states of america', 'america',
  'uk', 'u.k', 'great britain', 'england', 'scotland', 'wales', 'northern ireland',
  'uae', 'korea', 'republic of korea', 'the netherlands', 'holland', 'turkey',
  'burma', 'myanmar', 'viet nam', 'hong kong', 'macau', 'macao', 'czech republic',
  'russian federation', 'ivory coast', 'palestine', 'north macedonia',
]);

/**
 * Countries as they appear at the end of a location, from the runtime's own
 * ISO 3166 data (`Intl.DisplayNames`) plus `COUNTRY_ALIASES`. A bare US state
 * abbreviation is deliberately absent: "Austin, TX" is the case being caught.
 */
export const COUNTRIES = (() => {
  const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const found = new Set(COUNTRY_ALIASES);
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b;
      if (code === 'ZZ') continue;
      const name = names.of(code);
      if (name) found.add(normalizePlace(name));
    }
  }
  return found;
})();
