import { z } from 'zod';
import { collectBibliography } from '../bib/collect.js';
import { runRules, RULE_IDS } from '../bib/rules/index.js';
import { formatCitationReport } from '../bib/report.js';
import { partitionUnverifiable } from '../bib/rules/unverifiable.js';
import { resolveEntry } from '../verify/resolve.js';
import { formatVerifyReport } from '../verify/report.js';
import { TIER_MEANING } from '../verify/tiers.js';
import { registerTool, text, projectNameSchema } from './shared.js';

const DEFAULT_MAX_FINDINGS = 200;
const DEFAULT_VERIFY_LIMIT = 25;

export function registerCitationTools(server, ctx) {
  registerCheckCitations(server, ctx);
  registerVerifyReferences(server, ctx);
}

function registerCheckCitations(server, ctx) {
  registerTool(server, ctx, 'check_citations', {
    description:
      'Check a project\'s citations and bibliography offline: undefined citations, uncited or duplicate entries, ' +
      'citation commands that do not match the detected backend, and formatting drift inside the .bib. ' +
      'Runs instantly and makes no network requests, so it is cheap to call often. ' +
      'Consistency findings are relative to the document\'s own majority convention, not an imposed house style, ' +
      'because each paper has its own reference style. ' +
      'Findings are line-anchored (file:line) so you can go straight to read_file or edit_file. ' +
      'It reports what the source says, not whether a citation is real — this tool never checks the outside world.',
    inputSchema: {
      projectName: projectNameSchema,
      mainFile: z.string().optional().describe('Override the detected main .tex file (e.g. to check a camera-ready variant).'),
      bibFile: z.string().optional().describe('Check only this .bib file instead of every declared one.'),
      severity: z.enum(['error', 'warning', 'info']).optional()
        .describe('Lowest severity to report. Default "info" (everything); use "warning" or "error" to cut noise.'),
      rules: z.array(z.enum(RULE_IDS)).optional()
        .describe(`Run only these rules. Available: ${RULE_IDS.join(', ')}.`),
      includeUncited: z.boolean().optional()
        .describe('List entries that are defined but never cited. Off by default because a shared .bib is often larger than one paper.'),
      maxFindings: z.number().int().min(1).max(1000).optional().describe(`Cap on findings shown. Default ${DEFAULT_MAX_FINDINGS}.`),
      refresh: z.boolean().optional().describe('Force a pull from Overleaf before checking.'),
    },
  }, async (args, context) => {
    const p = await context.open(args.projectName, { refresh: args.refresh });
    const model = await collectBibliography(p, { mainFile: args.mainFile, bibFile: args.bibFile });

    const results = runRules(model, {
      rules: args.rules ?? null,
      severity: args.severity ?? 'info',
      selfAuthors: p.project.selfAuthors ?? [],
    });

    const includeUncited = args.includeUncited ?? Boolean(args.rules?.includes('uncited-entry'));
    return text(formatCitationReport(model, hideUncited(results, includeUncited), {
      maxFindings: args.maxFindings ?? DEFAULT_MAX_FINDINGS,
      includeUncited,
    }));
  });
}

function registerVerifyReferences(server, ctx) {
  registerTool(server, ctx, 'verify_references', {
    description:
      'Check that cited works are real and correctly described, by resolving each entry\'s DOI against Crossref ' +
      'and DataCite. Uses the network and is much slower than check_citations, so run check_citations first and ' +
      'call this deliberately. Results are cached on disk, so a re-run costs almost nothing.\n' +
      'Verdicts and exactly what they mean:\n' +
      Object.entries(TIER_MEANING).map(([tier, meaning]) => `  ${tier}: ${meaning}`).join('\n') +
      '\nDo not report an unverified entry as fabricated or invented. This tool reports only what registries say, ' +
      'and it never edits a file.',
    inputSchema: {
      projectName: projectNameSchema,
      keys: z.array(z.string().min(1)).optional()
        .describe('Only these citekeys. Defaults to every key actually cited in the document.'),
      limit: z.number().int().min(1).max(200).optional()
        .describe(`Most entries to check in one call. Default ${DEFAULT_VERIFY_LIMIT}, which keeps a run short.`),
      includeUnverifiable: z.boolean().optional()
        .describe('List entries excluded by design (submitted/under review). They are never sent to any API either way.'),
      forceRefresh: z.boolean().optional().describe('Ignore cached responses and re-query every source.'),
      mainFile: z.string().optional().describe('Override the detected main .tex file.'),
      bibFile: z.string().optional().describe('Use only this .bib file.'),
      refresh: z.boolean().optional().describe('Force a pull from Overleaf before checking.'),
    },
  }, async (args, context) => {
    if (!context.verify.enabled) {
      throw new Error('Verification is disabled. Set verify.enabled to true in projects.json to allow network lookups.');
    }
    const p = await context.open(args.projectName, { refresh: args.refresh });
    const model = await collectBibliography(p, { mainFile: args.mainFile, bibFile: args.bibFile });

    const requested = args.keys?.length ? args.keys : model.citedKeys;
    const unknown = requested.filter(key => !model.byKey.has(key));
    const entries = requested.map(key => model.byKey.get(key)).filter(Boolean);
    const selfAuthors = p.project.selfAuthors ?? [];
    const { checkable, excluded } = partitionUnverifiable(entries, { selfAuthors });

    const limit = args.limit ?? DEFAULT_VERIFY_LIMIT;
    const before = context.http.stats();
    const results = [];
    // Sequential on purpose: the throttle serializes per host anyway, and this
    // keeps the request count in the report an honest account of the run.
    for (const entry of checkable.slice(0, limit)) {
      results.push(await resolveEntry(entry, {
        http: context.http,
        thresholds: context.verify.thresholds,
        mailto: context.verify.mailto ?? null,
        forceRefresh: args.forceRefresh ?? false,
        selfAuthors,
      }));
    }
    if (args.includeUnverifiable) {
      results.push(...excluded.map(({ entry, reason }) => ({
        key: entry.key, file: entry.file, line: entry.line,
        tier: 'unverifiable-by-design', notes: [reason], requests: [],
      })));
    }

    const report = formatVerifyReport(results, {
      stats: diffStats(before, context.http.stats()),
      checked: Math.min(checkable.length, limit),
      total: entries.length,
      skipped: excluded.length,
      limit,
      thresholds: context.verify.thresholds,
    });
    return text(unknown.length ? `${report}\n\nNot in the bibliography: ${unknown.join(', ')}` : report);
  });
}

/** Request counts for this call alone; the client's counters are process-wide. */
function diffStats(before, after) {
  return {
    requests: after.requests - before.requests,
    cacheHits: after.cacheHits - before.cacheHits,
    retries: after.retries - before.retries,
    failures: after.failures - before.failures,
  };
}

/**
 * Uncited entries are hidden by default, since a shared `.bib` is routinely
 * larger than any one paper. They are still counted: the report says how many
 * were suppressed, so silence is never mistaken for none.
 */
function hideUncited(results, includeUncited) {
  if (includeUncited) return results;
  const hidden = results.findings.filter(f => f.rule === 'uncited-entry');
  if (!hidden.length) return results;
  return {
    ...results,
    findings: results.findings.filter(f => f.rule !== 'uncited-entry'),
    counts: { ...results.counts, info: results.counts.info - hidden.length },
    suppressedUncited: hidden.length,
  };
}
