import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Disk cache for verification lookups.
 *
 * Lives at `<cacheDir>/verify-cache/<source>/<xx>/<sha256>.json`, a sibling of
 * the project clones rather than inside one, so no cached response can ever
 * show up in `git status`.
 *
 * Every failure here is swallowed: a cache is an optimization, and losing one
 * must never turn into a failed verification.
 */

const DAY_MS = 86_400_000;
const DEFAULT_TTL_DAYS = Object.freeze({ record: 30, search: 7, negative: 3 });

export function verifyCacheDir(cacheDir) {
  return path.join(cacheDir, 'verify-cache');
}

/**
 * @param {{ dir: string, ttlDays?: Record<string, number>, now?: () => number }} options
 */
export function createVerifyCache({ dir, ttlDays = {}, now = () => Date.now() } = {}) {
  const ttl = { ...DEFAULT_TTL_DAYS, ...ttlDays };
  const stats = { hits: 0, misses: 0, stale: 0, writes: 0 };

  function fileFor(source, key) {
    const digest = createHash('sha256').update(`${source}\u0000${key}`).digest('hex');
    return path.join(dir, segment(source), digest.slice(0, 2), `${digest}.json`);
  }

  function ttlMsFor(kind) {
    return (ttl[kind] ?? ttl.record) * DAY_MS;
  }

  async function get(source, key, kind) {
    let record;
    try {
      record = JSON.parse(await readFile(fileFor(source, key), 'utf8'));
    } catch {
      stats.misses += 1;
      return null;
    }
    // The kind is read back from the record, so a shortened TTL in config
    // takes effect on entries already written under the old one.
    if (now() - record.storedAt > ttlMsFor(record.kind ?? kind)) {
      stats.stale += 1;
      return null;
    }
    stats.hits += 1;
    return record;
  }

  async function set(source, key, kind, value) {
    const file = fileFor(source, key);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ source, kind, key, storedAt: now(), value }), 'utf8');
      stats.writes += 1;
      return true;
    } catch {
      return false;
    }
  }

  return { get, set, fileFor, dir, stats: () => ({ ...stats }) };
}

/** Source names become a directory component, so keep them to a safe alphabet. */
function segment(source) {
  return String(source).replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
}
