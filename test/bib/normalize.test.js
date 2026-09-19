import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBib, entryByKey } from '../../src/bib/parse.js';
import {
  stripLatex, normalizeTitle, jaccard, normalizeDoi, isArxivDoi,
  yearOf, urlsOf, arxivRef, preprintSignals,
} from '../../src/bib/normalize.js';

const bib = parseBib(await readFile(new URL('../fixtures/bib/messy.bib', import.meta.url), 'utf8'));

test('strips braces, accents, macros and math', () => {
  assert.equal(stripLatex("Sim{\\'o}n Bol{\\'i}var"), 'Simon Bolivar');
  assert.equal(stripLatex('G{\\"u}nter Stra{\\ss}e'), 'Gunter Strasse');
  assert.equal(stripLatex('A $O(n^2)$ bound on {{GDPval}}'), 'A bound on GDPval');
});

test('normalised titles are safe to put in a query string', () => {
  const t = normalizeTitle('{SWE}-bench: Can Language Models Resolve Real-World {GitHub} Issues?');
  assert.equal(t, 'swe bench can language models resolve real world github issues');
  // Raw braces are what produced HTTP 400 from OpenAlex.
  assert.ok(!/[{}?:]/.test(t));
});

test('jaccard separates a real match from a plausible fabrication', () => {
  assert.equal(jaccard('{SWE}-bench: Can Language Models Resolve Real-World {GitHub} Issues?',
    'SWE-bench: Can Language Models Resolve Real-World GitHub Issues?'), 1);
  assert.ok(jaccard('Attention Is All You Need', 'Deep Contextual Reasoning for Curriculum Design') < 0.2);
  assert.equal(jaccard('', 'anything'), 0);
});

test('DOIs are lowercased so ARXIV and arXiv are one cache key', () => {
  assert.equal(normalizeDoi('10.48550/ARXIV.2310.06770'), '10.48550/arxiv.2310.06770');
  assert.equal(normalizeDoi('https://doi.org/10.1145/3641554.3701825'), '10.1145/3641554.3701825');
  assert.equal(normalizeDoi('{10.1145/xyz}.'), '10.1145/xyz');
  assert.equal(normalizeDoi('not a doi'), null);
  assert.equal(normalizeDoi(undefined), null);
  assert.equal(isArxivDoi('10.48550/arxiv.2310.06770'), true);
  assert.equal(isArxivDoi('10.1145/xyz'), false);
});

test('reads the year from bare or braced values', () => {
  assert.equal(yearOf(entryByKey(bib, 'BareYear_2025')), 2025);
  assert.equal(yearOf(entryByKey(bib, 'Braced_2026')), 2026);
  assert.equal(yearOf(entryByKey(bib, 'Submitted_2026')), null);
});

test('collects URLs from all three conventions, tagged by source', () => {
  assert.deepEqual(urlsOf(entryByKey(bib, 'Howpublished_2025')),
    [{ url: 'https://example.org/four', source: 'howpublished' }]);
  const conflict = urlsOf(entryByKey(bib, 'ConflictingUrls_2025'));
  assert.deepEqual(conflict.map(u => u.source), ['url', 'note']);
  assert.equal(new Set(conflict.map(u => u.url)).size, 2);
});

test('finds arXiv ids across every idiom in the corpus', () => {
  assert.deepEqual(arxivRef(entryByKey(bib, 'SweBench_2023')), { id: '2310.06770', version: null, source: 'eprint' });
  assert.deepEqual(arxivRef(entryByKey(bib, 'CasedArxivDoi_2025')), { id: '2503.04761', version: null, source: 'doi' });
  assert.deepEqual(arxivRef(entryByKey(bib, 'UrlOnlyArxiv_2024')), { id: '2401.00001', version: 2, source: 'url' });
  assert.equal(arxivRef(entryByKey(bib, 'Braced_2026')), null);
});

test('preprint signals name their evidence and ignore ordinary entries', () => {
  const swe = preprintSignals(entryByKey(bib, 'SweBench_2023'));
  assert.equal(swe.isPreprint, true);
  assert.ok(swe.signals.includes('eprint field'));
  assert.ok(swe.signals.includes('arXiv DOI (10.48550)'));
  assert.ok(swe.signals.includes('publisher=arXiv'));
  assert.equal(preprintSignals(entryByKey(bib, 'Braced_2026')).isPreprint, false);
});

test('only the three preprints in the fixture are flagged', () => {
  const keys = bib.entries.filter(e => preprintSignals(e).isPreprint).map(e => e.key);
  assert.deepEqual(keys, ['SweBench_2023', 'CasedArxivDoi_2025', 'UrlOnlyArxiv_2024']);
});

test('LaTeX and registry inline markup normalize to the same title', () => {
  // The real case: this entry's title is "Cohen's {\\emph{d}}" and Crossref
  // returns "Cohen's <i>d</i>". Without this, a correct entry is reported as
  // a title mismatch.
  assert.equal(normalizeTitle("Cohen's {\\emph{d}}"), normalizeTitle("Cohen's <i>d</i>"));
});

test('subscripts survive as their content', () => {
  assert.equal(normalizeTitle('H<sub>2</sub>O uptake'), 'h 2 o uptake');
});

test('a bare less-than is not treated as markup', () => {
  assert.equal(normalizeTitle('Bounds where a < b holds'), 'bounds where a b holds');
});
