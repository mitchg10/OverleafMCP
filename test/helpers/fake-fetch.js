import { readFile } from 'node:fs/promises';

/**
 * A `fetch` stand-in backed by a URL-to-response table.
 *
 * Any URL not in the table throws, and is also recorded. The throw alone is not
 * enough: the HTTP client treats a thrown fetch as a network error and retries
 * it, exactly as it should in production, so an unplanned request would
 * otherwise show up only as a vague failure. `assertNoUnexpected` is how a test
 * states that the request it did not plan for must not have happened at all.
 */

export function createFakeFetch(routes) {
  const calls = [];
  const unexpected = [];

  async function fakeFetch(url, options = {}) {
    const href = String(url);
    calls.push({ url: href, headers: options.headers ?? {} });

    const entry = Object.entries(routes).find(([pattern]) => href.includes(pattern));
    if (!entry) {
      unexpected.push(href);
      throw new Error(`Unexpected request to ${href}. Routes: ${Object.keys(routes).join(', ')}`);
    }

    const planned = entry[1];
    const reply = typeof planned === 'function'
      ? planned(href, calls.filter(c => c.url === href).length)
      : planned;
    if (reply instanceof Error) throw reply;
    return toResponse(reply);
  }

  fakeFetch.calls = calls;
  fakeFetch.urls = () => calls.map(c => c.url);
  fakeFetch.countFor = pattern => calls.filter(c => c.url.includes(pattern)).length;
  fakeFetch.unexpected = unexpected;
  fakeFetch.assertNoUnexpected = () => {
    if (unexpected.length) throw new Error(`Unplanned request(s): ${[...new Set(unexpected)].join(', ')}`);
  };
  return fakeFetch;
}

function toResponse({ status = 200, body = '', headers = {} } = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => lower.get(String(name).toLowerCase()) ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

export function fixture(name) {
  return readFile(new URL(`../fixtures/http/${name}`, import.meta.url), 'utf8');
}

/** A clock whose only way to advance is a `sleep`, so tests never really wait. */
export function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    sleep: async ms => { t += ms; },
    advance: ms => { t += ms; },
    elapsed: () => t - start,
  };
}
