import { parseBib } from '../../src/bib/parse.js';
import { detectBibStyle } from '../../src/latex/bib-style.js';
import { scanCitations, citedKeys, hasNociteAll } from '../../src/latex/cite-scan.js';

/**
 * Build the model `runRules` consumes from in-memory sources.
 *
 * Mirrors `collectBibliography` without needing a git clone, which keeps rule
 * tests pure and fast. Anything a rule reads has a default here, so a test only
 * states the part it cares about.
 */
export function buildModel({
  bib = '',
  bibPath = 'refs.bib',
  tex = '',
  mainFile = 'main.tex',
  styFiles = [],
  artifacts = {},
  declaredBibFiles = null,
  missingBibFiles = [],
  missingInputs = [],
  unreachableTexFiles = [],
  project = {},
} = {}) {
  const parsed = parseBib(bib, { file: bibPath });
  const citations = scanCitations(tex, { file: mainFile });
  const entries = parsed.entries;

  return Object.freeze({
    mainFile,
    style: detectBibStyle(tex, { file: mainFile, styFiles }),
    texFiles: [{ path: mainFile, source: tex }],
    unreachableTexFiles,
    missingInputs,
    bibFiles: bib ? [{ path: bibPath, parsed }] : [],
    missingBibFiles,
    declaredBibFiles: declaredBibFiles ?? (bib ? [{ name: bibPath, command: 'bibliography', file: mainFile, line: 1 }] : []),
    entries,
    byKey: new Map(entries.map(e => [e.key, e])),
    duplicateKeys: duplicatesOf(entries),
    citations,
    citedKeys: citedKeys(citations),
    nociteAll: hasNociteAll(citations),
    artifacts: { present: [], stale: false, aux: null, bbl: null, blg: null, bcf: null, ...artifacts },
    project,
  });
}

function duplicatesOf(entries) {
  const seen = new Map();
  for (const e of entries) {
    if (!seen.has(e.key)) seen.set(e.key, []);
    seen.get(e.key).push(e);
  }
  return [...seen.entries()].filter(([, l]) => l.length > 1).map(([key, list]) => ({ key, entries: list }));
}
