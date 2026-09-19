import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFakeOverleaf } from './helpers/fake-overleaf.js';
import { createServer } from '../src/server.js';
import { parseConfig } from '../src/config.js';

const messy = await readFile(new URL('./fixtures/bib/messy.bib', import.meta.url), 'utf8');

const MAIN = [
  '\\documentclass{article}',
  '\\usepackage{natbib}',
  '\\bibliographystyle{apalike}',
  '\\begin{document}',
  '\\citep{Braced_2026} and \\citet{BareYear_2025}.',
  '% \\cite{CommentedOut}',
  '\\citep{Ghost_2099}',
  '\\bibliography{messy}',
  '\\end{document}',
].join('\n');

describe('check_citations through MCP', () => {
  let fake;
  let client;
  const P = 'paper';

  async function check(args = {}) {
    const r = await client.callTool({ name: 'check_citations', arguments: { projectName: P, ...args } });
    return { ...r, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n') };
  }

  before(async () => {
    fake = await createFakeOverleaf({ files: { 'main.tex': MAIN, 'messy.bib': messy } });
    const config = parseConfig({
      cacheDir: fake.cacheDir,
      projects: {
        [P]: {
          name: 'Fixture Paper',
          projectId: '6a205a9d3a0fc9b041b2a909',
          gitToken: 'olp_secret_token_value',
          mainFile: 'main.tex',
        },
      },
    });
    const server = createServer(config, { remoteUrlFor: () => fake.remoteUrl });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(ct);
  });

  after(async () => {
    await client.close();
    await fake.cleanup();
  });

  test('reports the detected style with its evidence', async () => {
    const { text } = await check();
    assert.match(text, /Style: bibtex \+ natbib, style "apalike" \(set in main\.tex:3\)/);
    assert.match(text, /Confidence: high/);
  });

  test('counts entries, commands and distinct keys', async () => {
    const { text } = await check();
    assert.match(text, /15 entries in messy\.bib/);
    assert.match(text, /3 cite commands across 1 \.tex file/);
  });

  test('finds the undefined citation, anchored to file and line', async () => {
    const { text } = await check();
    assert.match(text, /ERRORS \(/);
    assert.match(text, /undefined-citation\s+main\.tex:7\s+\\citep\{Ghost_2099\} has no entry/);
  });

  test('does not report the commented-out citation', async () => {
    assert.ok(!(await check()).text.includes('CommentedOut'));
  });

  test('states that artifact checks were skipped rather than passing them', async () => {
    const { text } = await check();
    assert.match(text, /Not checked:.*resolver-warning/);
    assert.match(text, /run compile/);
  });

  test('excludes the under-review entry and says so', async () => {
    const { text } = await check();
    assert.match(text, /Unverifiable by design \(1[^)]*\): Submitted_2026 \(pubstate=submitted\)/);
    assert.match(text, /never sent to any API/);
  });

  test('hides uncited entries by default but reports how many were hidden', async () => {
    const quiet = await check();
    assert.ok(!quiet.text.includes('uncited-entry'));
    assert.match(quiet.text, /pass includeUncited: true/);

    const loud = await check({ includeUncited: true });
    assert.match(loud.text, /uncited-entry/);
  });

  test('severity filtering narrows the report', async () => {
    const { text } = await check({ severity: 'error' });
    assert.match(text, /ERRORS \(/);
    assert.ok(!text.includes('WARNINGS ('));
  });

  test('rules filtering runs only the requested rule', async () => {
    const { text } = await check({ rules: ['conflicting-urls'] });
    assert.match(text, /conflicting-urls/);
    assert.ok(!text.includes('undefined-citation'));
  });

  test('maxFindings caps output and says what was suppressed', async () => {
    const { text } = await check({ maxFindings: 1 });
    assert.match(text, /more finding\(s\) suppressed/);
  });

  test('bibFile narrows which bibliography is read', async () => {
    const { text } = await check({ bibFile: 'messy.bib' });
    assert.match(text, /15 entries in messy\.bib/);
  });

  test('an unknown project is a helpful error, not a crash', async () => {
    const r = await client.callTool({ name: 'check_citations', arguments: { projectName: 'nope' } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /not found.*paper/s);
  });

  test('the tool never writes to the project', async () => {
    await check();
    const r = await client.callTool({ name: 'pending_changes', arguments: { projectName: P } });
    assert.match(r.content[0].text, /No local changes/);
  });

  test('errors never leak the git token', async () => {
    const r = await client.callTool({ name: 'check_citations', arguments: { projectName: P, mainFile: 'missing.tex' } });
    const body = r.content.map(c => c.text).join('');
    assert.ok(!body.includes('olp_secret_token_value'));
  });
});
