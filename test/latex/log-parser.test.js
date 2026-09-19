import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseLatexLog } from '../../src/latex/log-parser.js';

const log = await readFile(new URL('../fixtures/sample.log', import.meta.url), 'utf8');
const r = parseLatexLog(log);

test('extracts file:line errors', () => {
  assert.deepEqual(r.errors, [
    { file: './main.tex', line: 12, message: 'Undefined control sequence.' },
    { file: './sections/intro.tex', line: 4, message: 'LaTeX Error: Environment itemze undefined.' },
  ]);
});

test('extracts undefined references and citations', () => {
  assert.deepEqual(r.undefinedReferences, ['fig:one']);
  assert.deepEqual(r.undefinedCitations, ['jones2019']);
});

test('counts overfull/underfull boxes with locations', () => {
  assert.equal(r.overfullBoxes.length, 2);
  assert.equal(r.overfullBoxes[0].lines, '206--218');
  assert.equal(r.overfullBoxes[0].pt, 11.87);
  assert.equal(r.underfullBoxes, 1);
});

test('reads page count', () => {
  assert.equal(r.pages, 9);
});
