import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseBib } from '../../src/bib/parse.js';
import { createHttpClient } from '../../src/verify/http.js';
import { createThrottle } from '../../src/verify/throttle.js';
import { resolveEntry, identifierOf } from '../../src/verify/resolve.js';
import { createFakeFetch, fakeClock, fixture } from '../helpers/fake-fetch.js';

const alphago = await fixture('crossref-alphago.json');
const retracted = await fixture('crossref-retracted.json');
const crossref404 = await fixture('crossref-404.json');
const swebench = await fixture('datacite-swebench.json');
const datacite404 = await fixture('datacite-404.json');
const handleFound = await fixture('doi-handle-found.json');
const handleAbsent = await fixture('doi-handle-absent.json');

const ALPHAGO = `@article{Silver_2016,
  title = {Mastering the game of Go with deep neural networks and tree search},
  author = {Silver, David and Huang, Aja},
  journal = {Nature},
  year = {2016},
  doi = {10.1038/nature16961}
}`;

const SWEBENCH = `@misc{Jimenez_2023,
  title = {{SWE}-bench: Can Language Models Resolve Real-World {GitHub} Issues?},
  author = {Jimenez, Carlos E. and Yang, John},
  year = {2023},
  eprint = {2310.06770},
  archiveprefix = {arXiv},
  doi = {10.48550/ARXIV.2310.06770}
}`;

function entryOf(body) {
  return parseBib(body, { file: 'refs.bib' }).entries[0];
}

describe('resolveEntry', () => {
  let clock;
  beforeEach(() => { clock = fakeClock(); });

  function build(routes) {
    const fetchImpl = createFakeFetch(routes);
    const http = createHttpClient({
      fetchImpl,
      sleep: clock.sleep,
      now: clock.now,
      maxAttempts: 2,
      throttle: createThrottle({ minIntervalMs: { 'api.crossref.org': 0, 'api.datacite.org': 0, 'doi.org': 0 }, ...clock }),
    });
    return { http, fetchImpl };
  }

  test('a DOI that resolves and agrees is verified', async () => {
    const { http, fetchImpl } = build({ 'api.crossref.org/works/10.1038': { body: alphago } });
    const r = await resolveEntry(entryOf(ALPHAGO), { http });

    assert.equal(r.tier, 'verified');
    assert.equal(r.match.score, 1);
    assert.equal(r.record.venue, 'Nature');
    assert.equal(r.requests.length, 1);
    assert.equal(r.requests[0].status, 200);
    fetchImpl.assertNoUnexpected();
  });

  test('an arXiv DOI goes to DataCite and Crossref is never asked', async () => {
    // Crossref holds no 10.48550 DOI at all, so asking would spend a request
    // to learn nothing and would look like a 404 on a real paper.
    const { http, fetchImpl } = build({ 'api.datacite.org/dois/10.48550': { body: swebench } });
    const r = await resolveEntry(entryOf(SWEBENCH), { http });

    assert.equal(r.tier, 'verified');
    assert.equal(r.record.source, 'datacite');
    assert.equal(r.record.isPreprint, true);
    assert.equal(fetchImpl.countFor('crossref'), 0);
    fetchImpl.assertNoUnexpected();
  });

  test('a Crossref 404 falls back to DataCite', async () => {
    const { http, fetchImpl } = build({
      'api.crossref.org': { status: 404, body: crossref404 },
      'api.datacite.org': { body: swebench },
    });
    const r = await resolveEntry(entryOf('@misc{X, title = {SWE-bench: Can Language Models Resolve Real-World GitHub Issues?}, author = {Jimenez, Carlos E.}, year = {2023}, doi = {10.5555/registered-elsewhere}}'), { http });

    assert.equal(r.tier, 'verified');
    assert.equal(fetchImpl.countFor('datacite'), 1);
  });

  test('a DOI no registry holds and the Handle System denies is invalid-identifier', async () => {
    const { http } = build({
      'api.crossref.org': { status: 404, body: crossref404 },
      'api.datacite.org': { status: 404, body: datacite404 },
      'doi.org/api/handles': { status: 404, body: handleAbsent },
    });
    const r = await resolveEntry(entryOf('@article{Fake_2023, title = {A study}, author = {Nobody, A}, year = {2023}, doi = {10.1145/9999999999}}'), { http });

    assert.equal(r.tier, 'invalid-identifier');
    assert.match(r.notes[0], /not registered with Crossref, DataCite, or with the DOI registry itself/);
    assert.equal(r.requests.length, 3);
  });

  test('a DOI that resolves but has no indexed metadata is not called invalid', async () => {
    // The real case this guards: 10.1609/aimag.v17i1.1208 is a genuine AI
    // Magazine DOI that resolves to AAAI, but Crossref's works API 404s on it
    // because AAAI registered the prefix without depositing article metadata.
    // Calling that "unregistered" would be a false accusation against a real
    // citation, which is the worst answer this tool could give.
    const { http } = build({
      'api.crossref.org': { status: 404, body: crossref404 },
      'api.datacite.org': { status: 404, body: datacite404 },
      'doi.org/api/handles': { body: handleFound },
    });
    const entry = entryOf('@article{Schaeffer_1996, title = {Chinook}, author = {Schaeffer, Jonathan}, year = {1996}, doi = {10.1609/aimag.v17i1.1208}}');
    const r = await resolveEntry(entry, { http });

    assert.equal(r.tier, 'unverified');
    assert.match(r.resolvesTo, /aaai\.org/);
    assert.match(r.notes[0], /registered and resolves to/);
  });

  test('an unreachable DOI registry is an error, never an accusation', async () => {
    const { http } = build({
      'api.crossref.org': { status: 404, body: crossref404 },
      'api.datacite.org': { status: 404, body: datacite404 },
      'doi.org/api/handles': { status: 503 },
    });
    const r = await resolveEntry(entryOf('@article{X, title = {t}, author = {A, B}, year = {2000}, doi = {10.9999/unreachable.1}}'), { http });
    assert.equal(r.tier, 'error');
    assert.match(r.notes[0], /could not reach the DOI registry/);
  });

  test('a retraction outranks the match, and errata are not counted as retractions', async () => {
    const { http } = build({ 'api.crossref.org': { body: retracted } });
    const entry = entryOf(`@article{Mehra_2020,
      title = {Hydroxychloroquine or chloroquine with or without a macrolide for treatment of COVID-19: a multinational registry analysis},
      author = {Mehra, Mandeep R and Desai, Sapan S},
      journal = {The Lancet}, year = {2020}, doi = {10.1016/S0140-6736(20)31180-6}}`);
    const r = await resolveEntry(entry, { http });

    assert.equal(r.tier, 'retracted');
    // The real record carries 7 updates: 2 retractions, plus errata, a
    // correction and an expression of concern that are not retractions.
    assert.equal(r.record.retractions.length, 2);
    assert.ok(r.record.retractions.every(x => x.type === 'retraction'));
  });

  test('a resolving DOI whose record disagrees is a mismatch, not a failure', async () => {
    const { http } = build({ 'api.crossref.org': { body: alphago } });
    const entry = entryOf(`@article{Silver_2016,
      title = {Mastering the game of Go with deep neural networks and tree search},
      author = {Silver, David}, journal = {Nature}, year = {2017},
      doi = {10.1038/nature16961}}`);
    const r = await resolveEntry(entry, { http });

    assert.equal(r.tier, 'verified-with-mismatch');
    assert.deepEqual(r.match.mismatches.map(m => [m.field, m.bib, m.source]), [['year', '2017', '2016']]);
  });

  test('a transient failure is an error tier, never invalid-identifier', async () => {
    const { http } = build({ 'api.crossref.org': { status: 503 } });
    const r = await resolveEntry(entryOf(ALPHAGO), { http });

    assert.equal(r.tier, 'error');
    assert.match(r.notes[0], /crossref: HTTP 503/);
  });

  test('an entry under review is never sent anywhere', async () => {
    const { http, fetchImpl } = build({});
    const entry = entryOf('@article{Mine_2026, title = {A paper of mine}, author = {Gerhardt, Mitchell}, pubstate = {submitted}}');
    const r = await resolveEntry(entry, { http });

    assert.equal(r.tier, 'unverifiable-by-design');
    assert.equal(r.notes[0], 'pubstate=submitted');
    assert.equal(fetchImpl.calls.length, 0, 'unpublished work must never leave the machine');
  });

  test('the design gate applies to a selfAuthor entry with no year', async () => {
    const { http, fetchImpl } = build({});
    const entry = entryOf('@inproceedings{Mine, title = {Another paper}, author = {Gerhardt, Mitchell}}');
    const r = await resolveEntry(entry, { http, selfAuthors: ['Gerhardt'] });

    assert.equal(r.tier, 'unverifiable-by-design');
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('an entry with no identifier is unverified, with the reason stated', async () => {
    const { http, fetchImpl } = build({});
    const r = await resolveEntry(entryOf('@book{Knuth_1984, title = {The TeXbook}, author = {Knuth, Donald E.}, year = {1984}}'), { http });

    assert.equal(r.tier, 'unverified');
    assert.match(r.notes[0], /no DOI or arXiv id/);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('a DOI is derived from an eprint field when none is stated', async () => {
    const { http, fetchImpl } = build({ 'api.datacite.org/dois/10.48550': { body: swebench } });
    const entry = entryOf(`@misc{Jimenez_2023,
      title = {SWE-bench: Can Language Models Resolve Real-World GitHub Issues?},
      author = {Jimenez, Carlos E.}, year = {2023}, eprint = {2310.06770}, archiveprefix = {arXiv}}`);
    const r = await resolveEntry(entry, { http });

    assert.equal(r.tier, 'verified');
    assert.match(r.notes.join(' '), /derived from the entry's arXiv id \(eprint\)/);
    assert.equal(fetchImpl.countFor('crossref'), 0);
  });

  test('provenance is attached to every verdict so a claim can be audited', async () => {
    const { http } = build({ 'api.crossref.org': { body: alphago } });
    const r = await resolveEntry(entryOf(ALPHAGO), { http });
    assert.deepEqual(r.requests[0], {
      source: 'crossref',
      url: 'https://api.crossref.org/works/10.1038/nature16961',
      status: 200,
      fromCache: false,
      error: null,
    });
  });

  test('an opted-in mailto reaches the request but never the report', async () => {
    const { http, fetchImpl } = build({ 'api.crossref.org': { body: alphago } });
    const r = await resolveEntry(entryOf(ALPHAGO), { http, mailto: 'someone@example.edu' });
    assert.ok(fetchImpl.urls()[0].includes('mailto=someone%40example.edu'));
    assert.ok(!JSON.stringify(r).includes('someone@example.edu'));
  });
});

describe('identifierOf', () => {
  test('a stated DOI beats a derived one', () => {
    const id = identifierOf(entryOf(SWEBENCH));
    assert.equal(id.derived, false);
    // Lowercased, which reconciles the ARXIV/arXiv casing drift in the corpus.
    assert.equal(id.value, '10.48550/arxiv.2310.06770');
    assert.equal(id.arxiv, true);
  });

  test('an ordinary DOI is not flagged as arXiv', () => {
    assert.equal(identifierOf(entryOf(ALPHAGO)).arxiv, false);
  });

  test('an arXiv URL alone is enough to derive one', () => {
    const id = identifierOf(entryOf('@misc{X, title = {t}, url = {https://arxiv.org/abs/2503.04761v2}}'));
    assert.equal(id.value, '10.48550/arxiv.2503.04761');
    assert.equal(id.derived, true);
  });

  test('an entry with neither returns null rather than a guess', () => {
    assert.equal(identifierOf(entryOf('@book{X, title = {t}, year = {1984}}')), null);
  });
});
