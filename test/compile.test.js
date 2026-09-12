import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildLatexmkArgs, compileProject, isPdfStale, findMainFile } from '../src/compile.js';
import { renderPage, pdfText } from '../src/render.js';

const hasLatexmk = await promisify(execFile)('which', ['latexmk']).then(() => true, () => false);

test('buildLatexmkArgs respects engine and latexmkrc', () => {
  assert.ok(buildLatexmkArgs({ engine: 'xelatex', hasRc: true, mainFile: 'm.tex' }).includes('-xelatex'));
  assert.ok(buildLatexmkArgs({ engine: undefined, hasRc: false, mainFile: 'm.tex' }).includes('-pdf'));
  const rcArgs = buildLatexmkArgs({ engine: undefined, hasRc: true, mainFile: 'm.tex' });
  assert.ok(!rcArgs.some(a => ['-pdf', '-xelatex', '-lualatex'].includes(a)));
  assert.ok(rcArgs.includes('-outdir=.build'));
});

test('findMainFile prefers config, then \\documentclass, then main.tex', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'main-'));
  await cp(new URL('./fixtures/', import.meta.url), dir, { recursive: true });
  assert.equal(await findMainFile(dir, { mainFile: 'appendix.tex' }), 'appendix.tex');
  assert.equal(await findMainFile(dir, {}), 'sample.tex');
  assert.equal(await findMainFile(dir, { mainFile: 'missing.tex' }), 'sample.tex');
  await rm(dir, { recursive: true });
});

test('compileProject builds the fixture and reports diagnostics', { skip: !hasLatexmk }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'compile-'));
  await cp(new URL('./fixtures/', import.meta.url), dir, { recursive: true });
  const r = await compileProject({ repoPath: dir, mainFile: 'sample.tex' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.pages, 2);
  assert.ok((await stat(r.pdfPath)).size > 0);
  assert.deepEqual(r.undefinedReferences, ['fig:one']);
  assert.equal(await isPdfStale(dir, r.pdfPath), false);

  const img = await renderPage({ pdfPath: r.pdfPath, page: 1, dpi: 40 });
  assert.equal(img.mimeType, 'image/png');
  assert.ok(img.data.length > 100);
  const text = await pdfText({ pdfPath: r.pdfPath, firstPage: 1, lastPage: 1 });
  assert.match(text, /Introduction/);

  await assert.rejects(renderPage({ pdfPath: r.pdfPath, page: 5, dpi: 40 }), /only has 2 pages/);
  await rm(dir, { recursive: true });
});

test('compileProject surfaces errors from a broken document', { skip: !hasLatexmk }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'compile-bad-'));
  await cp(new URL('./fixtures/', import.meta.url), dir, { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(dir, 'bad.tex'), '\\documentclass{article}\n\\begin{document}\n\\foobar\n\\end{document}\n');
  const r = await compileProject({ repoPath: dir, mainFile: 'bad.tex' });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].line, 3);
  assert.match(r.errors[0].message, /Undefined control sequence/);
  await rm(dir, { recursive: true });
});
