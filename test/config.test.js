import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, getProjectConfig } from '../src/config.js';

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
