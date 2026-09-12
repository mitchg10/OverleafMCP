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
});

const configSchema = z.object({
  cacheDir: z.string().optional(),
  syncTtlSeconds: z.number().int().positive().default(30),
  projects: z.record(z.string(), projectSchema),
});

export function defaultCacheDir() {
  return process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches', 'overleaf-mcp')
    : path.join(os.homedir(), '.cache', 'overleaf-mcp');
}

/** Validate a parsed projects.json object and fill defaults. */
export function parseConfig(raw) {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid projects.json: ${issues}`);
  }
  const cfg = result.data;
  return { ...cfg, cacheDir: expandHome(cfg.cacheDir ?? defaultCacheDir()) };
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
