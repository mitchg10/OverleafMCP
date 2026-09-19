import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInputs, parseBibResources, bibResourceNames, resolveInputPath, buildInputGraph,
} from '../../src/latex/declarations.js';
import { stripComments } from '../../src/latex/strip-comments.js';

test('finds \\input, \\include and \\subfile with line numbers', () => {
  const src = '\\documentclass{article}\n\\input{sections/intro}\n\\include{body}\n\\subfile{tail.tex}\n';
  assert.deepEqual(parseInputs(src), [
    { raw: 'sections/intro', line: 2 },
    { raw: 'body', line: 3 },
    { raw: 'tail.tex', line: 4 },
  ]);
});

test('the scan is stateless across calls', () => {
  // A module-level regex with /g would carry lastIndex between calls.
  const src = '\\input{a}\n\\input{b}\n';
  assert.deepEqual(parseInputs(src), parseInputs(src));
});

test('distinguishes \\bibliography from \\addbibresource', () => {
  const src = '\\bibliography{refs,more}\n\\addbibresource{extra.bib}\n';
  assert.deepEqual(parseBibResources(src), [
    { raw: 'refs,more', command: 'bibliography', line: 1 },
    { raw: 'extra.bib', command: 'addbibresource', line: 2 },
  ]);
});

test('expands a resource list and supplies the .bib extension', () => {
  assert.deepEqual(bibResourceNames('refs, more'), ['refs.bib', 'more.bib']);
  assert.deepEqual(bibResourceNames('extra.bib'), ['extra.bib']);
  assert.deepEqual(bibResourceNames('Upper.BIB'), ['Upper.BIB']);
  assert.deepEqual(bibResourceNames(' , '), []);
});

test('resolves targets relative to the including file', () => {
  assert.equal(resolveInputPath('main.tex', 'sections/intro'), 'sections/intro.tex');
  assert.equal(resolveInputPath('sections/body.tex', 'sub'), 'sections/sub.tex');
  assert.equal(resolveInputPath('sections/body.tex', '../appendix.tex'), 'appendix.tex');
});

test('walks the input tree, following nested inputs once each', async () => {
  const files = {
    'main.tex': '\\input{a}\n\\input{sections/b}\n',
    'a.tex': '\\input{sections/b}\n',
    'sections/b.tex': 'leaf\n',
  };
  const graph = await buildInputGraph(readerFor(files), 'main.tex');
  assert.deepEqual(graph.files.sort(), ['a.tex', 'main.tex', 'sections/b.tex']);
  assert.deepEqual(graph.missing, []);
  assert.equal(graph.edges.length, 3);
});

test('an unreadable \\input is a finding, not a crash', async () => {
  const graph = await buildInputGraph(readerFor({ 'main.tex': 'x\n\\input{gone}\n' }), 'main.tex');
  assert.deepEqual(graph.missing, [{ from: 'main.tex', raw: 'gone', line: 2 }]);
  assert.deepEqual(graph.files, ['main.tex']);
});

test('a cycle terminates', async () => {
  const files = { 'main.tex': '\\input{a}\n', 'a.tex': '\\input{main.tex}\n' };
  const graph = await buildInputGraph(readerFor(files), 'main.tex');
  assert.deepEqual(graph.files.sort(), ['a.tex', 'main.tex']);
});

test('commented \\input lines are not edges when stripComments is supplied', async () => {
  const files = { 'main.tex': '% \\input{ghost}\n\\input{a}\n', 'a.tex': 'leaf\n' };
  const graph = await buildInputGraph(readerFor(files), 'main.tex', { stripComments });
  assert.deepEqual(graph.files.sort(), ['a.tex', 'main.tex']);
  assert.deepEqual(graph.missing, []);
});

function readerFor(files) {
  return async rel => {
    if (!(rel in files)) throw new Error(`ENOENT: ${rel}`);
    return files[rel];
  };
}
