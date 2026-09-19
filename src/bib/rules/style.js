import { finding } from './finding.js';
import { NATBIB_COMMANDS, BIBLATEX_COMMANDS } from '../../latex/cite-scan.js';

/**
 * Whether the citation commands in use match the backend the document sets up.
 *
 * Command syntax alone cannot identify the backend, so every rule here reads
 * the detected style and reports its confidence. A low-confidence detection
 * downgrades these to info: guessing wrong here would be worse than silence.
 */

export const illegalCiteCommand = {
  id: 'illegal-cite-command',
  severity: 'error',
  requires: null,
  check(model) {
    const { style } = model;
    if (style.confidence === 'none' || !style.allowedCommands.length) return [];
    const allowed = new Set(style.allowedCommands);
    const severity = style.confidence === 'high' ? 'error' : 'warning';

    return unique(model.citations.filter(c => !allowed.has(c.command)), c => `${c.file}:${c.line}:${c.command}`)
      .map(c => finding('illegal-cite-command', severity, {
        file: c.file,
        line: c.line,
        message: `\\${c.command} is not available under ${describe(style)}`,
        hint: suggestFor(c.command, style),
      }));
  },
};

export const mixedCiteFamily = {
  id: 'mixed-cite-family',
  severity: 'warning',
  requires: null,
  check(model) {
    const natbib = new Set(NATBIB_COMMANDS);
    const biblatex = new Set(BIBLATEX_COMMANDS);
    const used = new Set(model.citations.map(c => c.command));
    const fromNatbib = [...used].filter(c => natbib.has(c));
    const fromBiblatex = [...used].filter(c => biblatex.has(c));
    if (!fromNatbib.length || !fromBiblatex.length) return [];

    return [finding('mixed-cite-family', 'warning', {
      file: model.mainFile,
      message:
        `Both command families are in use: ${fromNatbib.join(', ')} (natbib) and ${fromBiblatex.join(', ')} (biblatex). ` +
        'Citations will render in two different shapes.',
    })];
  },
};

export const mixedBibDeclaration = {
  id: 'mixed-bib-declaration',
  severity: 'warning',
  requires: null,
  check(model) {
    const commands = new Set(model.declaredBibFiles.map(d => d.command));
    if (commands.size < 2) return [];
    const site = model.declaredBibFiles[0];
    return [finding('mixed-bib-declaration', 'warning', {
      file: site.file,
      line: site.line,
      message: '\\bibliography and \\addbibresource are both used; they belong to different backends',
    })];
  },
};

export const styleConflict = {
  id: 'style-conflict',
  severity: 'warning',
  requires: null,
  check(model) {
    return (model.style.conflicts ?? []).map(text => finding('style-conflict', 'warning', {
      file: model.mainFile,
      message: text,
    }));
  },
};

/** The build is the tiebreaker when the source is ambiguous. */
export const backendMismatch = {
  id: 'backend-mismatch',
  severity: 'warning',
  requires: 'artifacts',
  check(model) {
    const { artifacts, style } = model;
    if (!artifacts.present.length || artifacts.stale) return [];

    const out = [];
    const ranBiber = artifacts.blg?.engine === 'biber' || Boolean(artifacts.bcf);
    if (ranBiber && style.backend === 'bibtex') {
      out.push(mismatch(model, 'the build ran biber, but the source reads as BibTeX'));
    }
    if (!ranBiber && artifacts.blg?.engine === 'bibtex' && style.backend !== 'bibtex') {
      out.push(mismatch(model, `the build ran BibTeX, but the source declares backend=${style.backend}`));
    }
    if (artifacts.aux?.bibstyle && style.style && artifacts.aux.bibstyle !== style.style) {
      out.push(mismatch(model, `the build used style "${artifacts.aux.bibstyle}", the source implies "${style.style}"`));
    }
    return out;
  },
};

function mismatch(model, text) {
  return finding('backend-mismatch', 'warning', {
    file: model.mainFile,
    message: `Source and build disagree: ${text}`,
    hint: 'The build is authoritative. Trust it over the source-based detection.',
  });
}

function describe(style) {
  const base = style.package ? `${style.backend} + ${style.package}` : style.backend;
  const compat = style.package === 'biblatex' && !style.natbibCompat ? ' without natbib=true' : '';
  return `${base}${compat} (detected with ${style.confidence} confidence from ${style.styleSource ?? 'package options'})`;
}

function suggestFor(command, style) {
  if (style.package === 'biblatex' && !style.natbibCompat) {
    const swap = { citep: '\\parencite', citet: '\\textcite', citeyear: '\\citeyear (biblatex spelling differs)' };
    return swap[command] ? `Use ${swap[command]}, or load biblatex with natbib=true.` : 'Load biblatex with natbib=true to keep natbib spellings.';
  }
  if (style.backend === 'bibtex' && !style.package) return 'Load \\usepackage{natbib} to use the extended citation commands.';
  return null;
}

function unique(items, keyOf) {
  const seen = new Set();
  return items.filter(i => {
    const k = keyOf(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const STYLE_RULES = [illegalCiteCommand, mixedCiteFamily, mixedBibDeclaration, styleConflict, backendMismatch];
