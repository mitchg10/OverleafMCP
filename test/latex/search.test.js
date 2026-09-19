import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchText } from '../../src/latex/search.js';

const text = 'one\ntwo cite{a}\nthree\nfour cite{b}\nfive';

test('literal search returns line numbers', () => {
  const hits = searchText(text, 'cite{', { regex: false });
  assert.deepEqual(hits.map(h => h.line), [2, 4]);
});

test('regex search works and is case-insensitive by default', () => {
  const hits = searchText(text, 'CITE\\{(a|b)\\}', { regex: true });
  assert.equal(hits.length, 2);
});

test('context lines are attached', () => {
  const [hit] = searchText(text, 'three', { contextLines: 1 });
  assert.deepEqual(hit.before, ['two cite{a}']);
  assert.deepEqual(hit.after, ['four cite{b}']);
});

test('reports match column so long lines can be windowed', () => {
  const [hit] = searchText('abc needle xyz', 'needle');
  assert.equal(hit.column, 5);
});
