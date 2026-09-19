import { finding, siteOf } from './finding.js';
import { urlsOf, stripLatex } from '../normalize.js';
import { REQUIRED_FIELDS, AUTHOR_EDITOR_EXCLUSIVE, NEWS_OUTLETS, ACCESSED_PHRASE } from '../field-rules.js';

/**
 * Per-entry content defects, driven by the tables in `field-rules.js`.
 *
 * Entries marked `partial` by the parser (`@string` concatenation, `crossref`,
 * `xdata`) are skipped throughout: their real field set depends on inheritance
 * this parser does not resolve, so checking them would invent defects.
 */

export const missingRequiredField = {
  id: 'missing-required-field',
  severity: 'warning',
  requires: null,
  check(model) {
    const out = [];
    for (const entry of checkable(model)) {
      const required = REQUIRED_FIELDS[entry.type];
      if (!required) continue;
      for (const alternatives of required) {
        if (alternatives.some(name => hasValue(entry, name))) continue;
        out.push(finding('missing-required-field', 'warning', {
          ...siteOf(entry),
          message: `@${entry.type} ${entry.key} has no ${alternatives.join(' or ')}`,
        }));
      }
    }
    return out;
  },
};

export const authorAndEditor = {
  id: 'author-and-editor',
  severity: 'warning',
  requires: null,
  check(model) {
    return checkable(model)
      .filter(e => AUTHOR_EDITOR_EXCLUSIVE.includes(e.type) && hasValue(e, 'author') && hasValue(e, 'editor'))
      .map(e => finding('author-and-editor', 'warning', {
        ...siteOf(e, 'editor'),
        message: `@${e.type} ${e.key} has both author and editor; BibTeX cannot use both and will drop one`,
        hint: 'For a chapter, keep author and move the volume editor into the booktitle entry.',
      }));
  },
};

export const conflictingUrls = {
  id: 'conflicting-urls',
  severity: 'error',
  requires: null,
  check(model) {
    const out = [];
    for (const entry of checkable(model)) {
      const urls = urlsOf(entry);
      const distinct = [...new Set(urls.map(u => u.url))];
      if (distinct.length < 2) continue;
      out.push(finding('conflicting-urls', 'error', {
        ...siteOf(entry, urls[0].source),
        message:
          `${entry.key} carries ${distinct.length} different URLs: ` +
          urls.map(u => `${u.source}=${u.url}`).join(', '),
        hint: 'Only one will be rendered. Delete the stale one.',
      }));
    }
    return out;
  },
};

export const duplicatedAccessDate = {
  id: 'duplicated-access-date',
  severity: 'info',
  requires: null,
  check(model) {
    return checkable(model)
      .filter(e => hasValue(e, 'urldate') && ACCESSED_PHRASE.test(e.fields.note?.value ?? ''))
      .map(e => finding('duplicated-access-date', 'info', {
        ...siteOf(e, 'note'),
        message: `${e.key} records the access date twice: urldate={${e.fields.urldate.value}} and note={${trim(e.fields.note.value)}}`,
        hint: 'Most styles render urldate themselves, so the note repeats it.',
      }));
  },
};

export const multipleIsbn = {
  id: 'multiple-isbn',
  severity: 'warning',
  requires: null,
  check(model) {
    const out = [];
    for (const entry of checkable(model)) {
      const raw = entry.fields.isbn?.value;
      if (!raw) continue;
      const isbns = stripLatex(raw).split(/[\s,;]+/).filter(t => /[\d-]{10,}/.test(t));
      if (isbns.length < 2) continue;
      out.push(finding('multiple-isbn', 'warning', {
        ...siteOf(entry, 'isbn'),
        message: `${entry.key} lists ${isbns.length} ISBNs in one field (${isbns.join(' ')}); styles render the field verbatim`,
        hint: 'Keep the one matching the edition actually cited.',
      }));
    }
    return out;
  },
};

export const newsAsArticle = {
  id: 'news-as-journal-article',
  severity: 'warning',
  requires: null,
  check(model) {
    const out = [];
    for (const entry of checkable(model)) {
      if (entry.type !== 'article') continue;
      const journal = stripLatex(entry.fields.journal?.value ?? entry.fields.journaltitle?.value ?? '').toLowerCase().trim();
      if (!NEWS_OUTLETS.includes(journal)) continue;
      out.push(finding('news-as-journal-article', 'warning', {
        ...siteOf(entry, 'journal'),
        message: `${entry.key} is an @article with journal={${entry.fields.journal?.value ?? ''}}, which is a news outlet, not a journal`,
        hint: 'Use @misc or @online with a url and urldate so it renders as a news item.',
      }));
    }
    return out;
  },
};

function checkable(model) {
  const excluded = new Set(model.excludedKeys ?? []);
  return model.entries.filter(e => !e.partial && !excluded.has(e.key));
}

function hasValue(entry, name) {
  return Boolean(entry.fields[name]?.value?.trim());
}

function trim(text) {
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

export const FIELD_RULES = [
  missingRequiredField, authorAndEditor, conflictingUrls,
  duplicatedAccessDate, multipleIsbn, newsAsArticle,
];
