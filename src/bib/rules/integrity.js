import { finding } from './finding.js';

/**
 * Whether the bibliography holds together: every cited key resolves, every
 * entry is used, nothing is declared twice, and the build agrees.
 *
 * These are the checks that need no external knowledge at all, so they are
 * exact rather than advisory.
 */

export const undefinedCitation = {
  id: 'undefined-citation',
  severity: 'error',
  requires: null,
  check(model) {
    const known = new Set(model.entries.map(e => e.key));
    const out = [];
    for (const c of model.citations) {
      for (const key of c.keys) {
        if (key === '*' || known.has(key)) continue;
        out.push(finding('undefined-citation', 'error', {
          file: c.file,
          line: c.line,
          key,
          message: `\\${c.command}{${key}} has no entry in ${describeBibs(model)}`,
          hint: model.bibFiles.length ? null : 'No .bib file was loaded, so every citation is undefined.',
        }));
      }
    }
    return out;
  },
};

export const uncitedEntry = {
  id: 'uncited-entry',
  severity: 'info',
  requires: null,
  check(model) {
    // \nocite{*} pulls in the whole database on purpose.
    if (model.nociteAll) return [];
    const cited = new Set(model.citedKeys);
    return model.entries
      .filter(e => !cited.has(e.key))
      .map(e => finding('uncited-entry', 'info', {
        file: e.file,
        line: e.line,
        key: e.key,
        message: `${e.key} is defined but never cited; it will not appear in the bibliography`,
      }));
  },
};

export const duplicateKey = {
  id: 'duplicate-key',
  severity: 'error',
  requires: null,
  check(model) {
    return model.duplicateKeys.map(d => finding('duplicate-key', 'error', {
      file: d.entries[0].file,
      line: d.entries[0].line,
      key: d.key,
      message: `${d.key} is defined ${d.entries.length} times (${d.entries.map(e => `${e.file}:${e.line}`).join(', ')}); the last definition wins`,
    }));
  },
};

export const missingBibResource = {
  id: 'missing-bib-resource',
  severity: 'error',
  requires: null,
  check(model) {
    const declaredMissing = model.missingBibFiles.map(name => {
      const site = model.declaredBibFiles.find(d => d.name === name);
      return finding('missing-bib-resource', 'error', {
        file: site?.file ?? model.mainFile,
        line: site?.line ?? null,
        message: `Declared bibliography "${name}" could not be read`,
      });
    });
    const noResource = model.declaredBibFiles.length === 0 && model.citations.length > 0
      ? [finding('missing-bib-resource', 'error', {
        file: model.mainFile,
        message: 'Citations exist but no \\bibliography or \\addbibresource declaration was found',
      })]
      : [];
    return [...declaredMissing, ...noResource];
  },
};

export const missingInput = {
  id: 'missing-input',
  severity: 'warning',
  requires: null,
  check(model) {
    return model.missingInputs.map(m => finding('missing-input', 'warning', {
      file: m.from,
      line: m.line,
      message: `\\input{${m.raw}} could not be read, so any citations it contains were not checked`,
    }));
  },
};

export const staleArtifacts = {
  id: 'stale-artifacts',
  severity: 'info',
  requires: null,
  check(model) {
    if (!model.artifacts.present.length) return [];
    if (!model.artifacts.stale) return [];
    return [finding('stale-artifacts', 'info', {
      file: model.artifacts.present[0],
      message: 'Build artifacts are older than the sources; artifact-based checks may be out of date. Run compile.',
    })];
  },
};

/** Surface the resolver's own warnings rather than trying to re-derive them. */
export const resolverWarning = {
  id: 'resolver-warning',
  severity: 'warning',
  requires: 'artifacts',
  check(model) {
    const blg = model.artifacts.blg;
    if (!blg) return [];
    return blg.messages.map(m => {
      const entry = m.key ? model.byKey.get(m.key) : null;
      return finding('resolver-warning', m.level === 'error' ? 'error' : 'warning', {
        file: entry?.file ?? model.artifacts.present.find(p => p.endsWith('.blg')),
        line: entry?.line ?? m.line,
        key: m.key,
        message: `${blg.engine} says: ${m.message}`,
      });
    });
  },
};

/** Keys the build resolved that the source no longer cites, and vice versa. */
export const artifactDrift = {
  id: 'artifact-drift',
  severity: 'info',
  requires: 'artifacts',
  check(model) {
    const aux = model.artifacts.aux;
    if (!aux || model.artifacts.stale) return [];
    const inSource = new Set(model.citedKeys);
    const newKeys = model.citedKeys.filter(k => !aux.citations.includes(k));
    const goneKeys = aux.citations.filter(k => !inSource.has(k));
    if (!newKeys.length && !goneKeys.length) return [];
    return [finding('artifact-drift', 'info', {
      file: model.mainFile,
      message: `Source and last build disagree on cited keys: ${describeDrift(newKeys, goneKeys)}. Recompile to refresh labels.`,
    })];
  },
};

function describeDrift(added, removed) {
  const parts = [];
  if (added.length) parts.push(`${added.length} new (${added.slice(0, 3).join(', ')})`);
  if (removed.length) parts.push(`${removed.length} no longer cited (${removed.slice(0, 3).join(', ')})`);
  return parts.join('; ');
}

function describeBibs(model) {
  return model.bibFiles.length ? model.bibFiles.map(f => f.path).join(', ') : 'any bibliography';
}

export const INTEGRITY_RULES = [
  undefinedCitation, duplicateKey, missingBibResource, missingInput,
  resolverWarning, uncitedEntry, staleArtifacts, artifactDrift,
];
