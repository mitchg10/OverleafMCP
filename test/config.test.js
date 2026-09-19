import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, getProjectConfig, secretsOf } from '../src/config.js';
import { readFile } from 'node:fs/promises';

const raw = {
  projects: {
    A: { name: 'Paper A', projectId: '6a205a9d3a0fc9b041b2a909', gitToken: 'olp_abc' },
    B: { name: 'Paper B', projectId: '6a205a9d3a0fc9b041b2a910', gitToken: 'olp_def', mainFile: 'paper.tex', engine: 'xelatex' },
  },
};

test('parses valid config and applies defaults', () => {
  const cfg = parseConfig(raw);
  assert.equal(cfg.projects.A.engine, undefined);
  assert.equal(cfg.projects.B.engine, 'xelatex');
  assert.ok(cfg.cacheDir.length > 0);
});

test('rejects bad project ids and engines', () => {
  assert.throws(() => parseConfig({ projects: { X: { name: 'x', projectId: 'nope', gitToken: 't' } } }), /projectId/);
  assert.throws(() => parseConfig({ projects: { X: { ...raw.projects.A, engine: 'tex' } } }), /engine/);
});

test('getProjectConfig lists valid keys on miss', () => {
  const cfg = parseConfig(raw);
  assert.equal(getProjectConfig(cfg, 'B').name, 'Paper B');
  assert.throws(() => getProjectConfig(cfg, 'Z'), /"Z".*A, B/s);
  assert.throws(() => getProjectConfig(cfg, undefined), /projectName is required.*A, B/s);
});

test('accepts optional headings list per project', () => {
  const cfg = parseConfig({ projects: { C: { ...raw.projects.A, headings: ['rSection'] } } });
  assert.deepEqual(cfg.projects.C.headings, ['rSection']);
});

test('verify defaults are filled in without any verify block', () => {
  const { verify } = parseConfig(raw, {});
  assert.equal(verify.enabled, true);
  assert.equal(verify.timeoutMs, 15_000);
  assert.equal(verify.thresholds.accept, 0.85);
  assert.equal(verify.cacheTtlDays.record, 30);
  assert.equal(verify.semanticScholarApiKey, undefined);
  assert.equal(verify.mailto, undefined, 'never inferred; it is the user\'s own email');
});

test('Semantic Scholar is throttled to its published 1 request per second', () => {
  const { verify } = parseConfig(raw, {});
  assert.ok(verify.minIntervalMs['api.semanticscholar.org'] >= 1000);
});

test('a sub-second Semantic Scholar interval is rejected', () => {
  assert.throws(
    () => parseConfig({ ...raw, verify: { minIntervalMs: { 'api.semanticscholar.org': 200 } } }, {}),
    /api\.semanticscholar\.org/,
  );
});

test('secrets fall back to the environment when absent from the file', () => {
  const { verify } = parseConfig(raw, { OVERLEAF_MCP_S2_API_KEY: 'env-key', OVERLEAF_MCP_MAILTO: 'a@b.edu' });
  assert.equal(verify.semanticScholarApiKey, 'env-key');
  assert.equal(verify.mailto, 'a@b.edu');
});

test('the config file wins over the environment', () => {
  const withKey = { ...raw, verify: { semanticScholarApiKey: 'file-key' } };
  assert.equal(parseConfig(withKey, { OVERLEAF_MCP_S2_API_KEY: 'env-key' }).verify.semanticScholarApiKey, 'file-key');
});

test('secretsOf collects every credential for scrubbing', () => {
  const cfg = parseConfig({ ...raw, verify: { semanticScholarApiKey: 's2k-abcdefgh' } }, {});
  const secrets = secretsOf(cfg);
  assert.ok(secrets.includes('s2k-abcdefgh'));
  assert.ok(secrets.some(s => s.startsWith('olp_')));
});

test('selfAuthors and citeCommands are accepted per project', () => {
  const cfg = parseConfig({
    projects: { C: { ...raw.projects.A, selfAuthors: ['Gerhardt'], citeCommands: ['mycite'] } },
  }, {});
  assert.deepEqual(cfg.projects.C.selfAuthors, ['Gerhardt']);
  assert.deepEqual(cfg.projects.C.citeCommands, ['mycite']);
});

test('the shipped example config validates once the placeholders are filled in', async () => {
  const raw = JSON.parse(await readFile(new URL('../projects.example.json', import.meta.url), 'utf8'));
  // The projectId placeholder is deliberately not hex; everything else in the
  // file must be valid as written, including the optional verify block. An
  // empty-string mailto or API key would fail here, which is the point.
  raw.projects.MyPaper.projectId = 'a'.repeat(24);
  const config = parseConfig(raw, {});
  assert.equal(config.verify.enabled, true);
  assert.equal(config.verify.mailto, undefined, 'the example must not ship an email address');
  assert.equal(config.verify.minIntervalMs['api.semanticscholar.org'], 1100);
});
