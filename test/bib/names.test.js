import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBib, entryByKey } from '../../src/bib/parse.js';
import { parseNameList, parseName, surnameOf, firstAuthorSurname, authorSurnames } from '../../src/bib/names.js';

const bib = parseBib(await readFile(new URL('../fixtures/bib/messy.bib', import.meta.url), 'utf8'));

test('no-comma form is First von Last', () => {
  assert.deepEqual(pick(parseName('Jean van de Velde')), { first: 'Jean', von: 'van de', last: 'Velde', jr: '' });
  assert.deepEqual(pick(parseName('Jane Smith')), { first: 'Jane', von: '', last: 'Smith', jr: '' });
});

test('one-comma form is von Last, First', () => {
  assert.deepEqual(pick(parseName('van der Berg, Jan')), { first: 'Jan', von: 'van der', last: 'Berg', jr: '' });
});

test('two-comma form is von Last, Jr, First', () => {
  // The whole reason for comma-count dispatch: a first-comma split would make
  // the surname "Clements, III".
  assert.deepEqual(pick(parseName('Clements, III, Herman Ronald')), {
    first: 'Herman Ronald', von: '', last: 'Clements', jr: 'III',
  });
});

test('a fully braced name is a literal corporate author', () => {
  const n = parseName('{OpenAI}');
  assert.equal(n.literal, true);
  assert.equal(surnameOf(n), 'OpenAI');
});

test('splits on "and" only at brace depth zero', () => {
  const list = parseNameList('Smith, Jane and {Ford and Sons} and Doe, John');
  assert.deepEqual(list.names.map(surnameOf), ['Smith', 'Ford and Sons', 'Doe']);
  assert.equal(list.etAl, false);
});

test('recognises "and others" as et al. rather than a person', () => {
  const list = parseNameList('Jimenez, Carlos E. and Yang, John and others');
  assert.equal(list.etAl, true);
  assert.deepEqual(list.names.map(surnameOf), ['Jimenez', 'Yang']);
});

test('surnames are de-braced and de-accented for matching', () => {
  assert.deepEqual(authorSurnames(entryByKey(bib, 'Accented_2018')), ['simon', 'strasse']);
  assert.equal(firstAuthorSurname(entryByKey(bib, 'SweBench_2023')), 'Jimenez');
});

test('an entry with no author yields no surnames', () => {
  assert.equal(firstAuthorSurname({ fields: {} }), null);
  assert.deepEqual(authorSurnames({ fields: {} }), []);
});

function pick(n) {
  return { first: n.first, von: n.von, last: n.last, jr: n.jr };
}
