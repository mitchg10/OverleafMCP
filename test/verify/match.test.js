import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseBib } from '../../src/bib/parse.js';
import { scoreMatch, titleScore, containerOf, bestMatch, venueContainment } from '../../src/verify/match.js';

function entryOf(body) {
  return parseBib(body).entries[0];
}

const ATTENTION = entryOf(`@inproceedings{Vaswani_2017,
  title = {Attention is All you Need},
  author = {Vaswani, Ashish and Shazeer, Noam},
  booktitle = {Advances in Neural Information Processing Systems},
  year = {2017}
}`);

const record = over => ({
  source: 'crossref', title: 'Attention is all you need',
  authors: [{ family: 'Vaswani', given: 'Ashish' }], year: 2017,
  venue: 'Advances in Neural Information Processing Systems', ...over,
});

describe('titleScore', () => {
  test('LaTeX and case differences do not lower the score', () => {
    assert.equal(titleScore('{BERT}: Pre-training of Deep Bidirectional Transformers', 'BERT: pre-training of deep bidirectional transformers'), 1);
  });

  test('a plausible but fabricated title scores near zero', () => {
    // Measured against the real corpus: real matches scored 1.00 and a
    // fabricated title scored 0.12, which is what makes the gate usable.
    assert.ok(titleScore('Attention is all you need', 'Neural architectures for scalable federated distillation') < 0.2);
  });

  test('a missing title on either side is zero, never a free match', () => {
    assert.equal(titleScore(null, 'Attention is all you need'), 0);
    assert.equal(titleScore('Attention is all you need', ''), 0);
  });
});

describe('scoreMatch', () => {
  test('title plus author plus year is accepted', () => {
    const m = scoreMatch(ATTENTION, record());
    assert.equal(m.verdict, 'accept');
    assert.equal(m.score, 1);
    assert.deepEqual(m.mismatches, []);
  });

  test('a perfect title with nothing else agreeing is only a candidate', () => {
    // The real collision: OpenAlex resolves this title to a 2025 preprint by
    // other authors. Title alone must not be enough to call that verified.
    const m = scoreMatch(ATTENTION, record({ year: 2025, authors: [{ family: 'Nobody', given: 'A' }], venue: null }));
    assert.equal(m.score, 1);
    assert.equal(m.verdict, 'consider');
    assert.equal(m.corroboration.surname, false);
    assert.equal(m.corroboration.year, false);
  });

  test('an author in common carries an accept even when the year is off', () => {
    const m = scoreMatch(ATTENTION, record({ year: 2023 }));
    assert.equal(m.verdict, 'accept');
    assert.deepEqual(m.mismatches.map(x => x.field), ['year']);
  });

  test('a year within one is treated as agreement', () => {
    // Preprint-then-proceedings routinely shifts a year by one.
    const m = scoreMatch(ATTENTION, record({ authors: [{ family: 'Nobody' }], year: 2018 }));
    assert.equal(m.corroboration.year, true);
    assert.equal(m.verdict, 'accept');
  });

  test('an unrelated record is rejected', () => {
    assert.equal(scoreMatch(ATTENTION, record({ title: 'A survey of soil nematode populations' })).verdict, 'reject');
  });

  test('a venue written differently is not reported as a mismatch', () => {
    const m = scoreMatch(ATTENTION, record({ venue: 'Advances in Neural Information Processing Systems 30' }));
    assert.ok(!m.mismatches.some(x => x.field === 'venue'));
  });

  test('a genuinely different venue is reported', () => {
    const m = scoreMatch(ATTENTION, record({ venue: 'Journal of Irreproducible Results' }));
    assert.deepEqual(m.mismatches.filter(x => x.field === 'venue').map(x => x.source), ['Journal of Irreproducible Results']);
  });

  test('an entry with no author still matches on year', () => {
    const anon = entryOf('@misc{A_2017, title = {Attention is All you Need}, year = {2017}}');
    assert.equal(scoreMatch(anon, record()).verdict, 'accept');
  });
});

describe('venueContainment', () => {
  test('a full proceedings title contains the short series name', () => {
    // The real case: reporting this as a mismatch would fire on most
    // proceedings entries in a bibliography.
    assert.equal(venueContainment('Proceedings of the 16th {{Conference}} on {{Creativity}} \\& {{Cognition}}', 'Creativity and Cognition'), 1);
  });

  test('an unrelated venue scores zero', () => {
    assert.equal(venueContainment('Advances in Neural Information Processing Systems', 'Journal of Irreproducible Results'), 0);
  });

  test('an acronym is not compared rather than compared wrongly', () => {
    assert.equal(venueContainment('Proc. NeurIPS', 'Advances in Neural Information Processing Systems'), 1);
    assert.equal(venueContainment('Nature', 'Nature Communications'), 1);
  });
});

describe('containerOf', () => {
  test('finds the venue wherever the entry chose to put it', () => {
    assert.equal(containerOf(ATTENTION), 'Advances in Neural Information Processing Systems');
    assert.equal(containerOf(entryOf('@article{X, journal = {Nature}}')), 'Nature');
    assert.equal(containerOf(entryOf('@article{X, journaltitle = {Science}}')), 'Science');
    assert.equal(containerOf(entryOf('@misc{X, title = {t}}')), null);
  });
});

describe('bestMatch', () => {
  test('picks the highest-scoring record and drops the rejects', () => {
    const best = bestMatch(ATTENTION, [
      record({ title: 'Something else entirely about soil' }),
      record({ title: 'Attention is all you need' }),
      null,
    ]);
    assert.equal(best.score, 1);
  });

  test('returns null when nothing clears the consider floor', () => {
    assert.equal(bestMatch(ATTENTION, [record({ title: 'Soil nematode populations in Devon' })]), null);
  });
});
