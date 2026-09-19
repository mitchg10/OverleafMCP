import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSection, getSectionContent } from '../../src/latex/section-content.js';

const src = await readFile(new URL('../fixtures/sample.tex', import.meta.url), 'utf8');

test('section content includes subsections by default', () => {
  const { content } = getSectionContent(src, { title: 'Methods' });
  assert.match(content, /Data Collection/);
  assert.match(content, /Confidence in methods/);
  assert.doesNotMatch(content, /Results intro/);
});

test('can exclude subsections', () => {
  const { content } = getSectionContent(src, { title: 'Methods', includeSubsections: false });
  assert.match(content, /Methods intro/);
  assert.doesNotMatch(content, /Data Collection/);
});

test('title match is case-insensitive', () => {
  const { section } = getSectionContent(src, { title: 'methods' });
  assert.equal(section.title, 'Methods');
});

test('ambiguous titles throw with candidate lines', () => {
  assert.throws(() => resolveSection(src, { title: 'Confidence' }), /L29.*L34|line 29.*line 34/s);
});

test('can resolve by line number instead', () => {
  const { section, content } = getSectionContent(src, { line: 34 });
  assert.equal(section.type, 'subsection');
  assert.match(content, /Confidence in results/);
});

test('unknown title lists available sections', () => {
  assert.throws(() => resolveSection(src, { title: 'Nope' }), /not found.*Introduction/s);
});

test('returns start and end lines', () => {
  const { startLine, endLine } = getSectionContent(src, { title: 'Introduction' });
  assert.equal(startLine, 12);
  assert.equal(endLine, 14);
});

test('last section stops before \\end{document}', () => {
  const { content } = getSectionContent(src, { title: 'Acknowledgments' });
  assert.match(content, /\\input\{appendix\}/);
  assert.doesNotMatch(content, /end\{document\}/);
  assert.doesNotMatch(content, /After End/);
});

test('custom headings flow through to content slicing', () => {
  const cv = '\\begin{rSection}{Education}\nPhD\n\\end{rSection}\n\n\\begin{rSection}{Skills}\nLaTeX\n\\end{rSection}\n';
  const r = getSectionContent(cv, { title: 'Education', headings: ['rSection'] });
  assert.equal(r.startLine, 1);
  assert.equal(r.endLine, 3);
});
