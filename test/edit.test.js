import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyEdit, replaceSectionBody } from '../src/edit.js';

const src = await readFile(new URL('./fixtures/sample.tex', import.meta.url), 'utf8');

test('applyEdit replaces a unique match', () => {
  const r = applyEdit('a b c', 'b', 'X');
  assert.deepEqual(r, { content: 'a X c', count: 1 });
});

test('applyEdit refuses zero matches with a hint', () => {
  assert.throws(() => applyEdit('a b c', 'z', 'X'), /not found/);
});

test('applyEdit refuses multiple matches unless replaceAll', () => {
  assert.throws(() => applyEdit('b b', 'b', 'X'), /2 times/);
  assert.deepEqual(applyEdit('b b', 'b', 'X', { replaceAll: true }), { content: 'X X', count: 2 });
});

test('applyEdit rejects identical old/new', () => {
  assert.throws(() => applyEdit('a', 'a', 'a'), /identical/);
});

test('replaceSectionBody keeps heading and replaces body incl. subsections', () => {
  const out = replaceSectionBody(src, { title: 'Methods', newContent: 'New methods.\n' });
  assert.match(out, /\\section\{Methods\}\nNew methods\.\n\n\\section\{Results\}/);
  assert.doesNotMatch(out, /Data Collection/);
});

test('replaceSectionBody can replace heading too', () => {
  const out = replaceSectionBody(src, {
    title: 'Results', newContent: '\\section{Findings}\nBody.\n', keepHeading: false,
  });
  assert.match(out, /\\section\{Findings\}\nBody\.\n\n\\section\*\{Acknowledgments\}/);
  assert.doesNotMatch(out, /\\section\{Results\}/);
});
