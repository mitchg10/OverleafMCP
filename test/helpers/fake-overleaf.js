import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_TERMINAL_PROMPT: '0',
};

async function git(cwd, ...args) {
  const { stdout } = await execFile('git', args, { cwd, env: GIT_ENV });
  return stdout.trim();
}

async function gitRaw(cwd, ...args) {
  const { stdout } = await execFile('git', args, { cwd, env: GIT_ENV });
  return stdout;
}

const FIXTURE_DIR = path.resolve(new URL('../fixtures', import.meta.url).pathname);

/**
 * Creates a bare repo (the "remote") seeded with the fixture files, plus a
 * separate "author" working tree that tests use to simulate edits made on
 * Overleaf. Returns paths and a cleanup function.
 */
export async function createFakeOverleaf({ files } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'fake-overleaf-'));
  const remotePath = path.join(root, 'remote.git');
  const authorPath = path.join(root, 'author');
  const cacheDir = path.join(root, 'cache');

  await git(root, 'init', '--bare', '-b', 'master', remotePath);
  await git(root, 'clone', '-q', remotePath, authorPath);

  const seed = files ?? {
    'main.tex': await readFile(path.join(FIXTURE_DIR, 'sample.tex'), 'utf8'),
    'appendix.tex': await readFile(path.join(FIXTURE_DIR, 'appendix.tex'), 'utf8'),
    'refs.bib': await readFile(path.join(FIXTURE_DIR, 'refs.bib'), 'utf8'),
  };
  await writeAll(authorPath, seed);
  await git(authorPath, 'add', '-A');
  await git(authorPath, 'commit', '-q', '-m', 'Initial');
  await git(authorPath, 'push', '-q', 'origin', 'master');

  return {
    root,
    remoteUrl: remotePath,
    authorPath,
    cacheDir,
    /** Simulate an edit made in the Overleaf UI. */
    async remoteEdit(fileMap, message = 'Update on Overleaf.') {
      await git(authorPath, 'pull', '-q', '--rebase', 'origin', 'master');
      await writeAll(authorPath, fileMap);
      await git(authorPath, 'add', '-A');
      await git(authorPath, 'commit', '-q', '-m', message);
      await git(authorPath, 'push', '-q', 'origin', 'master');
    },
    async remoteLog() {
      return git(remotePath, 'log', '--format=%s', 'master');
    },
    async remoteFile(file) {
      return gitRaw(remotePath, 'show', `master:${file}`);
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function writeAll(dir, fileMap) {
  await Promise.all(
    Object.entries(fileMap).map(async ([rel, content]) => {
      const full = path.join(dir, rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content);
    }),
  );
}
