import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveInside, walkFiles } from '../src/paths.js';

test('resolveInside allows nested paths', () => {
  assert.equal(resolveInside('/repo', 'sections/intro.tex'), '/repo/sections/intro.tex');
});

test('resolveInside rejects escapes and absolute paths', () => {
  assert.throws(() => resolveInside('/repo', '../etc/passwd'), /outside/);
  assert.throws(() => resolveInside('/repo', '/etc/passwd'), /outside/);
  assert.throws(() => resolveInside('/repo', 'a/../../b'), /outside/);
});

test('walkFiles lists relative files, filters by extension, skips .git and .build', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'walk-'));
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, '.build'));
  await mkdir(path.join(root, 'sec'));
  await writeFile(path.join(root, '.git', 'x.tex'), '');
  await writeFile(path.join(root, '.build', 'y.tex'), '');
  await writeFile(path.join(root, 'main.tex'), 'abc');
  await writeFile(path.join(root, 'sec', 'a.tex'), '');
  await writeFile(path.join(root, 'refs.bib'), '');
  await writeFile(path.join(root, 'fig.png'), '');

  const all = await walkFiles(root);
  assert.deepEqual(all.map(f => f.path).sort(), ['fig.png', 'main.tex', 'refs.bib', 'sec/a.tex']);
  assert.equal(all.find(f => f.path === 'main.tex').size, 3);

  const tex = await walkFiles(root, { extensions: ['.tex'] });
  assert.deepEqual(tex.map(f => f.path).sort(), ['main.tex', 'sec/a.tex']);
  await rm(root, { recursive: true });
});
