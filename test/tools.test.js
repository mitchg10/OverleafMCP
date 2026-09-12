import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFakeOverleaf } from './helpers/fake-overleaf.js';
import { createServer } from '../src/server.js';
import { parseConfig } from '../src/config.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const hasLatexmk = await promisify(execFile)('which', ['latexmk']).then(() => true, () => false);

describe('MCP tools end to end', () => {
  let fake;
  let client;
  const P = 'paper';

  async function call(name, args = {}) {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    return { ...r, text };
  }

  before(async () => {
    fake = await createFakeOverleaf();
    const config = parseConfig({
      cacheDir: fake.cacheDir,
      projects: { [P]: { name: 'Fixture Paper', projectId: '6a205a9d3a0fc9b041b2a909', gitToken: 'olp_x', mainFile: 'main.tex' } },
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

  test('exposes the full tool surface', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name).sort();
    for (const n of ['list_projects', 'list_files', 'read_file', 'get_sections', 'get_section_content', 'search',
      'status_summary', 'sync', 'compile', 'render_page', 'pdf_text', 'edit_file', 'replace_section', 'write_file',
      'pending_changes', 'push_changes', 'discard_changes']) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
    assert.ok(tools.every(t => t.description.length > 40), 'every tool has a real description');
  });

  test('missing or wrong projectName is a helpful error, not a crash', async () => {
    const missing = await call('list_files', {});
    assert.equal(missing.isError, true);
    assert.match(missing.text, /projectName/);
    const r = await call('list_files', { projectName: 'nope' });
    assert.equal(r.isError, true);
    assert.match(r.text, /"nope" not found.*paper/s);
  });

  test('list_projects and list_files', async () => {
    assert.match((await call('list_projects')).text, /paper.*Fixture Paper/s);
    const files = (await call('list_files', { projectName: P })).text;
    assert.match(files, /main\.tex/);
    assert.match(files, /refs\.bib/);
    const texOnly = (await call('list_files', { projectName: P, extensions: ['.tex'] })).text;
    assert.doesNotMatch(texOnly, /refs\.bib/);
  });

  test('read_file returns numbered lines and honours ranges', async () => {
    const r = (await call('read_file', { projectName: P, filePath: 'main.tex', startLine: 12, endLine: 13 })).text;
    assert.match(r, /^\s*12\t\\section\{Introduction\}$/m);
    assert.doesNotMatch(r, /^\s*14\t/m);
    const bad = await call('read_file', { projectName: P, filePath: '../etc/passwd' });
    assert.equal(bad.isError, true);
  });

  test('get_sections excludes commented headings', async () => {
    const r = (await call('get_sections', { projectName: P, filePath: 'main.tex' })).text;
    assert.match(r, /L12\tsection\tIntroduction/);
    assert.doesNotMatch(r, /Commented Out/);
  });

  test('get_section_content by title and by line', async () => {
    const byTitle = (await call('get_section_content', { projectName: P, filePath: 'main.tex', sectionTitle: 'methods' })).text;
    assert.match(byTitle, /Data Collection/);
    const byLine = (await call('get_section_content', { projectName: P, filePath: 'main.tex', line: 34 })).text;
    assert.match(byLine, /Confidence in results/);
  });

  test('search across project files with context', async () => {
    const r = (await call('search', { projectName: P, pattern: '\\\\cite\\{', regex: true })).text;
    assert.match(r, /main\.tex:14:/);
    assert.match(r, /main\.tex:17:/);
    const bib = (await call('search', { projectName: P, pattern: '@article', extensions: ['.bib'] })).text;
    assert.match(bib, /refs\.bib:1:/);
  });

  test('status_summary gives outline, bib, inputs, last commit', async () => {
    const r = (await call('status_summary', { projectName: P })).text;
    assert.match(r, /Main file: main\.tex/);
    assert.match(r, /Introduction/);
    assert.match(r, /refs\.bib/);
    assert.match(r, /appendix/);
    assert.match(r, /Initial/);
  });

  test('compile → render_page → pdf_text through MCP', { skip: !hasLatexmk }, async () => {
    const c = await call('compile', { projectName: P });
    assert.equal(c.isError, undefined, c.text);
    assert.match(c.text, /^OK — main\.tex → 2 page\(s\)/);
    assert.match(c.text, /Undefined references: fig:one/);

    const r = await call('render_page', { projectName: P, pages: [1, 2], dpi: 40 });
    assert.equal(r.isError, undefined, r.text);
    const images = r.content.filter(x => x.type === 'image');
    assert.equal(images.length, 2);
    assert.equal(images[0].mimeType, 'image/png');
    assert.match(r.text, /Page 1 of 2, Page 2 of 2/);
    assert.doesNotMatch(r.text, /Recompiled/, 'PDF was fresh, no recompile');

    const t = await call('pdf_text', { projectName: P, firstPage: 2 });
    assert.match(t.text, /Appendix/);

    await call('edit_file', { projectName: P, filePath: 'appendix.tex', oldString: 'Appendix body.', newString: 'Appendix body changed.' });
    const stale = await call('pdf_text', { projectName: P, firstPage: 2 });
    assert.match(stale.text, /Recompiled first/);
    assert.match(stale.text, /body changed/);
    await call('discard_changes', { projectName: P, confirm: true });

    const bad = await call('render_page', { projectName: P, pages: [9], dpi: 40 });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /only has 2 pages/);
  });

  test('edit_file → pending_changes → push_changes round trip', async () => {
    const e = await call('edit_file', { projectName: P, filePath: 'main.tex', oldString: 'Intro paragraph two', newString: 'Intro paragraph TWO' });
    assert.equal(e.isError, undefined, e.text);
    assert.match(e.text, /\+Intro paragraph TWO/);
    assert.match((await call('pending_changes', { projectName: P })).text, /main\.tex/);
    const p = await call('push_changes', { projectName: P, message: 'Tweak intro' });
    assert.match(p.text, /Pushed/);
    assert.match(await fake.remoteLog(), /^Tweak intro/);
    assert.match(await fake.remoteFile('main.tex'), /Intro paragraph TWO/);
  });

  test('edit_file rejects ambiguous matches', async () => {
    const r = await call('edit_file', { projectName: P, filePath: 'main.tex', oldString: 'Confidence', newString: 'X' });
    assert.equal(r.isError, true);
    assert.match(r.text, /times/);
  });

  test('replace_section + write_file + discard_changes', async () => {
    await call('replace_section', { projectName: P, filePath: 'main.tex', sectionTitle: 'Results', newContent: 'Replaced.\n' });
    assert.match((await call('get_section_content', { projectName: P, filePath: 'main.tex', sectionTitle: 'Results' })).text, /Replaced/);
    const w = await call('write_file', { projectName: P, filePath: 'main.tex', content: 'x' });
    assert.equal(w.isError, true, 'refuses overwrite without flag');
    await call('write_file', { projectName: P, filePath: 'new.tex', content: 'hello\n' });
    assert.match((await call('pending_changes', { projectName: P })).text, /new\.tex/);
    assert.match((await call('discard_changes', { projectName: P })).text, /confirm/);
    await call('discard_changes', { projectName: P, confirm: true });
    assert.match((await call('pending_changes', { projectName: P })).text, /No local changes/);
  });

  test('push conflict is reported, not silently lost', async () => {
    await fake.remoteEdit({ 'main.tex': 'remote version\n' });
    await call('edit_file', { projectName: P, filePath: 'main.tex', oldString: 'Thanks.', newString: 'Thank you.' });
    const p = await call('push_changes', { projectName: P, message: 'Will conflict' });
    assert.equal(p.isError, true);
    assert.match(p.text, /conflict/i);
    await call('discard_changes', { projectName: P, confirm: true });
  });

  test('sync picks up remote edits', async () => {
    const r = (await call('sync', { projectName: P })).text;
    assert.match(r, /pulled|up to date/i);
    assert.match((await call('read_file', { projectName: P, filePath: 'main.tex' })).text, /remote version/);
  });
});
