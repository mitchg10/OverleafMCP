import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { walkFiles } from '../../src/paths.js';

const SRC = path.resolve(new URL('../../src', import.meta.url).pathname);
/** Either form of reaching the network directly. */
const DIRECT_FETCH = /\bglobalThis\.fetch\b|(?<![.\w])fetch\s*\(/;

describe('network boundary', () => {
  test('only src/verify/http.js reaches the network', async () => {
    const offenders = [];
    for (const { path: rel } of await walkFiles(SRC, { extensions: ['.js'] })) {
      if (rel === path.join('verify', 'http.js')) continue;
      if (DIRECT_FETCH.test(await readFile(path.join(SRC, rel), 'utf8'))) offenders.push(rel);
    }
    // Rate limiting, retries, caching and secret scrubbing all live in that one
    // module. A source adapter calling fetch directly would bypass every one of
    // them, so this is a structural rule rather than a convention.
    assert.deepEqual(offenders, [], `these files call fetch directly: ${offenders.join(', ')}`);
  });

  test('nothing under src/bib or src/verify can write to a project', async () => {
    const offenders = [];
    for (const dir of ['bib', 'verify']) {
      const root = path.join(SRC, dir);
      for (const { path: rel } of await walkFiles(root, { extensions: ['.js'] })) {
        if (/writeText|writeFile/.test(await readFile(path.join(root, rel), 'utf8'))) offenders.push(path.join(dir, rel));
      }
    }
    // Citation checking reports and suggests; applying a fix is always a
    // separate, visible edit_file call by the agent.
    // The response cache is the one exception, and it writes only under
    // cacheDir, which is a sibling of the clones and not inside any project.
    assert.deepEqual(offenders.filter(f => f !== path.join('verify', 'cache.js')), []);
  });
});
