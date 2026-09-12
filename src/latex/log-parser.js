const ERROR_RE = /^(\.{0,2}\/?[^:\n]+?\.(?:tex|sty|cls|bib|bbl)):(\d+): (.+)$/gm;
const UNDEF_REF_RE = /LaTeX Warning: Reference `([^']+)' on page \d+ undefined/g;
const UNDEF_CITE_RE = /LaTeX Warning: Citation `([^']+)' on page \d+ undefined/g;
const OVERFULL_RE = /Overfull \\hbox \(([\d.]+)pt too wide\) in paragraph at lines (\d+--\d+)/g;
const UNDERFULL_RE = /Underfull \\[hv]box/g;
const PAGES_RE = /Output written on .+ \((\d+) pages?/;
const FATAL_RE = /^! (.+)$/gm;

/** Parse a pdflatex/latexmk log into a compact diagnostics object. */
export function parseLatexLog(log) {
  const text = unwrapLongLines(log);
  return {
    errors: [...text.matchAll(ERROR_RE)].map(m => ({ file: m[1], line: Number(m[2]), message: m[3].trim() })),
    fatal: [...text.matchAll(FATAL_RE)].map(m => m[1].trim()),
    undefinedReferences: unique([...text.matchAll(UNDEF_REF_RE)].map(m => m[1])),
    undefinedCitations: unique([...text.matchAll(UNDEF_CITE_RE)].map(m => m[1])),
    overfullBoxes: [...text.matchAll(OVERFULL_RE)].map(m => ({ pt: round2(Number(m[1])), lines: m[2] })),
    underfullBoxes: [...text.matchAll(UNDERFULL_RE)].length,
    pages: readPages(text),
  };
}

/** TeX wraps log lines at 79 chars; join continuation lines so regexes match. */
function unwrapLongLines(log) {
  return log.replace(/^(.{79})\n(?=\S)/gm, '$1');
}

function readPages(text) {
  const m = text.match(PAGES_RE);
  return m ? Number(m[1]) : null;
}

function unique(arr) {
  return [...new Set(arr)];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
