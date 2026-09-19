import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_EXCLUDES = new Set(['.git', '.build', 'node_modules']);

/** Resolve `relPath` inside `root`, refusing anything that escapes it. */
export function resolveInside(root, relPath) {
  const base = path.resolve(root);
  const full = path.resolve(base, relPath ?? '');
  if (path.isAbsolute(relPath ?? '') || (full !== base && !full.startsWith(base + path.sep))) {
    throw new Error(`Path "${relPath}" is outside the project`);
  }
  return full;
}

/** Recursively list files as [{ path, size }] relative to root. */
export async function walkFiles(root, { extensions = null, exclude = DEFAULT_EXCLUDES } = {}) {
  const wanted = extensions ? new Set(extensions.map(normalizeExt)) : null;
  const entries = await collect(root, root, exclude);
  const filtered = wanted ? entries.filter(e => wanted.has(path.extname(e.path).toLowerCase())) : entries;
  return filtered.sort((a, b) => a.path.localeCompare(b.path));
}

async function collect(root, dir, exclude) {
  const dirents = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    dirents.map(async d => {
      if (exclude.has(d.name)) return [];
      const full = path.join(dir, d.name);
      if (d.isDirectory()) return collect(root, full, exclude);
      if (!d.isFile()) return [];
      const { size } = await stat(full);
      return [{ path: path.relative(root, full), size }];
    }),
  );
  return nested.flat();
}

function normalizeExt(ext) {
  const e = ext.toLowerCase();
  return e.startsWith('.') ? e : `.${e}`;
}
