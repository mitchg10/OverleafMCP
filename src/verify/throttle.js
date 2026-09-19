/**
 * Per-host request spacing.
 *
 * One chain per host, so Semantic Scholar's 1-request-per-second budget never
 * slows a Crossref lookup down. Spacing is measured start-to-start, which is
 * what a "requests per second" limit actually constrains.
 *
 * `sleep` and `now` are injected so tests run instantly and deterministically.
 */

const DEFAULT_INTERVAL_MS = 1000;

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {{ minIntervalMs?: Record<string, number>, sleep?: (ms: number) => Promise<void>, now?: () => number }} options
 */
export function createThrottle({ minIntervalMs = {}, sleep = defaultSleep, now = () => Date.now() } = {}) {
  const lastStart = new Map();
  const tails = new Map();
  let waited = 0;

  function intervalFor(host) {
    return minIntervalMs[host] ?? DEFAULT_INTERVAL_MS;
  }

  /** Run `fn` on `host`'s queue, no sooner than one interval after the previous start. */
  function run(host, fn) {
    const previous = tails.get(host) ?? Promise.resolve();
    const result = previous.then(async () => {
      const due = (lastStart.get(host) ?? Number.NEGATIVE_INFINITY) + intervalFor(host);
      const wait = due - now();
      if (wait > 0) {
        waited += wait;
        await sleep(wait);
      }
      lastStart.set(host, now());
      return fn();
    });
    // The chain is continued from a swallowed copy: one rejected request must
    // not deadlock every later request to the same host.
    tails.set(host, result.then(() => {}, () => {}));
    return result;
  }

  /**
   * Push the next allowed start for a host further out, after the server has
   * told us to back off. Keeps a Retry-After honoured across sibling requests
   * rather than only inside the one that received it.
   */
  function defer(host, ms) {
    const until = now() + ms - intervalFor(host);
    if (until > (lastStart.get(host) ?? Number.NEGATIVE_INFINITY)) lastStart.set(host, until);
  }

  return { run, defer, intervalFor, stats: () => ({ waitedMs: Math.round(waited) }) };
}
