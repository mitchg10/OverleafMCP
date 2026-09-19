import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFakeOverleaf } from './helpers/fake-overleaf.js';
import { createFakeFetch, fakeClock, fixture } from './helpers/fake-fetch.js';
import { createServer } from '../src/server.js';
import { parseConfig } from '../src/config.js';

const alphago = await fixture('crossref-alphago.json');
const crossref404 = await fixture('crossref-404.json');
const datacite404 = await fixture('datacite-404.json');
const swebench = await fixture('datacite-swebench.json');
const handleAbsent = await fixture('doi-handle-absent.json');

const BIB = `
@article{Silver_2016,
  title = {Mastering the game of Go with deep neural networks and tree search},
  author = {Silver, David and Huang, Aja},
  journal = {Nature}, year = {2016}, doi = {10.1038/nature16961}
}
@misc{Jimenez_2023,
  title = {{SWE}-bench: Can Language Models Resolve Real-World {GitHub} Issues?},
  author = {Jimenez, Carlos E. and Yang, John},
  year = {2023}, doi = {10.48550/ARXIV.2310.06770}
}
@article{Fake_2023,
  title = {Large language models for automated curriculum alignment},
  author = {Nobody, Alex}, journal = {Journal of Studies}, year = {2023},
  doi = {10.1145/9999999999}
}
@inproceedings{Gerhardt_2026,
  title = {A paper that is still under review somewhere},
  author = {Gerhardt, Mitchell}, pubstate = {submitted}
}
@book{Knuth_1984, title = {The {TeX}book}, author = {Knuth, Donald E.}, year = {1984}}
`;

const MAIN = [
  '\\documentclass{article}',
  '\\usepackage{natbib}',
  '\\bibliographystyle{apalike}',
  '\\begin{document}',
  '\\citep{Silver_2016,Jimenez_2023} \\citep{Fake_2023} \\citet{Gerhardt_2026} \\citep{Knuth_1984}',
  '\\bibliography{refs}',
  '\\end{document}',
].join('\n');

const ROUTES = {
  'api.crossref.org/works/10.1038': { body: alphago },
  'api.crossref.org/works/10.1145': { status: 404, body: crossref404 },
  'api.datacite.org/dois/10.1145': { status: 404, body: datacite404 },
  'api.datacite.org/dois/10.48550': { body: swebench },
  'doi.org/api/handles/10.1145': { status: 404, body: handleAbsent },
};

describe('verify_references through MCP', () => {
  let fake;
  let client;
  let fetchImpl;
  const P = 'paper';

  async function verify(args = {}) {
    const r = await client.callTool({ name: 'verify_references', arguments: { projectName: P, ...args } });
    return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
  }

  before(async () => {
    fake = await createFakeOverleaf({ files: { 'main.tex': MAIN, 'refs.bib': BIB } });
    fetchImpl = createFakeFetch(ROUTES);
    const clock = fakeClock();
    const config = parseConfig({
      cacheDir: fake.cacheDir,
      verify: { minIntervalMs: { 'api.crossref.org': 0, 'api.datacite.org': 0, 'doi.org': 0 } },
      projects: {
        [P]: {
          name: 'Fixture Paper',
          projectId: '6a205a9d3a0fc9b041b2a90b',
          gitToken: 'olp_secret_token_value',
          mainFile: 'main.tex',
          selfAuthors: ['Gerhardt'],
        },
      },
    });
    const server = createServer(config, { remoteUrlFor: () => fake.remoteUrl, fetchImpl, sleep: clock.sleep, now: clock.now });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(ct);
  });

  after(async () => {
    await client.close();
    await fake.cleanup();
  });

  test('verifies a real DOI and reports the request economics', async () => {
    const { text } = await verify();
    assert.match(text, /VERIFIED \(2\)/);
    assert.match(text, /Silver_2016/);
    assert.match(text, /Requests: \d+ \(\d+ cache hits, 0 rate-limit retries\)/);
  });

  test('reports an unregistered DOI without calling it fabricated', async () => {
    const { text } = await verify();
    assert.match(text, /INVALID IDENTIFIER \(1\)/);
    assert.match(text, /Fake_2023\s+refs\.bib:\d+\s+doi 10\.1145\/9999999999 does not resolve/);
    assert.match(text, /still not proof of fabrication/);
    assert.match(text, /or with the DOI registry itself/);
    assert.ok(!/fabricated\b(?!.*not)/i.test(text.split('INVALID IDENTIFIER')[1].split('\n').slice(0, 4).join('\n')));
  });

  test('an entry with no identifier is unverified, with the caveat stated', async () => {
    const { text } = await verify();
    assert.match(text, /UNVERIFIED \(1\)/);
    assert.match(text, /Knuth_1984/);
    assert.match(text, /NOT evidence of fabrication/);
  });

  test('work under review is skipped and never sent to any API', async () => {
    await verify();
    const sent = fetchImpl.urls().join(' ');
    assert.ok(!sent.includes('under+review'));
    assert.ok(!sent.toLowerCase().includes('gerhardt'));
    assert.match((await verify()).text, /1 skipped by design/);
  });

  test('includeUnverifiable lists it without sending it', async () => {
    const before = fetchImpl.calls.length;
    const { text } = await verify({ includeUnverifiable: true });
    assert.match(text, /UNVERIFIABLE BY DESIGN \(1\)/);
    assert.match(text, /Gerhardt_2026/);
    assert.equal(fetchImpl.calls.length, before, 'a listed entry must still not be queried');
  });

  test('a second run is served from the disk cache', async () => {
    await verify();
    const before = fetchImpl.calls.length;
    const { text } = await verify();
    assert.equal(fetchImpl.calls.length, before, 'a cached run should make no requests');
    assert.match(text, /Requests: 0 \([1-9]\d* cache hits/);
  });

  test('forceRefresh re-queries every source', async () => {
    const before = fetchImpl.calls.length;
    await verify({ forceRefresh: true });
    assert.ok(fetchImpl.calls.length > before);
  });

  test('limit caps the run and says what was left', async () => {
    const { text } = await verify({ limit: 1 });
    assert.match(text, /Checked 1 of 5 entries; 1 skipped by design/);
    assert.match(text, /Stopped at limit 1; 3 entr\(ies\) not checked/);
  });

  test('keys narrows the run to what was asked for', async () => {
    const { text } = await verify({ keys: ['Silver_2016'] });
    assert.match(text, /Checked 1 of 1 entries/);
    assert.ok(!text.includes('Fake_2023'));
  });

  test('a key that is not in the bibliography is named, not silently dropped', async () => {
    const { text } = await verify({ keys: ['Silver_2016', 'Nonexistent_9999'] });
    assert.match(text, /Not in the bibliography: Nonexistent_9999/);
  });

  test('every verdict carries its provenance', async () => {
    const { text } = await verify({ keys: ['Fake_2023'], forceRefresh: true });
    assert.match(text, /crossref 404.*datacite 404.*doi-handle 404/);
  });

  test('the report always says no file was changed', async () => {
    assert.match((await verify()).text, /No file was changed/);
  });

  test('the tool never writes to the project', async () => {
    await verify();
    const r = await client.callTool({ name: 'pending_changes', arguments: { projectName: P } });
    assert.match(r.content[0].text, /No local changes/);
  });

  test('only planned hosts were contacted', () => {
    fetchImpl.assertNoUnexpected();
    const hosts = new Set(fetchImpl.urls().map(u => new URL(u).host));
    assert.deepEqual([...hosts].sort(), ['api.crossref.org', 'api.datacite.org', 'doi.org']);
  });
});

describe('verify_references when disabled', () => {
  let fake;
  let client;
  let fetchImpl;

  before(async () => {
    fake = await createFakeOverleaf({ files: { 'main.tex': MAIN, 'refs.bib': BIB } });
    fetchImpl = createFakeFetch(ROUTES);
    const config = parseConfig({
      cacheDir: fake.cacheDir,
      verify: { enabled: false },
      projects: {
        off: { name: 'Off', projectId: '6a205a9d3a0fc9b041b2a90c', gitToken: 'olp_x', mainFile: 'main.tex' },
      },
    });
    const server = createServer(config, { remoteUrlFor: () => fake.remoteUrl, fetchImpl });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(ct);
  });

  after(async () => {
    await client.close();
    await fake.cleanup();
  });

  test('refuses with an actionable message and makes zero requests', async () => {
    const r = await client.callTool({ name: 'verify_references', arguments: { projectName: 'off' } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /verify\.enabled/);
    assert.equal(fetchImpl.calls.length, 0);
  });
});
