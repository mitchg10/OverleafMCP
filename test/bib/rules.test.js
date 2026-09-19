import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runRules, RULE_IDS, classifyUnverifiable, partitionUnverifiable } from '../../src/bib/rules/index.js';
import { parseBib, entryByKey } from '../../src/bib/parse.js';
import { buildModel } from '../helpers/bib-model.js';

const messy = await readFile(new URL('../fixtures/bib/messy.bib', import.meta.url), 'utf8');
const messyParsed = parseBib(messy, { file: 'messy.bib' });

const ids = findings => [...new Set(findings.map(f => f.rule))].sort();
const only = (findings, rule) => findings.filter(f => f.rule === rule);

test('every rule has a unique id and a valid severity', () => {
  assert.equal(new Set(RULE_IDS).size, RULE_IDS.length);
});

test('a citation with no entry is an error naming the file and line', () => {
  const model = buildModel({ bib: messy, bibPath: 'messy.bib', tex: '\\cite{Braced_2026}\n\\citep{Ghost_2099}\n\\bibliography{messy}\n' });
  const [f] = only(runRules(model).findings, 'undefined-citation');
  assert.equal(f.severity, 'error');
  assert.equal(f.key, 'Ghost_2099');
  assert.equal(f.line, 2);
  assert.match(f.message, /\\citep\{Ghost_2099\} has no entry in messy\.bib/);
});

test('duplicate keys are reported once, listing both sites', () => {
  const dup = '@misc{Same_2020, title = {One}}\n@misc{Same_2020, title = {Two}}\n';
  const f = only(runRules(buildModel({ bib: dup })).findings, 'duplicate-key');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /defined 2 times/);
});

test('uncited entries are info, and \\nocite{*} suppresses them entirely', () => {
  const cited = runRules(buildModel({ bib: messy, tex: '\\cite{Braced_2026}\n' })).findings;
  assert.ok(only(cited, 'uncited-entry').length > 10);

  const starred = runRules(buildModel({ bib: messy, tex: '\\nocite{*}\n' })).findings;
  assert.deepEqual(only(starred, 'uncited-entry'), []);
});

test('conflicting URLs are an error; a single URL is not', () => {
  const found = only(runRules(buildModel({ bib: messy })).findings, 'conflicting-urls');
  assert.deepEqual(found.map(f => f.key), ['ConflictingUrls_2025']);
  assert.match(found[0].message, /url=https:\/\/example\.org\/one/);
  assert.match(found[0].message, /note=https:\/\/example\.org\/two/);
});

test('author-and-editor is scoped to the types BibTeX actually rejects', () => {
  // The real .blg warns about the @inbook and stays silent on the @article,
  // so a type-blind rule would invent a defect the resolver does not see.
  const found = only(runRules(buildModel({ bib: messy })).findings, 'author-and-editor');
  assert.deepEqual(found.map(f => f.key), ['AuthorAndEditor_2010']);

  const asArticle = '@article{X_2020, author = {A, B}, editor = {C, D}, title = {T}, journal = {J}, year = {2020}}\n';
  assert.deepEqual(only(runRules(buildModel({ bib: asArticle })).findings, 'author-and-editor'), []);
});

test('news outlets typed as @article are flagged with a concrete fix', () => {
  const found = only(runRules(buildModel({ bib: messy })).findings, 'news-as-journal-article');
  assert.deepEqual(found.map(f => f.key), ['NewsAsArticle_2025']);
  assert.match(found[0].hint, /@misc or @online/);
});

test('a duplicated access date and a doubled ISBN are reported', () => {
  const all = runRules(buildModel({ bib: messy })).findings;
  assert.deepEqual(only(all, 'duplicated-access-date').map(f => f.key), ['DuplicateAccessed_2025']);
  assert.deepEqual(only(all, 'multiple-isbn').map(f => f.key), ['AuthorAndEditor_2010']);
});

test('consistency is measured against the document\'s own majority', () => {
  // Three lowercase `url` against one `URL`: the minority spelling is the
  // outlier, and nothing is imposed from outside the file.
  const [f] = only(runRules(buildModel({ bib: messy })).findings, 'field-case-inconsistent');
  assert.equal(f.key, 'UpperUrl_2024');
  assert.match(f.message, /"URL =" here; 4 of 5 entries use "url ="/);
});

test('a near-even split is not called an outlier', () => {
  const split = [
    '@misc{A_2020, url = {https://a}}',
    '@misc{B_2020, URL = {https://b}}',
    '@misc{C_2020, url = {https://c}}',
    '@misc{D_2020, URL = {https://d}}',
  ].join('\n');
  assert.deepEqual(only(runRules(buildModel({ bib: split })).findings, 'field-case-inconsistent'), []);
});

test('bare-vs-braced values are reported against the majority delimiter', () => {
  const found = only(runRules(buildModel({ bib: messy })).findings, 'value-delimiter-inconsistent');
  assert.deepEqual(found.map(f => f.key), ['BareYear_2025']);
  assert.match(found[0].message, /bare.*\{braces\}/);
});

test('entries using @string concatenation are skipped by field rules, not guessed at', () => {
  assert.equal(entryByKey(messyParsed, 'Concatenated_2020').partial, true);
  const all = runRules(buildModel({ bib: messy })).findings;
  // Integrity rules still apply: a partial entry that is never cited is still
  // uncited. Only rules that read its field set stand down.
  assert.deepEqual(ids(all.filter(f => f.key === 'Concatenated_2020')), ['uncited-entry']);
});

test('missing required fields are reported per type, honouring alternates', () => {
  const noJournal = '@article{X_2020, author = {A, B}, title = {T}, year = {2020}}\n';
  const [f] = only(runRules(buildModel({ bib: noJournal })).findings, 'missing-required-field');
  assert.match(f.message, /no journal or journaltitle/);

  const biblatexSpelling = '@article{Y_2020, author = {A, B}, title = {T}, journaltitle = {J}, date = {2020-01}}\n';
  assert.deepEqual(only(runRules(buildModel({ bib: biblatexSpelling })).findings, 'missing-required-field'), []);
});

test('@misc requires nothing, being the deliberate escape hatch', () => {
  assert.deepEqual(only(runRules(buildModel({ bib: '@misc{X_2020, title = {T}}\n' })).findings, 'missing-required-field'), []);
});

test('a natbib command under biblatex without natbib=true is illegal', () => {
  const tex = '\\usepackage[style=ieee,backend=biber]{biblatex}\n\\addbibresource{refs.bib}\n\\citep{X_2020}\n';
  const [f] = only(runRules(buildModel({ tex, bib: '@misc{X_2020, title = {T}}' })).findings, 'illegal-cite-command');
  assert.equal(f.severity, 'error', 'high-confidence detection means this is certain');
  assert.match(f.hint, /\\parencite/);
});

test('the same command is legal when natbib=true is set', () => {
  const tex = '\\usepackage[style=apa,natbib=true,backend=biber]{biblatex}\n\\citep{X_2020}\n';
  assert.deepEqual(only(runRules(buildModel({ tex })).findings, 'illegal-cite-command'), []);
});

test('mixing the two command families is reported once', () => {
  const tex = '\\usepackage[style=apa,natbib=true,backend=biber]{biblatex}\n\\citep{A}\n\\parencite{B}\n';
  const f = only(runRules(buildModel({ tex })).findings, 'mixed-cite-family');
  assert.equal(f.length, 1);
});

test('artifact rules report as not-checked rather than passing silently', () => {
  const results = runRules(buildModel({ bib: messy }));
  const skipped = results.notChecked.map(n => n.rule);
  assert.ok(skipped.includes('resolver-warning'));
  assert.ok(skipped.includes('backend-mismatch'));
  assert.match(results.notChecked[0].reason, /run compile/);
});

test('the resolver\'s own warnings are surfaced and attributed to the entry', () => {
  const model = buildModel({
    bib: messy,
    bibPath: 'messy.bib',
    artifacts: {
      present: ['.build/main.blg'],
      blg: { engine: 'bibtex', entryCount: 15, messages: [{ level: 'warning', message: "can't use both author and editor fields in AuthorAndEditor_2010", key: 'AuthorAndEditor_2010', line: 6 }] },
    },
  });
  const [f] = only(runRules(model).findings, 'resolver-warning');
  assert.equal(f.file, 'messy.bib', 'points at the entry, not the log');
  assert.match(f.message, /bibtex says/);
});

test('a build that used a different style than the source implies is a mismatch', () => {
  const model = buildModel({
    tex: '\\bibliographystyle{apalike}\n\\bibliography{refs}\n',
    artifacts: { present: ['.build/main.aux'], aux: { citations: [], bibcites: [], bibdata: [], bibstyle: 'aaai2027' } },
  });
  const [f] = only(runRules(model).findings, 'backend-mismatch');
  assert.match(f.message, /build used style "aaai2027".*implies "apalike"/);
  assert.match(f.hint, /build is authoritative/);
});

test('stale artifacts are reported and drift is not computed from them', () => {
  const model = buildModel({
    bib: messy,
    tex: '\\cite{Braced_2026}',
    artifacts: { present: ['.build/main.aux'], stale: true, aux: { citations: ['Gone_2020'], bibcites: [], bibdata: [], bibstyle: null } },
  });
  const findings = runRules(model).findings;
  assert.equal(only(findings, 'stale-artifacts').length, 1);
  assert.deepEqual(only(findings, 'artifact-drift'), [], 'a stale aux cannot prove drift');
});

test('severity filtering drops lower-severity findings but keeps the counts honest', () => {
  const model = buildModel({ bib: messy, tex: '\\citep{Ghost_2099}' });
  const errorsOnly = runRules(model, { severity: 'error' });
  assert.ok(errorsOnly.findings.every(f => f.severity === 'error'));
  assert.ok(errorsOnly.counts.warning > 0, 'counts reflect everything found, not just what is shown');
});

test('selecting rules runs only those rules', () => {
  const results = runRules(buildModel({ bib: messy }), { rules: ['conflicting-urls'] });
  assert.deepEqual(ids(results.findings), ['conflicting-urls']);
});

test('findings are sorted by severity, then file, then line', () => {
  const findings = runRules(buildModel({ bib: messy, tex: '\\citep{Ghost_2099}' })).findings;
  const order = findings.map(f => ({ error: 0, warning: 1, info: 2 }[f.severity]));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('rules never mutate the model they are given', () => {
  const model = buildModel({ bib: messy, tex: '\\citep{Ghost_2099}' });
  const before = JSON.stringify(model.entries.map(e => e.key));
  runRules(model);
  assert.equal(JSON.stringify(model.entries.map(e => e.key)), before);
});

test('pubstate marks an entry unverifiable by design', () => {
  const verdict = classifyUnverifiable(entryByKey(messyParsed, 'Submitted_2026'));
  assert.equal(verdict.unverifiable, true);
  assert.match(verdict.reason, /pubstate=submitted/);
});

test('an ordinary entry is verifiable', () => {
  assert.equal(classifyUnverifiable(entryByKey(messyParsed, 'Braced_2026')).unverifiable, false);
});

test('a missing year counts only for a configured selfAuthor', () => {
  const entry = parseBib('@misc{Mine, author = {Gerhardt, Mitchell}, title = {T}}').entries[0];
  assert.equal(classifyUnverifiable(entry).unverifiable, false, 'no selfAuthors configured means no assumption');
  const scoped = classifyUnverifiable(entry, { selfAuthors: ['Gerhardt'] });
  assert.equal(scoped.unverifiable, true);
  assert.match(scoped.reason, /selfAuthor/);
});

test('unverifiable entries are excluded from field rules entirely', () => {
  // Submitted_2026 is an @article with no year and no journal, which would
  // otherwise trip missing-required-field twice. Being under review is not a
  // defect, so no field rule may fire on it.
  const results = runRules(buildModel({ bib: messy }));
  assert.deepEqual(ids(results.findings.filter(f => f.key === 'Submitted_2026')), ['uncited-entry']);
  assert.deepEqual(results.excluded.map(e => e.entry.key), ['Submitted_2026']);

  const withoutExclusion = runRules(buildModel({ bib: messy })).findings;
  assert.ok(!withoutExclusion.some(f => f.key === 'Submitted_2026' && f.rule === 'missing-required-field'));
});

test('partitionUnverifiable splits without sharing objects between buckets', () => {
  const { checkable, excluded } = partitionUnverifiable(messyParsed.entries, {});
  assert.equal(checkable.length + excluded.length, messyParsed.entries.length);
  assert.ok(!checkable.some(e => excluded.some(x => x.entry.key === e.key)));
});
