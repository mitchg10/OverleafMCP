import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBib, entryByKey, fieldValue } from '../../src/bib/parse.js';

const src = await readFile(new URL('../fixtures/bib/messy.bib', import.meta.url), 'utf8');
const bib = parseBib(src, { file: 'messy.bib' });

test('parses every entry in the fixture with no errors', () => {
  assert.equal(bib.errors.length, 0);
  assert.equal(bib.entries.length, 15);
  assert.deepEqual(Object.keys(bib.strings), ['aaaipress']);
});

test('ignores text between entries, since % is not a BibTeX comment', () => {
  assert.ok(!bib.entries.some(e => e.key.includes('reproduces')));
  assert.equal(entryByKey(bib, 'Braced_2026').line, 8);
});

test('preserves the raw field name so case drift stays visible', () => {
  const upper = entryByKey(bib, 'UpperUrl_2024');
  assert.equal(upper.fields.url.nameRaw, 'URL');
  assert.equal(upper.fields.url.name, 'url');
  assert.equal(entryByKey(bib, 'Braced_2026').fields.url.nameRaw, 'url');
});

test('preserves the value delimiter so bare-vs-braced stays visible', () => {
  assert.equal(entryByKey(bib, 'BareYear_2025').fields.year.delimiter, 'bare');
  assert.equal(entryByKey(bib, 'BareYear_2025').fields.year.value, '2025');
  assert.equal(entryByKey(bib, 'Braced_2026').fields.year.delimiter, 'brace');
});

test('keeps brace protection in the raw value but not in the parsed value', () => {
  const f = entryByKey(bib, 'Braced_2026').fields.title;
  assert.match(f.rawValue, /\{Paper\}/);
  assert.equal(f.value, 'A Perfectly Ordinary {Paper} About {AI}');
});

test('normalises the entry type but keeps the raw spelling', () => {
  const paren = entryByKey(bib, 'ParenDelimited_2019');
  assert.equal(paren.type, 'article');
  assert.equal(paren.typeRaw, 'Article');
});

test('marks entries using @string concatenation as partial', () => {
  assert.equal(entryByKey(bib, 'Concatenated_2020').partial, true);
  assert.equal(entryByKey(bib, 'Braced_2026').partial, false);
});

test('records field order and line spans for reporting', () => {
  const e = entryByKey(bib, 'UpperUrl_2024');
  assert.deepEqual(e.fieldOrder, ['author', 'title', 'journal', 'year', 'url']);
  assert.ok(e.endLine > e.line);
  assert.equal(e.file, 'messy.bib');
});

test('entries are frozen so rules cannot mutate the model', () => {
  assert.throws(() => { entryByKey(bib, 'Braced_2026').key = 'x'; }, TypeError);
});

test('fieldValue and entryByKey are case-insensitive on the name', () => {
  assert.equal(fieldValue(entryByKey(bib, 'Braced_2026'), 'TITLE'), 'A Perfectly Ordinary {Paper} About {AI}');
  assert.equal(entryByKey(bib, 'missing'), null);
});

test('reports an unterminated entry as an error rather than throwing', () => {
  const bad = parseBib('@article{Broken_2020,\n  title = {No closing brace\n');
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0].message, /unterminated|unclosed|end of/i);
});
