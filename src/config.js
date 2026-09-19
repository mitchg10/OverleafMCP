import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const ENGINES = ['pdflatex', 'xelatex', 'lualatex'];

const projectSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().regex(/^[0-9a-f]{24}$/, 'projectId must be a 24-char hex Overleaf id'),
  gitToken: z.string().min(1),
  mainFile: z.string().optional(),
  engine: z.enum(ENGINES).optional(),
  headings: z.array(z.string().regex(/^[A-Za-z@]+$/)).optional(),
  /** Surnames whose unpublished work is never flagged and never sent to an API. */
  selfAuthors: z.array(z.string().min(1)).optional(),
  /** Project-specific citation macros, e.g. ["mycite"]. */
  citeCommands: z.array(z.string().regex(/^[A-Za-z@]+$/)).optional(),
});

/**
 * Per-host minimum interval between requests.
 *
 * Semantic Scholar grants 1 request per second cumulative across all endpoints,
 * so its floor is 1000ms and must not be lowered. The others are set to be
 * good citizens of free public APIs rather than to satisfy a published limit.
 */
const throttleSchema = z.object({
  'api.semanticscholar.org': z.number().int().min(1000).default(1100),
  'api.crossref.org': z.number().int().min(0).default(100),
  'api.datacite.org': z.number().int().min(0).default(200),
  'api.openalex.org': z.number().int().min(0).default(100),
  'doi.org': z.number().int().min(0).default(100),
  'export.arxiv.org': z.number().int().min(0).default(3000),
}).default({});

const verifySchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * Opt-in only. This is the user's own email going to third parties in a
   * `mailto=` parameter, so it is never inferred from the git account and
   * never echoed into tool output.
   */
  mailto: z.string().email().optional(),
  semanticScholarApiKey: z.string().min(1).optional(),
  cacheTtlDays: z.object({
    record: z.number().int().positive().default(30),
    search: z.number().int().positive().default(7),
    negative: z.number().int().positive().default(3),
  }).default({}),
  minIntervalMs: throttleSchema,
  timeoutMs: z.number().int().positive().default(15_000),
  thresholds: z.object({
    /** Title similarity at or above this counts as a match. */
    accept: z.number().min(0).max(1).default(0.85),
    /** Below this, a result is not even worth showing as a candidate. */
    consider: z.number().min(0).max(1).default(0.6),
  }).default({}),
}).default({});

const configSchema = z.object({
  cacheDir: z.string().optional(),
  syncTtlSeconds: z.number().int().positive().default(30),
  verify: verifySchema,
  projects: z.record(z.string(), projectSchema),
});

export function defaultCacheDir() {
  return process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches', 'overleaf-mcp')
    : path.join(os.homedir(), '.cache', 'overleaf-mcp');
}

/** Validate a parsed projects.json object and fill defaults. `env` is a test seam. */
export function parseConfig(raw, env = process.env) {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid projects.json: ${issues}`);
  }
  const cfg = result.data;
  return {
    ...cfg,
    cacheDir: expandHome(cfg.cacheDir ?? defaultCacheDir()),
    verify: withEnvFallbacks(cfg.verify, env),
  };
}

/**
 * Secrets may come from the environment instead of the config file, so they
 * need not be written to disk at all. The config file wins where both are set,
 * because it is the more deliberate choice.
 */
function withEnvFallbacks(verify, env) {
  return {
    ...verify,
    semanticScholarApiKey: verify.semanticScholarApiKey ?? env.OVERLEAF_MCP_S2_API_KEY ?? undefined,
    mailto: verify.mailto ?? env.OVERLEAF_MCP_MAILTO ?? undefined,
  };
}

/** Every secret this config holds, for value-based scrubbing of tool output. */
export function secretsOf(config) {
  return [
    ...Object.values(config.projects).map(p => p.gitToken),
    config.verify?.semanticScholarApiKey,
    // Very short values are skipped: redacting a 3-character string would
    // mangle ordinary output for no security benefit.
  ].filter(s => typeof s === 'string' && s.length >= 6);
}

export async function loadConfig(configPath) {
  let text;
  try {
    text = await readFile(configPath, 'utf-8');
  } catch (error) {
    throw new Error(`Cannot read ${configPath}: ${error.message}. Create it from projects.example.json.`);
  }
  return parseConfig(JSON.parse(text));
}

export function projectKeys(config) {
  return Object.keys(config.projects);
}

/** Look up a project by key; the error names valid keys so agents can self-correct. */
export function getProjectConfig(config, projectName) {
  const keys = projectKeys(config).join(', ');
  if (!projectName) {
    throw new Error(`projectName is required. Available projects: ${keys}`);
  }
  const project = config.projects[projectName];
  if (!project) {
    throw new Error(`Project "${projectName}" not found. Available projects: ${keys}`);
  }
  return { ...project, key: projectName };
}

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}
