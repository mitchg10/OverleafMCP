/**
 * Grep-shaped rendering of citation findings.
 *
 * Every line is anchored to `file:line` so an agent can go straight to
 * `read_file` or `edit_file` without another search. Counts that are zero are
 * omitted, but "not checked" is always stated: silence must never be readable
 * as a pass.
 */

const HEADINGS = { error: 'ERRORS', warning: 'WARNINGS', info: 'NOTES' };

export function formatCitationReport(model, results, { maxFindings = 200, includeUncited = false } = {}) {
  const shown = results.findings.slice(0, maxFindings);
  const sections = ['error', 'warning', 'info']
    .map(severity => formatSection(severity, shown.filter(f => f.severity === severity)))
    .filter(Boolean);

  return [
    ...summaryLines(model, results),
    '',
    ...(sections.length ? sections : ['No findings at the requested severity.']),
    ...truncationNote(results.findings.length, shown.length),
    ...notCheckedLines(results.notChecked),
    ...excludedLines(results.excluded),
    ...uncitedHint(results, includeUncited),
  ].join('\n');
}

function summaryLines(model, results) {
  const { counts } = results;
  return [
    `Citations: ${model.entries.length} entries in ${fileList(model.bibFiles.map(f => f.path))}; ` +
      `${model.citations.length} cite commands across ${model.texFiles.length} .tex file(s); ` +
      `${model.citedKeys.length} distinct keys cited${model.nociteAll ? '; \\nocite{*} is in effect' : ''}.`,
    `Style: ${describeStyle(model.style)}`,
    `Artifacts: ${describeArtifacts(model.artifacts)}`,
    `Findings: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} note(s).`,
  ];
}

function describeStyle(style) {
  if (style.confidence === 'none') return 'no bibliography setup detected.';
  const pkg = style.package ? `${style.backend} + ${style.package}` : style.backend;
  const named = style.style ? ` style "${style.style}"` : ' (no style named)';
  const where = style.styleSource ? ` (set in ${style.styleSource})` : '';
  const compat = style.package === 'biblatex' ? `, natbib compat ${style.natbibCompat ? 'on' : 'off'}` : '';
  return `${pkg},${named}${where}${compat}. Confidence: ${style.confidence}.`;
}

function describeArtifacts(artifacts) {
  if (!artifacts.present.length) return 'none found; artifact-based checks were skipped. Run compile.';
  return `${fileList(artifacts.present)}, ${artifacts.stale ? 'STALE (recompile for accurate results)' : 'fresh'}.`;
}

function formatSection(severity, findings) {
  if (!findings.length) return null;
  const width = Math.max(...findings.map(f => f.rule.length));
  const lines = findings.flatMap(f => [
    `  ${f.rule.padEnd(width)}  ${location(f)}  ${f.message}`,
    ...(f.hint ? [`  ${' '.repeat(width)}  ${' '.repeat(location(f).length)}  ${f.hint}`] : []),
  ]);
  return [`${HEADINGS[severity]} (${findings.length})`, ...lines, ''].join('\n');
}

function location(f) {
  if (!f.file) return '(project)';
  return f.line ? `${f.file}:${f.line}` : f.file;
}

function truncationNote(total, shown) {
  return total > shown ? [`... ${total - shown} more finding(s) suppressed; raise maxFindings or filter with rules.`] : [];
}

function notCheckedLines(notChecked) {
  if (!notChecked.length) return [];
  return [`Not checked: ${notChecked.map(n => `${n.rule} (${n.reason})`).join('; ')}`];
}

function excludedLines(excluded) {
  if (!excluded.length) return [];
  const listed = excluded.slice(0, 5).map(e => `${e.entry.key} (${e.reason})`).join(', ');
  const more = excluded.length > 5 ? `, +${excluded.length - 5} more` : '';
  return [
    `Unverifiable by design (${excluded.length}, excluded from field checks and never sent to any API): ${listed}${more}`,
  ];
}

function uncitedHint(results, includeUncited) {
  if (includeUncited) return [];
  return results.suppressedUncited
    ? [`${results.suppressedUncited} entry/entries are defined but never cited; pass includeUncited: true to list them.`]
    : [];
}

function fileList(paths) {
  return paths.length ? paths.join(', ') : '(none)';
}
