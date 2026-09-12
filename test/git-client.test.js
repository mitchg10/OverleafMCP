import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFakeOverleaf } from './helpers/fake-overleaf.js';
import { createGitClient, scrubSecrets, ConflictError } from '../src/git-client.js';

describe('git client against a fake remote', () => {
  let fake;
  let client;
  before(async () => {
    fake = await createFakeOverleaf();
    client = createGitClient({
      projectId: 'abc123',
      gitToken: 'olp_SECRET',
      cacheDir: fake.cacheDir,
      remoteUrl: fake.remoteUrl,
      ttlMs: 60_000,
    });
  });
  after(() => fake.cleanup());

  test('clones on first sync and reads files', async () => {
    const r = await client.sync();
    assert.equal(r.action, 'cloned');
    const text = await readFile(path.join(client.repoPath, 'main.tex'), 'utf8');
    assert.match(text, /Introduction/);
  });

  test('second sync within TTL is skipped; force pulls', async () => {
    assert.equal((await client.sync()).action, 'skipped');
    assert.equal((await client.sync({ force: true })).action, 'pulled');
  });

  test('picks up remote edits on forced sync', async () => {
    await fake.remoteEdit({ 'main.tex': 'remote change\n' });
    await client.sync({ force: true });
    assert.equal(await readFile(path.join(client.repoPath, 'main.tex'), 'utf8'), 'remote change\n');
  });

  test('reports last commit', async () => {
    const c = await client.lastCommit();
    assert.equal(c.message, 'Update on Overleaf.');
    assert.match(c.hash, /^[0-9a-f]{7,}$/);
  });

  test('does not pull over dirty working tree', async () => {
    await writeFile(path.join(client.repoPath, 'main.tex'), 'local edit\n');
    const r = await client.sync({ force: true });
    assert.equal(r.action, 'skipped-dirty');
    assert.deepEqual(await client.changedFiles(), ['main.tex']);
    assert.match(await client.diff(), /\+local edit/);
  });

  test('commit + push lands on the remote', async () => {
    const r = await client.commitAndPush('Edit via test');
    assert.equal(r.pushed, true);
    assert.match(await fake.remoteLog(), /^Edit via test/);
    assert.equal(await fake.remoteFile('main.tex'), 'local edit\n');
  });

  test('push rebases cleanly over non-conflicting remote commits', async () => {
    await fake.remoteEdit({ 'other.tex': 'x\n' });
    await writeFile(path.join(client.repoPath, 'main.tex'), 'local edit 2\n');
    const r = await client.commitAndPush('Second edit');
    assert.equal(r.pushed, true);
    assert.match(await fake.remoteLog(), /Second edit/);
    assert.equal(await fake.remoteFile('other.tex'), 'x\n');
  });

  test('conflicting push aborts the rebase and reports files', async () => {
    await fake.remoteEdit({ 'main.tex': 'remote wins\n' });
    await writeFile(path.join(client.repoPath, 'main.tex'), 'local wants\n');
    await assert.rejects(client.commitAndPush('Conflict edit'), err => {
      assert.ok(err instanceof ConflictError);
      assert.deepEqual(err.files, ['main.tex']);
      return true;
    });
    // Rebase was aborted: local commit still exists, tree is clean and not mid-rebase
    assert.deepEqual(await client.changedFiles(), []);
    assert.equal((await client.lastCommit()).message, 'Conflict edit');
    assert.equal(await client.hasUnpushedCommits(), true);
  });

  test('discard resets local commits and working tree to the remote', async () => {
    await writeFile(path.join(client.repoPath, 'scratch.tex'), 'junk\n');
    await client.discard();
    assert.deepEqual(await client.changedFiles(), []);
    assert.equal(await client.hasUnpushedCommits(), false);
    assert.equal(await readFile(path.join(client.repoPath, 'main.tex'), 'utf8'), 'remote wins\n');
  });
});

test('scrubSecrets removes Overleaf tokens', () => {
  assert.equal(scrubSecrets('failed https://git:olp_abcDEF123@git.overleaf.com/x', 'olp_abcDEF123'), 'failed https://git:***@git.overleaf.com/x');
  assert.equal(scrubSecrets('token olp_zzz here'), 'token *** here');
});

test('auth failure never leaks the token', async () => {
  const client = createGitClient({
    projectId: 'nonexistent',
    gitToken: 'olp_LEAKME',
    cacheDir: path.join(process.env.TMPDIR ?? '/tmp', `gc-${Date.now()}`),
    remoteUrl: '/nonexistent/path/to/repo.git',
  });
  await assert.rejects(client.sync(), err => {
    assert.doesNotMatch(err.message, /LEAKME/);
    return true;
  });
});
