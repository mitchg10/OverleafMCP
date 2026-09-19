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
