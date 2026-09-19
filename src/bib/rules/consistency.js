import { finding, siteOf, majorityConvention } from './finding.js';

/**
 * Formatting drift inside a single bibliography.
 *
 * Every rule here is majority-relative: the document's own dominant convention
 * is the norm, and only deviations from it are reported. Nothing is imposed
 * from outside, because "each paper has its own reference style" means there is
 * no universal right answer to compare against.
 *
 * These rules read `nameRaw`, `delimiter` and `rawValue`, which is exactly the
 * evidence a normalising parser would have thrown away.
 */

export const fieldNameCase = {
  id: 'field-case-inconsistent',
  severity: 'warning',
  requires: null,
  check(model) {
    const out = [];
    for (const [name, fields] of fieldsByName(model).entries()) {
      // Looser thresholds than the other conventions on purpose: BibTeX field
      // names are case-insensitive, so a minority spelling carries no meaning
      // and is drift rather than a choice. A single `URL =` among three
      // `url =` is worth reporting; a single bare `year` among three is not.
      const verdict = majorityConvention(
        fields.map(f => ({ ...f, value: f.field.nameRaw })),
        { minimum: 3, dominance: 0.6 },
      );
      if (!verdict) continue;
      for (const o of verdict.outliers) {
        out.push(finding('field-case-inconsistent', 'warning', {
          ...siteOf(o.entry, name),
          message: `"${o.field.nameRaw} =" here; ${verdict.count} of ${verdict.total} entries use "${verdict.majority} ="`,
        }));
      }
    }
    return out;
  },
};

export const valueDelimiter = {
  id: 'value-delimiter-inconsistent',
  severity: 'warning',
  requires: null,
  check(model) {
    const out = [];
    for (const [name, fields] of fieldsByName(model).entries()) {
      // Concatenated values have no single delimiter to compare.
      const usable = fields.filter(f => f.field.delimiter !== 'concat');
      const verdict = majorityConvention(usable.map(f => ({ ...f, value: f.field.delimiter })));
      if (!verdict) continue;
      for (const o of verdict.outliers) {
        out.push(finding('value-delimiter-inconsistent', 'warning', {
          ...siteOf(o.entry, name),
          message: `${name} = ${show(o.field)} (${o.field.delimiter}); ${verdict.count} of ${verdict.total} entries use ${describeDelimiter(verdict.majority)}`,
        }));
      }
    }
    return out;
  },
};

export const citekeyConvention = {
  id: 'citekey-convention-outlier',
  severity: 'info',
  requires: null,
  check(model) {
    const observations = model.entries.map(e => ({ entry: e, value: citekeyShape(e.key) }));
    const verdict = majorityConvention(observations, { minimum: 8, dominance: 0.75 });
    if (!verdict) return [];
    return verdict.outliers.map(o => finding('citekey-convention-outlier', 'info', {
      ...siteOf(o.entry),
      message: `Citekey "${o.entry.key}" is shaped ${o.value}; ${verdict.count} of ${verdict.total} keys are shaped ${verdict.majority}`,
    }));
  },
};

/**
 * Two brace-protection conventions in one file: Zotero emits `{{Title Case}}`
 * around whole phrases, hand-written entries use `{AI}` around acronyms only.
 * Reported once per file rather than per entry, since it is a provenance
 * signal rather than a per-entry defect.
 */
export const braceProtection = {
  id: 'brace-protection-mixed',
  severity: 'info',
  requires: null,
  check(model) {
    const out = [];
    for (const file of model.bibFiles) {
      const titled = file.parsed.entries.filter(e => e.fields.title);
      const doubled = titled.filter(e => /\{\{[^}]/.test(e.fields.title.rawValue));
      const acronym = titled.filter(e => !/\{\{/.test(e.fields.title.rawValue) && /\{[A-Z]{2,}\}/.test(e.fields.title.rawValue));
      if (!doubled.length || !acronym.length) continue;
      out.push(finding('brace-protection-mixed', 'info', {
        file: file.path,
        line: doubled[0].fields.title.line,
        message:
          `${doubled.length} titles use {{double-brace}} protection (typical of Zotero) and ${acronym.length} use {ACRONYM} protection. ` +
          'Both work, but capitalisation will look inconsistent under a title-casing style.',
      }));
    }
    return out;
  },
};

function fieldsByName(model) {
  const map = new Map();
  for (const entry of model.entries) {
    if (entry.partial) continue;
    for (const name of entry.fieldOrder) {
      if (!map.has(name)) map.set(name, []);
      map.get(name).push({ entry, field: entry.fields[name] });
    }
  }
  return map;
}

function citekeyShape(key) {
  return key
    .replace(/[A-Z][a-z]+/g, 'Word')
    .replace(/\d{4}/g, 'YYYY')
    .replace(/[a-z]+/g, 'word')
    .replace(/WordWord+/g, 'WordWord');
}

function describeDelimiter(delimiter) {
  return { brace: '{braces}', quote: '"quotes"', bare: 'bare values', concat: 'concatenation' }[delimiter] ?? delimiter;
}

function show(field) {
  return field.rawValue.length > 30 ? `${field.rawValue.slice(0, 30)}...` : field.rawValue;
}

export const CONSISTENCY_RULES = [fieldNameCase, valueDelimiter, citekeyConvention, braceProtection];
