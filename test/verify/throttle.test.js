import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createThrottle } from '../../src/verify/throttle.js';
import { fakeClock } from '../helpers/fake-fetch.js';

describe('throttle', () => {
  test('spaces consecutive requests to one host by its interval', async () => {
    const clock = fakeClock();
    const t = createThrottle({ minIntervalMs: { 'api.semanticscholar.org': 1100 }, ...clock });
    const starts = [];
    const run = () => t.run('api.semanticscholar.org', async () => starts.push(clock.now()));

    await Promise.all([run(), run(), run()]);

    assert.equal(starts.length, 3);
    assert.equal(starts[1] - starts[0], 1100);
    assert.equal(starts[2] - starts[1], 1100);
  });

  test('the first request to a host is not delayed', async () => {
    const clock = fakeClock();
    const t = createThrottle({ minIntervalMs: { 'api.crossref.org': 5000 }, ...clock });
    await t.run('api.crossref.org', async () => {});
    assert.equal(clock.elapsed(), 0);
  });

  test('hosts have independent budgets', async () => {
    const clock = fakeClock();
    const t = createThrottle({ minIntervalMs: { a: 1000, b: 1000 }, ...clock });
    const starts = {};
    await Promise.all([
      t.run('a', async () => { starts.a = clock.now(); }),
      t.run('b', async () => { starts.b = clock.now(); }),
    ]);
    // Semantic Scholar's one-per-second budget must not slow Crossref down.
    assert.equal(starts.a, starts.b);
  });

  test('a failed request does not deadlock later ones on the same host', async () => {
    const clock = fakeClock();
    const t = createThrottle({ minIntervalMs: { a: 10 }, ...clock });
    await assert.rejects(t.run('a', async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await t.run('a', async () => 'still works'), 'still works');
  });

  test('defer holds the whole host back, not just the calling request', async () => {
    const clock = fakeClock();
    const t = createThrottle({ minIntervalMs: { a: 100 }, ...clock });
    await t.run('a', async () => {});
    t.defer('a', 5000);
    await t.run('a', async () => {});
    // A Retry-After of 5s means 5s from the deferral, not 5s minus the
    // interval that would have been waited anyway.
    assert.equal(clock.elapsed(), 5000);
  });
});
