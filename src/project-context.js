import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getProjectConfig, secretsOf } from './config.js';
import { createGitClient, createScrubber } from './git-client.js';
import { resolveInside } from './paths.js';
import { createHttpClient } from './verify/http.js';
import { createThrottle } from './verify/throttle.js';
import { createVerifyCache, verifyCacheDir } from './verify/cache.js';

/**
 * Builds the per-project handle tools operate on: config + git client +
 * safe file helpers. `remoteUrlFor` is a test seam for pointing at a local repo.
 */
export function createProjectContext(config, { remoteUrlFor, fetchImpl, sleep, now } = {}) {
  const clients = new Map();
  // Built once from every secret the config holds, so any tool's error text
  // can be scrubbed by value rather than by guessing at a pattern.
  const scrub = createScrubber({ secrets: secretsOf(config) });
  // One HTTP client for the whole server, so per-host spacing and the disk
  // cache are shared across every tool call rather than reset on each one.
  const http = createHttpClient({
    fetchImpl,
    sleep,
    now,
    timeoutMs: config.verify.timeoutMs,
    throttle: createThrottle({ minIntervalMs: config.verify.minIntervalMs, sleep, now }),
    cache: createVerifyCache({ dir: verifyCacheDir(config.cacheDir), ttlDays: config.verify.cacheTtlDays, now }),
  });

  function clientFor(project) {
    if (!clients.has(project.key)) {
      clients.set(
        project.key,
        createGitClient({
          projectId: project.projectId,
          gitToken: project.gitToken,
          cacheDir: config.cacheDir,
          remoteUrl: remoteUrlFor?.(project),
          ttlMs: config.syncTtlSeconds * 1000,
        }),
      );
    }
    return clients.get(project.key);
  }

  /** Resolve a project and make sure its clone is fresh (subject to TTL). */
  async function open(projectName, { refresh = false } = {}) {
    const project = getProjectConfig(config, projectName);
    const client = clientFor(project);
    const syncResult = await client.sync({ force: refresh });
    return {
      project,
      client,
      syncResult,
      repoPath: client.repoPath,
      absPath: rel => resolveInside(client.repoPath, rel),
      readText: rel => readFile(resolveInside(client.repoPath, rel), 'utf8'),
      writeText: (rel, content) => writeFile(resolveInside(client.repoPath, rel), content, 'utf8'),
      relPath: abs => path.relative(client.repoPath, abs),
    };
  }

  return { config, open, scrub, http, verify: config.verify };
}
