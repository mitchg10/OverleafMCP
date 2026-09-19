import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectBibStyle } from '../../src/latex/bib-style.js';

const read = name => readFile(new URL(`../fixtures/tex/${name}`, import.meta.url), 'utf8');
const [natbibTex, styFile, apaTex, ieeeTex, plainTex, decoys] = await Promise.all(
  ['natbib-sty.tex', 'fakestyle.sty', 'biblatex-apa.tex', 'biblatex-ieee.tex', 'plain-bibtex.tex', 'decoys.tex'].map(read),
);

test('finds a style declared inside a .sty, not in the document', () => {
  // The AAAI case: the .tex never names a style.
  const r = detectBibStyle(natbibTex, {
    file: 'natbib-sty.tex',
    styFiles: [{ path: 'fakestyle.sty', source: styFile }],
  });
  assert.equal(r.backend, 'bibtex');
  assert.equal(r.package, 'natbib');
  assert.equal(r.style, 'fakestyle2027');
  assert.equal(r.styleSource, 'fakestyle.sty:4');
  assert.equal(r.natbibCompat, true);
  assert.equal(r.confidence, 'medium');
});

test('is not fooled by a commented-out \\bibliographystyle decoy', () => {
  const r = detectBibStyle(natbibTex, { file: 'natbib-sty.tex' });
  assert.equal(r.style, null);
  assert.equal(r.confidence, 'low', 'a \\bibliography with no style is a weak signal');
  assert.ok(!r.evidence.some(e => e.text.includes('acm')));
});

test('reads the biblatex backend and style from package options', () => {
  const r = detectBibStyle(apaTex, { file: 'biblatex-apa.tex' });
  assert.equal(r.backend, 'biber');
  assert.equal(r.package, 'biblatex');
  assert.equal(r.style, 'apa');
  assert.equal(r.confidence, 'high');
  assert.deepEqual(r.options, { style: 'apa', natbib: 'true', backend: 'biber' });
});

test('natbib=true widens the legal command set, and its absence narrows it', () => {
  const apa = detectBibStyle(apaTex, { file: 'biblatex-apa.tex' });
  assert.equal(apa.natbibCompat, true);
  assert.ok(apa.allowedCommands.includes('citep'));
  assert.ok(apa.allowedCommands.includes('parencite'));

  const ieee = detectBibStyle(ieeeTex, { file: 'biblatex-ieee.tex' });
  assert.equal(ieee.natbibCompat, false);
  assert.equal(ieee.style, 'ieee');
  assert.ok(!ieee.allowedCommands.includes('citep'), '\\citep is illegal without natbib=true');
  assert.ok(ieee.allowedCommands.includes('autocite'));
});

test('plain BibTeX without natbib allows only \\cite and \\nocite', () => {
  const r = detectBibStyle(plainTex, { file: 'plain-bibtex.tex' });
  assert.equal(r.backend, 'bibtex');
  assert.equal(r.package, null);
  assert.equal(r.style, 'apalike');
  assert.equal(r.confidence, 'high');
  assert.deepEqual(r.allowedCommands, ['cite', 'nocite']);
});

test('a document with no bibliography at all reports no confidence', () => {
  const r = detectBibStyle(decoys, { file: 'decoys.tex' });
  assert.equal(r.confidence, 'none');
  assert.equal(r.style, null);
  assert.deepEqual(r.evidence, []);
});

test('every conclusion carries file:line evidence', () => {
  const r = detectBibStyle(natbibTex, {
    file: 'natbib-sty.tex',
    styFiles: [{ path: 'fakestyle.sty', source: styFile }],
  });
  const shown = r.evidence.map(e => `${e.file}:${e.line} ${e.text}`);
  assert.ok(shown.includes('natbib-sty.tex:6 \\usepackage{natbib}'));
  assert.ok(shown.includes('fakestyle.sty:4 \\bibliographystyle{fakestyle2027}'));
});

test('a leftover \\bibliographystyle under biblatex is reported as a conflict', () => {
  const src = '\\usepackage[backend=biber]{biblatex}\n\\bibliographystyle{plain}\n';
  const r = detectBibStyle(src, { file: 'x.tex' });
  assert.equal(r.package, 'biblatex');
  assert.match(r.conflicts[0], /ignored under biblatex/);
});

test('the result is frozen', () => {
  const r = detectBibStyle(plainTex, { file: 'plain-bibtex.tex' });
  assert.throws(() => { r.backend = 'biber'; }, TypeError);
});
