import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSections, formatOutline } from '../../src/latex/sections.js';

const src = await readFile(new URL('../fixtures/sample.tex', import.meta.url), 'utf8');

test('skips commented-out sections by default', () => {
  const titles = parseSections(src).map(s => s.title);
  assert.ok(!titles.includes('Commented Out Section'));
  assert.ok(!titles.includes('After End'));
  assert.ok(!titles.includes('Fake'));
});

test('includes commented sections when asked, flagged', () => {
  const all = parseSections(src, { includeCommented: true });
  const c = all.find(s => s.title === 'Commented Out Section');
  assert.equal(c.commented, true);
  assert.equal(c.line, 3);
});

test('reports 1-based line numbers and levels', () => {
  const s = parseSections(src);
  const intro = s.find(x => x.title === 'Introduction');
  assert.equal(intro.line, 12);
  assert.equal(intro.level, 1);
  assert.equal(s.find(x => x.title === 'Prior Studies').level, 2);
});

test('handles nested braces, optional short title, and starred forms', () => {
  const s = parseSections(src);
  assert.ok(s.some(x => x.title === 'Using \\LaTeX{} Well' && x.type === 'subsubsection'));
  const bg = s.find(x => x.title === 'Background \\& Related Work');
  assert.equal(bg.shortTitle, 'Short');
  const ack = s.find(x => x.title === 'Acknowledgments');
  assert.equal(ack.starred, true);
});

test('formatOutline is compact and line-anchored', () => {
  const out = formatOutline(parseSections(src));
  assert.match(out, /^L12\s+section\s+Introduction$/m);
  assert.match(out, /^L18\s+subsection\s+Prior Studies$/m);
});

test('custom heading commands and environments via headings option', () => {
  const cv = '\\begin{rSection}{Education}\nx\n\\end{rSection}\n\\cvsection{Skills}\n\\cvsubsection{Languages}\n% \\begin{rSection}{Old}\n';
  const s = parseSections(cv, { headings: ['rSection', 'cvsection', 'cvsubsection'] });
  assert.deepEqual(s.map(x => [x.type, x.title, x.level, x.line]), [
    ['rSection', 'Education', 1, 1],
    ['cvsection', 'Skills', 1, 4],
    ['cvsubsection', 'Languages', 2, 5],
  ]);
  assert.equal(parseSections(cv).length, 0);
});
