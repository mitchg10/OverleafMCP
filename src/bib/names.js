import { stripLatex } from './normalize.js';

/**
 * BibTeX author/editor name parsing.
 *
 * BibTeX decides a name's shape by counting commas at brace depth zero, and
 * getting that wrong is how parsers mangle suffixed names. This corpus contains
 * `Clements, III, Herman Ronald`, which is the two-comma "von Last, Jr, First"
 * form; a naive split on the first comma turns the surname into "Clements, III".
 *
 * @typedef {object} BibName
 * @property {string} first
 * @property {string} von
 * @property {string} last
 * @property {string} jr
 * @property {boolean} literal  Corporate name such as {OpenAI}; `last` holds it.
 * @property {string} raw
 */

const ET_AL = 'others';

/**
 * Split an author/editor field value into names.
 * @returns {{ names: BibName[], etAl: boolean }}
 */
export function parseNameList(rawValue) {
  const parts = splitOn(rawValue ?? '', ' and ');
  const etAl = parts.some(p => p.trim().toLowerCase() === ET_AL);
  const names = parts
    .filter(p => p.trim() && p.trim().toLowerCase() !== ET_AL)
    .map(parseName);
  return { names, etAl };
}

/** Parse one name using BibTeX's comma-count dispatch. */
export function parseName(raw) {
  const trimmed = raw.trim();
  const base = { first: '', von: '', last: '', jr: '', literal: false, raw: trimmed };

  if (isBraceWrapped(trimmed)) {
    return { ...base, last: stripOuterBraces(trimmed), literal: true };
  }

  const segments = splitOn(trimmed, ',').map(s => s.trim());

  if (segments.length === 1) return { ...base, ...splitFirstVonLast(segments[0]) };
  if (segments.length === 2) return { ...base, first: segments[1], ...splitVonLast(segments[0]) };
  return { ...base, jr: segments[1], first: segments.slice(2).join(', '), ...splitVonLast(segments[0]) };
}

/** Surname for matching: braces and accents removed so it can be compared. */
export function surnameOf(name) {
  return stripLatex(name?.last ?? '').trim();
}

/** First author's surname, or null when the entry has no author field. */
export function firstAuthorSurname(entry) {
  const field = entry?.fields?.author ?? entry?.fields?.editor;
  if (!field) return null;
  const { names } = parseNameList(field.value);
  return names.length ? surnameOf(names[0]) || null : null;
}

/** All author surnames, lowercased, for set comparison against a registry record. */
export function authorSurnames(entry) {
  const field = entry?.fields?.author ?? entry?.fields?.editor;
  if (!field) return [];
  return parseNameList(field.value)
    .names.map(n => surnameOf(n).toLowerCase())
    .filter(Boolean);
}

/** "First von Last": trailing capitalised run is the surname. */
function splitFirstVonLast(segment) {
  const words = splitOn(segment, ' ').filter(Boolean);
  if (words.length === 0) return { last: '' };
  if (words.length === 1) return { last: words[0] };

  const firstVon = words.findIndex((w, i) => i < words.length - 1 && isLower(w));
  if (firstVon === -1) {
    return { first: words.slice(0, -1).join(' '), last: words[words.length - 1] };
  }

  let lastVon = firstVon;
  for (let i = firstVon; i < words.length - 1; i += 1) {
    if (isLower(words[i])) lastVon = i;
  }
  return {
    first: words.slice(0, firstVon).join(' '),
    von: words.slice(firstVon, lastVon + 1).join(' '),
    last: words.slice(lastVon + 1).join(' '),
  };
}

/** "von Last": leading lowercase run is the von part. */
function splitVonLast(segment) {
  const words = splitOn(segment, ' ').filter(Boolean);
  let i = 0;
  while (i < words.length - 1 && isLower(words[i])) i += 1;
  return { von: words.slice(0, i).join(' '), last: words.slice(i).join(' ') };
}

/** A word is "lowercase" for von purposes based on its first letter outside braces. */
function isLower(word) {
  const bare = word.replace(/[{}\\]/g, '');
  const letter = [...bare].find(c => /[A-Za-z]/.test(c));
  return letter ? letter === letter.toLowerCase() : false;
}

function isBraceWrapped(text) {
  if (!text.startsWith('{') || !text.endsWith('}')) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i === text.length - 1;
    }
  }
  return false;
}

function stripOuterBraces(text) {
  return isBraceWrapped(text) ? text.slice(1, -1) : text;
}

/** Split on a separator, ignoring occurrences inside braces. */
function splitOn(text, separator) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (depth === 0 && text.startsWith(separator, i)) {
      out.push(text.slice(start, i));
      i += separator.length - 1;
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}
