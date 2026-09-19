import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export async function pdfPageCount(pdfPath) {
  const { stdout } = await execFile('pdfinfo', [pdfPath]);
  const m = stdout.match(/^Pages:\s+(\d+)/m);
  if (!m) throw new Error(`Could not read page count from ${pdfPath}`);
  return Number(m[1]);
}

async function assertPageInRange(pdfPath, page) {
  const total = await pdfPageCount(pdfPath);
  if (page < 1 || page > total) {
    throw new Error(`Page ${page} out of range: the PDF only has ${total} page${total === 1 ? '' : 's'}`);
  }
  return total;
}

/** Rasterize one page to PNG; returns an MCP image content block. */
export async function renderPage({ pdfPath, page, dpi = 100 }) {
  const total = await assertPageInRange(pdfPath, page);
  const dir = await mkdtemp(path.join(tmpdir(), 'overleaf-render-'));
  try {
    const prefix = path.join(dir, 'page');
    await execFile('pdftoppm', ['-png', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', pdfPath, prefix]);
    const png = await readFile(`${prefix}.png`);
    return { type: 'image', mimeType: 'image/png', data: png.toString('base64'), page, totalPages: total };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Extract layout-preserving text for a page range. */
export async function pdfText({ pdfPath, firstPage = 1, lastPage }) {
  const total = await assertPageInRange(pdfPath, firstPage);
  const last = Math.min(lastPage ?? firstPage, total);
  const { stdout } = await execFile('pdftotext', ['-layout', '-f', String(firstPage), '-l', String(last), pdfPath, '-'], {
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}
