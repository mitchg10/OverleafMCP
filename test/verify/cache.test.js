import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVerifyCache, verifyCacheDir } from '../../src/verify/cache.js';
import { fakeClock } from '../helpers/fake-fetch.js';

const DAY = 86_400_000;

describe('verify cache', () => {
  let dir;
  before(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'verify-cache-')); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  test('round-trips a value', async () => {
    const cache = createVerifyCache({ dir });
    await cache.set('crossref', 'https://api.crossref.org/works/10.1/x', 'record', { ok: true, status: 200 });
    const hit = await cache.get('crossref', 'https://api.crossref.org/works/10.1/x', 'record');
    assert.deepEqual(hit.value, { ok: true, status: 200 });
  });

  test('a miss is null, not a throw', async () => {
    assert.equal(await createVerifyCache({ dir }).get('crossref', 'never-stored', 'record'), null);
  });

  test('entries expire on the TTL for their own kind', async () => {
    const clock = fakeClock();
    const cache = createVerifyCache({ dir, now: clock.now });
    await cache.set('crossref', 'k-negative', 'negative', { status: 404 });
    await cache.set('crossref', 'k-record', 'record', { status: 200 });

    clock.advance(4 * DAY);
    // A 404 may just mean the DOI is newly minted, so it is retried sooner than
    // a successful record is refreshed.
    assert.equal(await cache.get('crossref', 'k-negative', 'negative'), null);
    assert.ok(await cache.get('crossref', 'k-record', 'record'));

    clock.advance(31 * DAY);
    assert.equal(await cache.get('crossref', 'k-record', 'record'), null);
  });

  test('the stored kind wins, so a shortened TTL applies to old entries', async () => {
    const clock = fakeClock();
    await createVerifyCache({ dir, now: clock.now }).set('crossref', 'k-kind', 'negative', {});
    clock.advance(5 * DAY);
    // Asked for as a 'record' (30 days) but written as 'negative' (3 days).
    assert.equal(await createVerifyCache({ dir, now: clock.now }).get('crossref', 'k-kind', 'record'), null);
  });

  test('keys are sharded by digest and never contain the URL', async () => {
    const cache = createVerifyCache({ dir });
    const file = cache.fileFor('crossref', 'https://api.crossref.org/works/10.1/x?mailto=a@b.c');
    assert.match(file, /crossref\/[0-9a-f]{2}\/[0-9a-f]{64}\.json$/);
    assert.ok(!file.includes('@'));
  });

  test('the same key under two sources does not collide', async () => {
    const cache = createVerifyCache({ dir });
    assert.notEqual(cache.fileFor('crossref', 'same'), cache.fileFor('datacite', 'same'));
  });

  test('an unwritable directory degrades instead of failing verification', async () => {
    const cache = createVerifyCache({ dir: '/dev/null/nope' });
    assert.equal(await cache.set('crossref', 'k', 'record', {}), false);
    assert.equal(await cache.get('crossref', 'k', 'record'), null);
  });

  test('lives beside the clones, never inside one', async () => {
    assert.equal(verifyCacheDir('/cache'), path.join('/cache', 'verify-cache'));
    const entries = await readdir(dir);
    assert.ok(!entries.includes('.git'));
  });
});
