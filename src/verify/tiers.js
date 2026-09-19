/**
 * Confidence tiers, in display order: most actionable first.
 *
 * The meanings are stated here and repeated verbatim in the tool description,
 * because the core hazard in this whole feature is false confidence. Every
 * wrong answer it gives is one an agent will act on.
 */
export const TIERS = Object.freeze([
  'retracted',
  'invalid-identifier',
  'superseded',
  'verified-with-mismatch',
  'candidate',
  'unverified',
  'verified',
  'unverifiable-by-design',
  'error',
]);

export const TIER_MEANING = Object.freeze({
  retracted: 'A retraction notice points at this work. Check before citing it.',
  'invalid-identifier': 'The DOI in the entry is not registered with Crossref or DataCite. ' +
    'The strongest signal available, but still not proof of fabrication: check the publisher page first.',
  superseded: 'Cited as a preprint, but a published version appears to exist.',
  'verified-with-mismatch': 'The work is real and the identifier resolves, but a field disagrees with the registry.',
  candidate: 'One source matched. Suggestive only; not confirmation.',
  unverified: 'No source matched. NOT evidence of fabrication - Crossref indexes neither arXiv DOIs nor ' +
    'NeurIPS/ICLR/ICML proceedings, so many real papers cannot be found this way.',
  verified: 'The identifier resolves and the record agrees with the entry.',
  'unverifiable-by-design': 'Unpublished or under review. Never checked and never sent to any API.',
  error: 'The lookup itself failed (network, timeout, or rate limit). Says nothing about the citation.',
});

const RANK = new Map(TIERS.map((tier, i) => [tier, i]));

export function tierRank(tier) {
  return RANK.get(tier) ?? TIERS.length;
}

/** Tiers a reader must act on, as opposed to tiers that are simply good news. */
export function isActionable(tier) {
  return !['verified', 'unverifiable-by-design'].includes(tier);
}
