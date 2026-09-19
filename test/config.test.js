import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, getProjectConfig, secretsOf, loadConfig } from '../src/config.js';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

const noToken = { projects: { A: { name: 'Paper A', projectId: '6a205a9d3a0fc9b041b2a909' } } };

test('a project git token falls back to the environment', () => {
  const cfg = parseConfig(noToken, { OVERLEAF_GIT_TOKEN: 'olp_from_env' });
  assert.equal(cfg.projects.A.gitToken, 'olp_from_env');
});

test('a git token in the config file wins over the environment', () => {
  const cfg = parseConfig(raw, { OVERLEAF_GIT_TOKEN: 'olp_from_env' });
  assert.equal(cfg.projects.A.gitToken, 'olp_abc');
  assert.equal(cfg.projects.B.gitToken, 'olp_def');
});

test('a project with no token anywhere fails at load, naming the project', () => {
  assert.throws(() => parseConfig(noToken, {}), /no gitToken for A.*OVERLEAF_GIT_TOKEN/s);
});

test('an env-supplied token is still collected for scrubbing', () => {
  // secretsOf reads the filled projects, so it must run after the env fallback;
  // otherwise a token supplied by the environment would never be redacted.
  const cfg = parseConfig(noToken, { OVERLEAF_GIT_TOKEN: 'olp_from_env' });
  assert.ok(secretsOf(cfg).includes('olp_from_env'));
});

test('loadConfig reads the token from OVERLEAF_GIT_TOKEN_FILE', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'overleaf-cfg-'));
  const configPath = path.join(dir, 'projects.json');
  const tokenPath = path.join(dir, 'token');
  await writeFile(configPath, JSON.stringify(noToken));
  await writeFile(tokenPath, 'olp_from_file\n');
  const cfg = await loadConfig(configPath, { OVERLEAF_GIT_TOKEN_FILE: tokenPath });
  assert.equal(cfg.projects.A.gitToken, 'olp_from_file', 'trailing newline is trimmed');
});

test('OVERLEAF_GIT_TOKEN wins over OVERLEAF_GIT_TOKEN_FILE', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'overleaf-cfg-'));
  const configPath = path.join(dir, 'projects.json');
  await writeFile(configPath, JSON.stringify(noToken));
  const cfg = await loadConfig(configPath, {
    OVERLEAF_GIT_TOKEN: 'olp_direct',
    OVERLEAF_GIT_TOKEN_FILE: path.join(dir, 'does-not-exist'),
  });
  assert.equal(cfg.projects.A.gitToken, 'olp_direct', 'the missing file is never read');
});

test('an unreadable OVERLEAF_GIT_TOKEN_FILE reports the path', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'overleaf-cfg-'));
  const configPath = path.join(dir, 'projects.json');
  await writeFile(configPath, JSON.stringify(noToken));
  await assert.rejects(
    loadConfig(configPath, { OVERLEAF_GIT_TOKEN_FILE: path.join(dir, 'nope') }),
    /OVERLEAF_GIT_TOKEN_FILE.*nope/s,
  );
});
