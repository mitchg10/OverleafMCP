import { scrubSecrets } from '../git-client.js';
import { createThrottle } from './throttle.js';

/**
 * The only module in this repo permitted to touch `fetch`.
 *
 * Everything that talks to a bibliographic API goes through here, so rate
 * limiting, retries, timeouts, caching and secret scrubbing are decided in one
 * place rather than re-implemented per source. A test asserts this exclusivity.
 *
 * `get` never throws on an HTTP status. A 404 is an answer about a record, not
 * an error in this program, and callers need to tell those apart.
 */

const DEFAULT_USER_AGENT = 'overleaf-mcp/2.0 (+https://github.com/mitchg10/OverleafMCP)';
/** Transient by nature: the record may well be there, we just cannot see it now. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createHttpClient({
  fetchImpl = globalThis.fetch,
  throttle = createThrottle(),
  cache = null,
  timeoutMs = 15_000,
  sleep = defaultSleep,
  now = () => Date.now(),
  maxAttempts = 3,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  const stats = { requests: 0, cacheHits: 0, retries: 0, failures: 0 };

  /**
   * @param {string} url
   * @param {{ source: string, kind?: string, headers?: Record<string,string>,
   *           parse?: (text: string) => unknown, forceRefresh?: boolean }} options
   * @returns {Promise<{ ok: boolean, status: number, data: unknown, fromCache: boolean,
   *                     url: string, source: string, error: string|null }>}
   */
  async function get(url, { source, kind = 'record', headers = {}, parse = JSON.parse, forceRefresh = false } = {}) {
    // The cache key is the scrubbed URL, so an API key never reaches the disk
    // and rotating one does not silently invalidate every cached record.
    const safeUrl = scrubSecrets(url);
    if (cache && !forceRefresh) {
      const hit = await cache.get(source, safeUrl, kind);
      if (hit) {
        stats.cacheHits += 1;
        return { ...hit.value, source, url: safeUrl, fromCache: true };
      }
    }

    const result = await throttle.run(hostOf(url), () => attempt(url, { source, headers, parse, safeUrl }));

    // Only deterministic answers are stored. A 429 or a timeout says something
    // about this moment, never about the record.
    if (cache && result.cacheable) {
      const { cacheable, fromCache, source: _s, url: _u, ...value } = result;
      await cache.set(source, safeUrl, result.status === 404 ? 'negative' : kind, value);
    }
    const { cacheable, ...rest } = result;
    return rest;
  }

  async function attempt(url, { source, headers, parse, safeUrl }) {
    for (let n = 1; ; n += 1) {
      stats.requests += 1;
      const response = await send(url, headers);

      if (response.networkError) {
        if (n >= maxAttempts) {
          stats.failures += 1;
          return fail(source, safeUrl, 0, response.networkError, false);
        }
        stats.retries += 1;
        await sleep(backoffFor(n, null));
        continue;
      }

      if (RETRYABLE_STATUSES.has(response.status)) {
        const delay = backoffFor(n, parseRetryAfter(response.retryAfter, now()));
        // Hold the whole host back, not just this call: a sibling request
        // starting during the backoff would spend the same exhausted budget.
        throttle.defer(hostOf(url), delay);
        if (n >= maxAttempts) {
          stats.failures += 1;
          return fail(source, safeUrl, response.status, `HTTP ${response.status} after ${n} attempts`, false);
        }
        stats.retries += 1;
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        // 404 and friends are cacheable: they are the server's answer.
        return fail(source, safeUrl, response.status, `HTTP ${response.status}`, true);
      }

      try {
        return {
          ok: true, status: response.status, data: parse(response.body),
          error: null, fromCache: false, cacheable: true, source, url: safeUrl,
        };
      } catch (error) {
        // A body we cannot parse is a defect in our reader or in their output;
        // retrying would only produce it again.
        stats.failures += 1;
        return fail(source, safeUrl, response.status, `unreadable response: ${error.message}`, false);
      }
    }
  }

  async function send(url, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': userAgent, ...headers },
        signal: controller.signal,
        redirect: 'follow',
      });
      return {
        ok: response.ok,
        status: response.status,
        retryAfter: response.headers?.get?.('retry-after') ?? null,
        body: await response.text(),
      };
    } catch (error) {
      const aborted = error.name === 'AbortError' || error.name === 'TimeoutError';
      return { networkError: aborted ? `timed out after ${timeoutMs}ms` : scrubSecrets(error.message) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { get, stats: () => ({ ...stats, ...(cache ? { cache: cache.stats() } : {}) }) };
}

function fail(source, url, status, error, cacheable) {
  return { ok: false, status, data: null, error, fromCache: false, cacheable, source, url };
}

function backoffFor(attempt, retryAfterMs) {
  const exponential = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  return Math.min(Math.max(retryAfterMs ?? 0, exponential), MAX_BACKOFF_MS);
}

/** Retry-After is either seconds or an HTTP-date (RFC 9110). Returns ms, or null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}
