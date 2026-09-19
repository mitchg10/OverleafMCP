import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAux, parseBbl, parseBibLog, parseBcf } from '../../src/bib/artifacts.js';

test('reads BibTeX citations, labels, data and style from an .aux', () => {
  const aux = parseAux([
    '\\relax',
    '\\citation{AliEtAl_2025}',
    '\\citation{Diener_2010,AliEtAl_2025}',
    '\\bibstyle{aaai2027}',
    '\\bibdata{aaai2027}',
    '\\bibcite{AliEtAl_2025}{{1}{2025}{{Ali et~al.}}{{Ali, Collier}}}',
  ].join('\n'));

  assert.deepEqual(aux.citations, ['AliEtAl_2025', 'Diener_2010']);
  assert.equal(aux.bibstyle, 'aaai2027');
  assert.deepEqual(aux.bibdata, ['aaai2027']);
  assert.equal(aux.bibcites[0].key, 'AliEtAl_2025');
  assert.equal(aux.bibcites[0].label, '{1}{2025}{{Ali et~al.}}{{Ali, Collier}}');
  assert.equal(aux.bibcites[0].line, 6);
});

test('reads biblatex citations in both \\abx@aux@cite spellings', () => {
  const modern = parseAux('\\abx@aux@cite{0}{Smith2020}\n');
  assert.deepEqual(modern.citations, ['Smith2020']);
  const legacy = parseAux('\\abx@aux@cite{Jones2021}\n');
  assert.deepEqual(legacy.citations, ['Jones2021']);
});

test('reads a BibTeX .bbl, keeping the rendered label', () => {
  const bbl = parseBbl([
    '\\begin{thebibliography}{57}',
    '\\bibitem[{Ali et~al.(2025)Ali, Collier}]{AliEtAl_2025}',
    'Ali, A. 2025.',
    '\\newblock A Title.',
    '\\end{thebibliography}',
  ].join('\n'));

  assert.equal(bbl.format, 'bibtex');
  assert.deepEqual(bbl.keys, ['AliEtAl_2025']);
  assert.equal(bbl.items[0].label, '{Ali et~al.(2025)Ali, Collier}');
  assert.equal(bbl.items[0].line, 2);
});

test('reads a biblatex .bbl, which uses \\entry rather than \\bibitem', () => {
  const bbl = parseBbl('\\entry{Smith2020}{article}{}\n  \\name{author}{1}{}{}\n\\endentry\n');
  assert.equal(bbl.format, 'biblatex');
  assert.deepEqual(bbl.keys, ['Smith2020']);
  assert.equal(bbl.items[0].type, 'article');
});

test('reads BibTeX warnings and attributes them to a key', () => {
  const blg = parseBibLog([
    'This is BibTeX, Version 0.99d (TeX Live 2023)',
    'The style file: aaai2027.bst',
    "Warning--can't use both author and editor fields in Diener_2010",
    "You've used 57 entries,",
  ].join('\n'));

  assert.equal(blg.engine, 'bibtex');
  assert.equal(blg.entryCount, 57);
  assert.equal(blg.messages.length, 1);
  assert.equal(blg.messages[0].key, 'Diener_2010');
  assert.equal(blg.messages[0].level, 'warning');
});

test('reads biber warnings, which use a different dialect entirely', () => {
  const blg = parseBibLog([
    '[0] Biber.pm:415> INFO - This is Biber 2.19',
    "[0.31] Utils.pm:410> WARN - I didn't find a database entry for 'Ghost_2020'",
    '[0.40] Utils.pm:410> ERROR - Cannot find file',
  ].join('\n'));

  assert.equal(blg.engine, 'biber', 'biber states its banner inside a prefixed log line');
  assert.deepEqual(blg.messages.map(m => m.level), ['warning', 'error']);
  assert.equal(blg.messages[0].key, 'Ghost_2020');
});

test('recognises the biber banner when present', () => {
  assert.equal(parseBibLog('This is Biber 2.19\nWARN - x\n').engine, 'biber');
});

test('reads citekeys and style from a .bcf without an XML parser', () => {
  const bcf = parseBcf([
    '<bcf:controlfile>',
    '<bcf:option type="singlevalued"><bcf:key>style</bcf:key><bcf:value>ieee</bcf:value></bcf:option>',
    '<bcf:citekey order="1">Smith2020</bcf:citekey>',
    '<bcf:citekey order="2">Smith2020</bcf:citekey>',
    '<bcf:datasource type="file" datatype="bibtex">refs.bib</bcf:datasource>',
    '</bcf:controlfile>',
  ].join('\n'));

  assert.deepEqual(bcf.citekeys, ['Smith2020']);
  assert.deepEqual(bcf.datasources, ['refs.bib']);
});

test('parsers tolerate empty input rather than throwing', () => {
  assert.deepEqual(parseAux('').citations, []);
  assert.deepEqual(parseBbl('').keys, []);
  assert.deepEqual(parseBibLog('').messages, []);
  assert.deepEqual(parseBcf('').citekeys, []);
});
