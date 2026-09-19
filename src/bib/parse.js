import { createLineIndex } from '../latex/line-index.js';

/**
 * A BibTeX parser that preserves the raw source of every field.
 *
 * Most parsers normalise as they go. That is the wrong shape here: the
 * consistency checks this feeds exist precisely to notice that one entry wrote
 * `URL = {...}` while the rest wrote `url = {...}`, or that one `year` is bare
 * while the others are braced. Normalising first destroys the evidence, so each
 * field carries both `rawValue`/`nameRaw`/`delimiter` and a normalised `value`.
 *
 * Note that `%` is NOT a comment character in BibTeX. Never run a LaTeX comment
 * stripper over this input.
 *
 * @typedef {object} BibField
 * @property {string} nameRaw   Field name exactly as written, e.g. "URL".
 * @property {string} name      Lowercased canonical name, e.g. "url".
 * @property {string} rawValue  Value exactly as written, delimiters included.
 * @property {string} value     Value with the outer delimiter removed.
 * @property {'brace'|'quote'|'bare'|'concat'} delimiter
 * @property {number} line
 *
 * @typedef {object} BibEntry
 * @property {string} key
 * @property {string} type      Lowercased entry type, e.g. "inproceedings".
 * @property {string} typeRaw
 * @property {Record<string, BibField>} fields  Keyed by lowercased name.
 * @property {string[]} fieldOrder
 * @property {string} raw
 * @property {string|null} file
 * @property {number} line
 * @property {number} endLine
 * @property {boolean} partial  True when the entry depends on @string
 *                              concatenation, crossref or xdata, so field-level
 *                              rules must skip it rather than guess.
 */

const ENTRY_HEAD = /@([A-Za-z]+)[ \t\r\n]*([{(])/y;
const FIELD_NAME = /[ \t\r\n,]*([A-Za-z][A-Za-z0-9_:.+-]*)[ \t\r\n]*=/y;
const INHERITING_FIELDS = ['crossref', 'xdata'];

/**
 * @param {string} source
 * @param {{ file?: string|null }} [options]
 * @returns {{ entries: BibEntry[], strings: Record<string,string>, preambles: string[], errors: {line:number, message:string}[] }}
 */
export function parseBib(source, { file = null } = {}) {
  const lineOf = createLineIndex(source);
  const entries = [];
  const strings = {};
  const preambles = [];
  const errors = [];

  let cursor = 0;
  while (cursor < source.length) {
    const at = source.indexOf('@', cursor);
    if (at === -1) break;

    ENTRY_HEAD.lastIndex = at;
    const head = ENTRY_HEAD.exec(source);
    if (!head) {
      cursor = at + 1;
      continue;
    }

    const close = matchDelimiter(source, ENTRY_HEAD.lastIndex - 1);
    if (close === -1) {
      errors.push({ line: lineOf(at), message: `Unclosed @${head[1]} block` });
      break;
    }

    const typeRaw = head[1];
    const body = source.slice(ENTRY_HEAD.lastIndex, close);
    const kind = typeRaw.toLowerCase();

    if (kind === 'comment') {
      // @comment bodies are free text; nothing to collect.
    } else if (kind === 'preamble') {
      preambles.push(body.trim());
    } else if (kind === 'string') {
      Object.assign(strings, readStringDefinition(body));
    } else {
      const entry = readEntry({
        body,
        bodyStart: ENTRY_HEAD.lastIndex,
        typeRaw,
        start: at,
        close,
        source,
        lineOf,
        file,
        errors,
      });
      if (entry) entries.push(entry);
    }

    cursor = close + 1;
  }

  return { entries, strings, preambles, errors };
}

/** Look up an entry by citekey. */
export function entryByKey(parsed, key) {
  return parsed.entries.find(e => e.key === key) ?? null;
}

/** Field value by name, or null. Case-insensitive. */
export function fieldValue(entry, name) {
  return entry.fields[name.toLowerCase()]?.value ?? null;
}

function readEntry({ body, bodyStart, typeRaw, start, close, source, lineOf, file, errors }) {
  const comma = indexAtDepthZero(body, ',');
  const key = (comma === -1 ? body : body.slice(0, comma)).trim();
  if (!key) {
    errors.push({ line: lineOf(start), message: `@${typeRaw} entry has no citekey` });
    return null;
  }

  const { fields, fieldOrder } = readFields({
    body,
    from: comma === -1 ? body.length : comma + 1,
    absoluteBase: bodyStart,
    lineOf,
    key,
    errors,
  });

  const usesConcat = fieldOrder.some(n => fields[n].delimiter === 'concat');
  const inherits = INHERITING_FIELDS.some(n => n in fields);

  return Object.freeze({
    key,
    type: typeRaw.toLowerCase(),
    typeRaw,
    fields,
    fieldOrder,
    raw: source.slice(start, close + 1),
    file,
    line: lineOf(start),
    endLine: lineOf(close),
    partial: usesConcat || inherits,
  });
}

function readFields({ body, from, absoluteBase, lineOf, key, errors }) {
  const fields = {};
  const fieldOrder = [];
  let i = from;

  while (i < body.length) {
    FIELD_NAME.lastIndex = i;
    const match = FIELD_NAME.exec(body);
    if (!match) break;

    const nameRaw = match[1];
    const name = nameRaw.toLowerCase();
    const valueStart = FIELD_NAME.lastIndex;
    const parsed = readValue(body, valueStart);
    if (!parsed) break;

    const field = Object.freeze({
      nameRaw,
      name,
      rawValue: parsed.rawValue,
      value: parsed.value,
      delimiter: parsed.delimiter,
      line: lineOf(absoluteBase + valueStart),
    });

    if (name in fields) {
      errors.push({ line: field.line, message: `${key}: duplicate field "${nameRaw}"; keeping the first` });
    } else {
      fields[name] = field;
      fieldOrder.push(name);
    }
    i = parsed.end;
  }

  return { fields: Object.freeze(fields), fieldOrder: Object.freeze(fieldOrder) };
}

/** Read one field value, following `#` concatenation when present. */
function readValue(body, from) {
  const parts = [];
  let i = skipSpace(body, from);
  let concat = false;

  for (;;) {
    const part = readValuePart(body, i);
    if (!part) return parts.length ? finishValue(body, from, i, parts, concat) : null;
    parts.push(part);
    i = skipSpace(body, part.end);
    if (body[i] !== '#') break;
    concat = true;
    i = skipSpace(body, i + 1);
  }

  return finishValue(body, from, i, parts, concat);
}

function finishValue(body, from, end, parts, concat) {
  const rawValue = body.slice(from, end).trim();
  return {
    rawValue,
    value: concat ? rawValue : parts[0].inner,
    delimiter: concat ? 'concat' : parts[0].delimiter,
    end,
  };
}

function readValuePart(body, from) {
  const ch = body[from];
  if (ch === undefined) return null;

  if (ch === '{') {
    const close = matchDelimiter(body, from);
    if (close === -1) return null;
    return { inner: body.slice(from + 1, close), delimiter: 'brace', end: close + 1 };
  }

  if (ch === '"') {
    const close = matchQuote(body, from);
    if (close === -1) return null;
    return { inner: body.slice(from + 1, close), delimiter: 'quote', end: close + 1 };
  }

  const end = scanBareValue(body, from);
  if (end === from) return null;
  return { inner: body.slice(from, end).trim(), delimiter: 'bare', end };
}

function scanBareValue(body, from) {
  let i = from;
  while (i < body.length && !',}#'.includes(body[i]) && !/\s/.test(body[i])) i += 1;
  return i;
}

function readStringDefinition(body) {
  const eq = indexAtDepthZero(body, '=');
  if (eq === -1) return {};
  const name = body.slice(0, eq).trim().toLowerCase();
  const parsed = readValue(body, eq + 1);
  return name && parsed ? { [name]: parsed.value } : {};
}

/**
 * Index of the delimiter closing the one at `open`.
 * A backslash escapes the next character, so `\{` does not open a group.
 */
function matchDelimiter(source, open) {
  const closeChar = source[open] === '(' ? ')' : '}';
  const openChar = source[open];
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Closing quote of a "..." value; braces inside still have to balance. */
function matchQuote(source, open) {
  let depth = 0;
  for (let i = open + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '"' && depth === 0) return i;
  }
  return -1;
}

function indexAtDepthZero(source, target) {
  let depth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === target && depth === 0) return i;
  }
  return -1;
}

function skipSpace(source, from) {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}
