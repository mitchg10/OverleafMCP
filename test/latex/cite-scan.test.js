import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scanCitations, citedKeys, hasNociteAll } from '../../src/latex/cite-scan.js';

const read = name => readFile(new URL(`../fixtures/tex/${name}`, import.meta.url), 'utf8');
const natbib = await read('natbib-sty.tex');
const decoys = await read('decoys.tex');

test('finds natbib commands with their keys, line and column', () => {
  const cites = scanCitations(natbib, { file: 'natbib-sty.tex' });
  assert.deepEqual(cites.map(c => c.command), ['citep', 'citet', 'cite', 'citeyearpar']);
  assert.equal(cites[0].line, 8);
  assert.equal(cites[0].file, 'natbib-sty.tex');
  assert.ok(cites[0].column > 0);
  assert.equal(cites[1].starred, true);
});

test('ignores commented-out citations but keeps line numbers true', () => {
  const cites = scanCitations(natbib);
  assert.ok(!cites.some(c => c.keys.includes('NeverCited')));
  assert.equal(cites.find(c => c.command === 'citeyearpar').line, 11);
});

test('a file of decoys yields nothing', () => {
  assert.deepEqual(scanCitations(decoys), []);
});

test('splits multiple keys and trims whitespace', () => {
  const [c] = scanCitations('\\citep{ Smith2020 , Jones2021 }');
  assert.deepEqual(c.keys, ['Smith2020', 'Jones2021']);
});

test('reads optional arguments containing nested braces', () => {
  const [c] = scanCitations('\\cite[\\textbf{fig.~2}]{Nested_2022}');
  assert.deepEqual(c.optionalArgs, ['\\textbf{fig.~2}']);
  assert.deepEqual(c.keys, ['Nested_2022']);
});

test('handles both natbib optional arguments', () => {
  const [c] = scanCitations('\\citep[see][p.~3]{Key}');
  assert.deepEqual(c.optionalArgs, ['see', 'p.~3']);
});

test('reads repeated groups for biblatex multicite', () => {
  const [c] = scanCitations('\\parencites[1]{A}[2]{B}');
  assert.deepEqual(c.keys, ['A', 'B']);
  assert.equal(c.multi, true);
  assert.equal(scanCitations('\\parencite{A}')[0].multi, false);
});

test('a longer command name does not match as a shorter one', () => {
  assert.deepEqual(scanCitations('\\citepx{No}'), []);
});

test('an escaped backslash does not start a command', () => {
  assert.deepEqual(scanCitations('text \\\\citep{NotReal}'), []);
});

test('a command with no mandatory argument is not a citation', () => {
  assert.deepEqual(scanCitations('\\cite and then some prose'), []);
});

test('extraCommands lets a project register its own macro', () => {
  assert.deepEqual(scanCitations('\\mycite{Key}'), []);
  const [c] = scanCitations('\\mycite{Key}', { extraCommands: ['mycite'] });
  assert.equal(c.command, 'mycite');
});

test('citedKeys deduplicates in first-appearance order and drops the star', () => {
  const cites = scanCitations('\\cite{B,A}\\citep{A}\\nocite{*}');
  assert.deepEqual(citedKeys(cites), ['B', 'A']);
  assert.equal(hasNociteAll(cites), true);
  assert.equal(hasNociteAll(scanCitations('\\nocite{Specific}')), false);
});
