import { execFile as execFileCb } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const TOKEN_RE = /olp_[A-Za-z0-9_-]+/g;
const COMMIT_IDENTITY = ['-c', 'user.name=Claude (Overleaf MCP)', '-c', 'user.email=overleaf-mcp@localhost'];
// The token reaches git only through the environment, never argv or the remote URL.
const CREDENTIAL_HELPER = '!f() { echo username=git; echo "password=$OVERLEAF_GIT_TOKEN"; }; f';

const lastSyncAt = new Map();

export class ConflictError extends Error {
  constructor(files) {
    super(
      `Push rejected: Overleaf has conflicting changes in ${files.join(', ')}. ` +
        'The rebase was aborted; your commit is still local. Run sync to inspect the remote version, ' +
        're-apply the edit on top of it, or discard_changes to drop the local commit.',
    );
    this.name = 'ConflictError';
    this.files = files;
  }
}

/**
 * Credential-bearing URL parameters, which appear in verification requests.
 * Redacted by parameter name rather than by value shape: a generic
 * "long hex string" pattern would also eat git SHAs, which are not secrets and
 * are load-bearing in this tool's output.
 */
const URL_SECRET_PARAM_RE = /([?&](?:[A-Za-z]+[-_])?(?:api[-_]?key|key|token|mailto)=)[^&\s]+/gi;

/** Replace Overleaf git tokens in any text before it leaves this module. */
export function scrubSecrets(text, token) {
  const scrubbedKnown = token ? String(text).split(token).join('***') : String(text);
  return scrubbedKnown.replace(TOKEN_RE, '***').replace(URL_SECRET_PARAM_RE, '$1***');
}

/**
 * A scrubber that removes an explicit list of secret values.
 *
 * Value-based by design. API keys have no reliable shape to match on, so the
 * only safe approach is to redact the exact strings we know are secret.
 *
 * @param {{ secrets?: string[] }} options
 * @returns {(text: string) => string}
 */
export function createScrubber({ secrets = [] } = {}) {
  // Longest first, so a secret containing another is redacted whole.
  const values = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  return function scrub(text) {
    let out = scrubSecrets(text);
    for (const secret of values) out = out.split(secret).join('***');
    return out;
  };
}

/**
 * Git operations for one Overleaf project, cached at cacheDir/<projectId>.
 * `remoteUrl` is overridable for tests (a local bare repo).
 */
export function createGitClient({ projectId, gitToken, cacheDir, remoteUrl, ttlMs = 30_000 }) {
  const repoPath = path.join(cacheDir, projectId);
  const url = remoteUrl ?? `https://git.overleaf.com/${projectId}`;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', OVERLEAF_GIT_TOKEN: gitToken };

  async function git(args, opts = {}) {
    try {
      // An empty credential.helper clears system/global helpers (e.g. osxkeychain)
      // so the token from projects.json is the only credential git can use.
      const { stdout } = await execFile(
        'git',
        ['-c', 'credential.helper=', '-c', `credential.helper=${CREDENTIAL_HELPER}`, ...args],
        { cwd: opts.cwd ?? repoPath, env, maxBuffer: 50 * 1024 * 1024 },
      );
      return stdout;
    } catch (error) {
      const detail = scrubSecrets(error.stderr || error.message, gitToken).trim();
      throw new Error(`git ${args[0]} failed: ${detail}`);
    }
  }

  async function branch() {
    return (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  }

  async function exists() {
    try {
      await access(path.join(repoPath, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  async function clone() {
    await mkdir(cacheDir, { recursive: true });
    await git(['clone', '--quiet', url, repoPath], { cwd: cacheDir });
    lastSyncAt.set(repoPath, Date.now());
    return { action: 'cloned' };
  }

  async function changedFiles() {
    const out = await git(['status', '--porcelain', '--untracked-files=all']);
    return out.split('\n').filter(Boolean).map(l => l.slice(3).trim());
  }

  async function hasUnpushedCommits() {
    const b = await branch();
    const out = await git(['rev-list', '--count', `origin/${b}..HEAD`]);
    return Number(out.trim()) > 0;
  }

  /** Clone if missing; otherwise pull at most once per TTL. Never pulls over local edits. */
  async function sync({ force = false } = {}) {
    if (!(await exists())) return clone();
    const fresh = Date.now() - (lastSyncAt.get(repoPath) ?? 0) < ttlMs;
    if (!force && fresh) return { action: 'skipped' };
    if ((await changedFiles()).length > 0) return { action: 'skipped-dirty' };
    const b = await branch();
    await git(['pull', '--quiet', '--rebase', 'origin', b]);
    lastSyncAt.set(repoPath, Date.now());
    return { action: 'pulled' };
  }

  async function lastCommit() {
    const out = await git(['log', '-1', '--format=%h%x1f%cI%x1f%an%x1f%s']);
    const [hash, date, author, message] = out.trim().split('\x1f');
    return { hash, date, author, message };
  }

  async function diff() {
    await git(['add', '--intent-to-add', '--all']);
    return git(['diff']);
  }

  async function conflictedFiles() {
    const out = await git(['diff', '--name-only', '--diff-filter=U']);
    return out.split('\n').filter(Boolean);
  }

  async function commitAndPush(message) {
    const b = await branch();
    if ((await changedFiles()).length > 0) {
      await git(['add', '--all']);
      await git([...COMMIT_IDENTITY, 'commit', '--quiet', '-m', message]);
    }
    if (!(await hasUnpushedCommits())) return { pushed: false, reason: 'nothing to push' };
    try {
      await git(['pull', '--quiet', '--rebase', 'origin', b]);
    } catch (error) {
      const files = await conflictedFiles();
      await git(['rebase', '--abort']).catch(() => {});
      if (files.length > 0) throw new ConflictError(files);
      throw error;
    }
    await git(['push', '--quiet', 'origin', b]);
    lastSyncAt.set(repoPath, Date.now());
    return { pushed: true, commit: await lastCommit() };
  }

  /** Drop all local edits and unpushed commits; match the remote exactly. */
  async function discard() {
    const b = await branch();
    await git(['rebase', '--abort']).catch(() => {});
    await git(['fetch', '--quiet', 'origin']);
    await git(['reset', '--hard', `origin/${b}`]);
    await git(['clean', '-fd', '--exclude=.build']);
    lastSyncAt.set(repoPath, Date.now());
  }

  return {
    repoPath,
    sync,
    lastCommit,
    changedFiles,
    hasUnpushedCommits,
    diff,
    commitAndPush,
    discard,
    lastSyncedAt: () => lastSyncAt.get(repoPath) ?? null,
  };
}
