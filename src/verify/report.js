import { TIERS, TIER_MEANING, isActionable } from './tiers.js';

/**
 * Grouped by tier, most actionable first, with the request economics on line
 * two so the cost of a run is always visible.
 *
 * Verified entries are listed as bare keys. Detail is spent on the things a
 * reader has to act on; a long list of good news pushes the findings off the
 * top of the window.
 */

const MAX_VERIFIED_LISTED = 40;

export function formatVerifyReport(results, { stats = {}, checked = 0, total = 0, skipped = 0, limit = null, thresholds = {} } = {}) {
  const byTier = groupByTier(results);
  const out = [summaryLine(byTier, { checked, total, skipped }), economicsLine(stats)];

  if (limit !== null && total > checked + skipped) {
    out.push(`Stopped at limit ${limit}; ${total - checked - skipped} entr(ies) not checked. Raise limit or pass keys to continue.`);
  }

  for (const tier of TIERS) {
    const group = byTier.get(tier);
    if (!group?.length) continue;
    out.push('', `${tier.replace(/-/g, ' ').toUpperCase()} (${group.length})`, `  ${TIER_MEANING[tier]}`);
    out.push(...(isActionable(tier) ? group.flatMap(r => detailFor(r, thresholds)) : [compactList(group)]));
  }

  out.push('', 'No file was changed. Nothing here is written back to a .bib; apply corrections with edit_file.');
  return out.join('\n');
}

function summaryLine(byTier, { checked, total, skipped }) {
  const counts = TIERS.filter(t => byTier.get(t)?.length).map(t => `${t} ${byTier.get(t).length}`);
  const scope = `Checked ${checked} of ${total} entries`;
  return `${scope}${skipped ? `; ${skipped} skipped by design` : ''} | ${counts.join(' | ') || 'nothing to report'}`;
}

function economicsLine(stats) {
  const parts = [
    `Requests: ${stats.requests ?? 0}`,
    `${stats.cacheHits ?? 0} cache hits`,
    `${stats.retries ?? 0} rate-limit retries`,
  ];
  if (stats.failures) parts.push(`${stats.failures} failed`);
  return `${parts[0]} (${parts.slice(1).join(', ')}).`;
}

function detailFor(result, thresholds) {
  const lines = [`  ${result.key}  ${result.file}:${result.line}  ${headlineFor(result, thresholds)}`];
  for (const note of result.notes ?? []) lines.push(`      ${note}`);
  if (result.match?.mismatches?.length) {
    for (const m of result.match.mismatches) {
      lines.push(`      ${m.field}: bib has ${trim(m.bib)}; ${result.record.source} has ${trim(m.source)}`);
    }
  }
  if (result.requests?.length) lines.push(`      ${result.requests.map(describe).join(', ')}`);
  return lines;
}

function headlineFor(result, thresholds) {
  const accept = thresholds.accept ?? 0.85;
  switch (result.tier) {
    case 'retracted':
      return `${result.record.retractions.map(r => r.type).join(', ')} (see ${result.record.retractions[0].doi ?? 'the notice'})`;
    case 'invalid-identifier':
      return `${result.identifier.type} ${result.identifier.value} does not resolve`;
    case 'verified-with-mismatch':
      return `resolves, but ${result.match.mismatches.length} field(s) disagree; title score ${result.match.score}`;
    case 'candidate':
      return `one source matched at ${result.match.score} (accept is ${accept})`;
    case 'unverified':
      if (result.resolvesTo) return 'the DOI resolves, but no registry holds metadata to check the entry against';
      return result.notes?.length ? 'not checked against any source' : `no source matched at or above ${accept}`;
    case 'error':
      return 'lookup failed';
    default:
      return result.tier;
  }
}

function compactList(group) {
  const keys = group.map(r => r.key);
  const shown = keys.slice(0, MAX_VERIFIED_LISTED).join(', ');
  return `  ${shown}${keys.length > MAX_VERIFIED_LISTED ? `, and ${keys.length - MAX_VERIFIED_LISTED} more` : ''}`;
}

function describe(request) {
  return `${request.source} ${request.status}${request.fromCache ? ' (cached)' : ''}`;
}

function trim(value) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function groupByTier(results) {
  const map = new Map();
  for (const result of results) {
    if (!map.has(result.tier)) map.set(result.tier, []);
    map.get(result.tier).push(result);
  }
  return map;
}
