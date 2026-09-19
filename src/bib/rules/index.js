import { INTEGRITY_RULES } from './integrity.js';
import { STYLE_RULES } from './style.js';
import { CONSISTENCY_RULES } from './consistency.js';
import { FIELD_RULES } from './fields.js';
import { partitionUnverifiable } from './unverifiable.js';

export { classifyUnverifiable, partitionUnverifiable } from './unverifiable.js';

export const ALL_RULES = Object.freeze([
  ...INTEGRITY_RULES, ...STYLE_RULES, ...CONSISTENCY_RULES, ...FIELD_RULES,
]);

export const RULE_IDS = Object.freeze(ALL_RULES.map(r => r.id));

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * Run rules over a model.
 *
 * A rule whose `requires` is unmet is reported as not-checked rather than
 * silently passing, because "no findings" and "never looked" are different
 * claims and an agent will act on the difference.
 *
 * @param {object} model from collectBibliography
 * @param {{ rules?: string[], severity?: string, selfAuthors?: string[] }} [options]
 */
export function runRules(model, { rules = null, severity = 'info', selfAuthors = [] } = {}) {
  const wanted = rules ? ALL_RULES.filter(r => rules.includes(r.id)) : ALL_RULES;
  const { excluded } = partitionUnverifiable(model.entries, { selfAuthors });
  const scoped = { ...model, excludedKeys: excluded.map(e => e.entry.key) };

  const findings = [];
  const notChecked = [];

  for (const rule of wanted) {
    const missing = unmetRequirement(rule, model);
    if (missing) {
      notChecked.push({ rule: rule.id, reason: missing });
      continue;
    }
    findings.push(...rule.check(scoped));
  }

  return Object.freeze({
    findings: sortFindings(findings.filter(f => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[severity])),
    notChecked,
    excluded,
    counts: countBySeverity(findings),
  });
}

function unmetRequirement(rule, model) {
  if (rule.requires === 'artifacts' && !model.artifacts.present.length) {
    return 'requires build artifacts, run compile';
  }
  return null;
}

function sortFindings(findings) {
  return [...findings].sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (a.file ?? '').localeCompare(b.file ?? '') ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.rule.localeCompare(b.rule));
}

function countBySeverity(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}
