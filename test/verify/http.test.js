import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHttpClient, parseRetryAfter, hostOf } from '../../src/verify/http.js';
import { createThrottle } from '../../src/verify/throttle.js';
import { createVerifyCache } from '../../src/verify/cache.js';
import { createFakeFetch, fakeClock } from '../helpers/fake-fetch.js';

const URL_A = 'https://api.crossref.org/works/10.1/a';

describe('http client', () => {
  let dir;
  let clock;
  before(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'verify-http-')); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });
  beforeEach(() => { clock = fakeClock(); });

  function build(routes, { cache = null, maxAttempts = 3 } = {}) {
    const fetchImpl = createFakeFetch(routes);
    const http = createHttpClient({
      fetchImpl,
      cache,
      maxAttempts,
      sleep: clock.sleep,
      now: clock.now,
      throttle: createThrottle({ minIntervalMs: { 'api.crossref.org': 0 }, ...clock }),
    });
    return { http, fetchImpl };
  }

  test('parses a successful JSON response', async () => {
    const { http } = build({ '10.1/a': { body: { message: { DOI: '10.1/a' } } } });
    const r = await http.get(URL_A, { source: 'crossref' });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.data.message.DOI, '10.1/a');
    assert.equal(r.fromCache, false);
  });

  test('a 404 is an answer, not an exception', async () => {
    const { http } = build({ '10.1/a': { status: 404, body: 'Resource not found.' } });
    const r = await http.get(URL_A, { source: 'crossref' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
    assert.equal(r.error, 'HTTP 404');
  });

  test('a non-JSON error body does not become a parse crash', async () => {
    // Crossref really does return the bare string "Resource not found." here.
    const { http } = build({ '10.1/a': { status: 404, body: 'Resource not found.' } });
    assert.equal((await http.get(URL_A, { source: 'crossref' })).data, null);
  });

  test('retries a 429 and honours Retry-After', async () => {
    const { http, fetchImpl } = build({
      '10.1/a': (_url, n) => (n === 1
        ? { status: 429, headers: { 'retry-after': '7' } }
        : { body: { message: { ok: true } } }),
    });
    const r = await http.get(URL_A, { source: 'crossref' });
    assert.equal(r.ok, true);
    assert.equal(fetchImpl.countFor('10.1/a'), 2);
    assert.equal(clock.elapsed(), 7000);
    assert.equal(http.stats().retries, 1);
  });

  test('gives up after maxAttempts and reports it as an error, not a 404', async () => {
    const { http, fetchImpl } = build({ '10.1/a': { status: 503 } }, { maxAttempts: 3 });
    const r = await http.get(URL_A, { source: 'crossref' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    assert.match(r.error, /after 3 attempts/);
    assert.equal(fetchImpl.countFor('10.1/a'), 3);
  });

  test('a timeout is reported without pretending to know about the record', async () => {
    const fetchImpl = createFakeFetch({ '10.1/a': Object.assign(new Error('aborted'), { name: 'AbortError' }) });
    const http = createHttpClient({ fetchImpl, sleep: clock.sleep, now: clock.now, timeoutMs: 15_000, maxAttempts: 1 });
    const r = await http.get(URL_A, { source: 'crossref' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 0);
    assert.match(r.error, /timed out after 15000ms/);
  });

  test('a thrown fetch becomes a failed result, and the test can still see it', async () => {
    const { http, fetchImpl } = build({ '10.1/a': { body: {} } }, { maxAttempts: 1 });
    const r = await http.get('https://api.crossref.org/works/10.9/z', { source: 'crossref' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 0);
    assert.throws(() => fetchImpl.assertNoUnexpected(), /Unplanned request/);
  });

  describe('caching', () => {
    test('a second identical request is served from disk', async () => {
      const cache = createVerifyCache({ dir, now: clock.now });
      const { http, fetchImpl } = build({ '10.1/cached': { body: { message: { DOI: 'x' } } } }, { cache });
      const url = 'https://api.crossref.org/works/10.1/cached';

      const first = await http.get(url, { source: 'crossref' });
      const second = await http.get(url, { source: 'crossref' });

      assert.equal(first.fromCache, false);
      assert.equal(second.fromCache, true);
      assert.deepEqual(second.data, first.data);
      assert.equal(fetchImpl.countFor('10.1/cached'), 1);
      assert.equal(http.stats().cacheHits, 1);
    });

    test('404s are cached, so a bad DOI is not re-asked every run', async () => {
      const cache = createVerifyCache({ dir, now: clock.now });
      const { http, fetchImpl } = build({ '10.1/gone': { status: 404, body: 'no' } }, { cache });
      const url = 'https://api.crossref.org/works/10.1/gone';
      await http.get(url, { source: 'crossref' });
      const again = await http.get(url, { source: 'crossref' });
      assert.equal(again.status, 404);
      assert.equal(again.fromCache, true);
      assert.equal(fetchImpl.countFor('10.1/gone'), 1);
    });

    test('rate limits and server errors are never cached', async () => {
      const cache = createVerifyCache({ dir, now: clock.now });
      const { http, fetchImpl } = build({ '10.1/busy': { status: 503 } }, { cache, maxAttempts: 1 });
      const url = 'https://api.crossref.org/works/10.1/busy';
      await http.get(url, { source: 'crossref' });
      const again = await http.get(url, { source: 'crossref' });
      // A 503 describes this moment, not the record; caching it would poison
      // the answer for days.
      assert.equal(again.fromCache, false);
      assert.equal(fetchImpl.countFor('10.1/busy'), 2);
    });

    test('forceRefresh bypasses a fresh cache entry', async () => {
      const cache = createVerifyCache({ dir, now: clock.now });
      const { http, fetchImpl } = build({ '10.1/fresh': { body: { n: 1 } } }, { cache });
      const url = 'https://api.crossref.org/works/10.1/fresh';
      await http.get(url, { source: 'crossref' });
      await http.get(url, { source: 'crossref', forceRefresh: true });
      assert.equal(fetchImpl.countFor('10.1/fresh'), 2);
    });

    test('an API key never reaches the disk or the returned url', async () => {
      const cache = createVerifyCache({ dir, now: clock.now });
      const fetchImpl = createFakeFetch({ 'paper/search': { body: { data: [] } } });
      const http = createHttpClient({ fetchImpl, cache, sleep: clock.sleep, now: clock.now });
      const secret = 's2k-NotARealKeyValue';

      const r = await http.get(`https://api.semanticscholar.org/graph/v1/paper/search?x-api-key=${secret}&query=x`, {
        source: 'semantic-scholar',
      });

      assert.ok(!r.url.includes(secret), r.url);
      assert.ok(!cache.fileFor('semantic-scholar', r.url).includes(secret));
      // The real request still carries it; only what we store and print does not.
      assert.ok(fetchImpl.urls()[0].includes(secret));
    });
  });
});

describe('parseRetryAfter', () => {
  test('reads a seconds value', () => {
    assert.equal(parseRetryAfter('7'), 7000);
  });

  test('reads an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now), 30_000);
  });

  test('a past date is clamped to zero rather than going negative', () => {
    const now = Date.parse('2026-01-01T00:01:00Z');
    assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now), 0);
  });

  test('garbage and absence are both null', () => {
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter(''), null);
    assert.equal(parseRetryAfter('soon'), null);
  });
});

describe('hostOf', () => {
  test('extracts the host for per-host throttling', () => {
    assert.equal(hostOf('https://api.crossref.org/works/10.1/a'), 'api.crossref.org');
  });

  test('a malformed url does not throw', () => {
    assert.equal(hostOf('not a url'), 'unknown');
  });
});
