# Overleaf MCP Server

An MCP server that lets Claude (or any MCP client) **read, search, compile, render, and edit** Overleaf projects through Overleaf's git bridge — without copy-pasting LaTeX back and forth.

## What it does

| Area | Tools |
|---|---|
| Discover | `list_projects`, `status_summary` (main file, outline, bib, inputs, word count, last commit, pending edits), `list_files` |
| Read selectively | `get_sections` (line-anchored outline, comments ignored), `get_section_content` (by title or line, with subsections), `search` (literal/regex across files), `read_file` (line ranges, numbered) |
| Render | `compile` (latexmk → compact error/warning report), `render_page` (PNG images of pages), `pdf_text` (text of rendered pages) |
| Edit | `edit_file` (exact-match replace), `replace_section`, `write_file`, `pending_changes`, `push_changes`, `discard_changes`, `sync` |
| Check citations | `check_citations` (offline consistency, undefined citations, style drift), `verify_references` (DOIs resolved against Crossref, DataCite and the DOI registry) |

Edits go to a local clone first. Nothing reaches Overleaf until `push_changes`, which commits, rebases onto any newer Overleaf changes, and pushes (the commit appears in the project's history). Real conflicts abort cleanly and are reported.

## Requirements

- Node **20+** (tested on 24)
- `git`
- For `compile` / `render_page` / `pdf_text`: a TeX distribution with `latexmk`, plus poppler (`pdftoppm`, `pdftotext`, `pdfinfo`). `texcount` (TeX Live) enables word counts.

## Setup

```bash
npm install
cp projects.example.json projects.json   # then edit
```

`projects.json`:

```json
{
  "cacheDir": "~/Library/Caches/overleaf-mcp",
  "syncTtlSeconds": 30,
  "projects": {
    "MyPaper": {
      "name": "My Paper",
      "projectId": "24-hex id from https://www.overleaf.com/project/<id>",
      "gitToken": "olp_... (Overleaf → Account Settings → Git Integration)",
      "mainFile": "main.tex",
      "engine": "pdflatex",
      "headings": ["rSection"]
    }
  }
}
```

Per-project fields other than `name`, `projectId`, `gitToken` are optional:

- `mainFile` — root `.tex`; otherwise the first file with a live `\documentclass` is used.
- `engine` — `pdflatex` | `xelatex` | `lualatex`. Omit to let a project `latexmkrc` decide (default pdflatex).
- `headings` — extra heading macros/environments to include in outlines, e.g. `["rSection", "cvsection"]` for CV classes.

- `selfAuthors` - surnames whose unpublished work is never flagged and never sent to any API.
- `citeCommands` - project-specific citation macros, e.g. `["mycite"]`.

Top-level: `cacheDir` (where clones live; default `~/Library/Caches/overleaf-mcp` on macOS, `~/.cache/overleaf-mcp` elsewhere) and `syncTtlSeconds` (reads reuse a clone refreshed within this window).

The optional top-level `verify` block controls the network half of citation checking.
Every field has a working default, so you only need what you want to change:

```json
{
  "verify": {
    "enabled": true,
    "mailto": "you@example.edu",
    "semanticScholarApiKey": "s2k-...",
    "cacheTtlDays": { "record": 30, "search": 7, "negative": 3 },
    "minIntervalMs": { "api.crossref.org": 100, "api.semanticscholar.org": 1100 },
    "timeoutMs": 15000,
    "thresholds": { "accept": 0.85, "consider": 0.6 }
  }
}
```

`mailto` is opt-in only.
It is your own address, sent to Crossref in a `mailto=` parameter to reach their faster pool; it is never inferred from your git account and never appears in tool output.
Secrets can come from the environment instead of the file, via `OVERLEAF_MCP_S2_API_KEY` and `OVERLEAF_MCP_MAILTO`; the config file wins where both are set.
`minIntervalMs` is per host, and the Semantic Scholar floor of 1000ms cannot be lowered, because that key grants one request per second across all endpoints.

The token is passed to git only through the environment and a per-invocation credential helper; it is never written into the clone's remote URL and is scrubbed from error messages.

### Claude Code

```bash
claude mcp add overleaf -- /opt/homebrew/bin/node /path/to/OverleafMCP/overleaf-mcp-server.js
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "overleaf": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/path/to/OverleafMCP/overleaf-mcp-server.js"]
    }
  }
}
```

Use an absolute path to a Node ≥ 20 binary — GUI apps do not see your shell's `nvm` setup. `OVERLEAF_MCP_CONFIG=/other/projects.json` overrides the config location.

## Citation checking

Two tools, separated because one is free and the other is not.

`check_citations` is offline, deterministic and instant, so it is cheap to run constantly.
It reports undefined citations, duplicate or uncited entries, citation commands that do not match the detected bibliography backend, and formatting drift inside the `.bib`.
Consistency is measured against the document's own majority convention rather than an imposed house style, because each paper has its own reference style.
If 55 entries write `year = {2026}` and two write `year = 2026`, the two are reported; if the split is near even, nothing is reported, because that is a choice the author has not made.

`verify_references` uses the network.
It resolves each entry's DOI against Crossref, falls back to DataCite, and goes straight to DataCite for arXiv DOIs (`10.48550/*`), which Crossref does not index at all.
Responses are cached on disk beside the clones, so re-running a 57-entry bibliography typically makes zero requests.

The verdicts matter more than the counts:

| Verdict | Meaning |
|---|---|
| `verified` | The identifier resolves and the record agrees with the entry. |
| `verified-with-mismatch` | The work is real, but a field disagrees with the registry. |
| `invalid-identifier` | Not registered with Crossref, DataCite, or the DOI registry itself. The strongest signal available, and still not proof of fabrication. |
| `unverified` | No source matched. **Not evidence of fabrication.** |
| `retracted` | A retraction notice points at the work. |
| `unverifiable-by-design` | Unpublished or under review. Never checked, and never sent to any API. |

Two limits are worth stating plainly.
Crossref indexes neither arXiv DOIs nor NeurIPS, ICLR or ICML proceedings, so a large share of a machine-learning bibliography cannot be DOI-verified at all.
And a DOI that Crossref returns 404 for may still be entirely real: AAAI, for one, registers its prefix without depositing article metadata, so the DOI registry itself is consulted before any identifier is called invalid.

Neither tool ever writes to a `.bib`.
Corrections are reported for you to apply with `edit_file`.

## Typical agent flow

```
status_summary        → what is this project, where is everything
get_sections          → outline with line numbers
get_section_content   → just the Methods section (subsections included)
search                → every \cite{...} or TODO
edit_file             → exact-match replacement, returns the diff
compile               → errors as file:line, undefined refs, overfull boxes
render_page           → look at page 3 as an image
pending_changes       → review
push_changes          → send to Overleaf
```

## Development

```bash
npm test               # node:test; git tests run against a local bare repo (no network)
npm run test:coverage
```

Layout: `src/latex/*` (pure parsers), `src/git-client.js`, `src/compile.js`, `src/render.js`, `src/edit.js`, `src/tools/*` (MCP tool registration), `src/server.js`.

## Security Notes

- The Overleaf Git token grants full read/write access to your project — treat it like a password.
- Prefer `OVERLEAF_GIT_TOKEN` or `OVERLEAF_GIT_TOKEN_FILE` over writing the token into `projects.json`, especially if that file is backed up or synced.
- `projects.json` is `.gitignore`d in this repo. Never commit real project IDs or Git tokens.
- File paths supplied through MCP tool calls are restricted to the cloned project directory; `..` traversal and absolute paths are rejected.
- Tokens are passed to git through a credential helper in the environment, never on the command line, and are scrubbed from tool output and error messages.

## License

MIT
