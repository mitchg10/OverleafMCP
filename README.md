# Overleaf MCP Server

An MCP server that lets Claude (or any MCP client) **read, search, compile, render, and edit** Overleaf projects through Overleaf's git bridge — without copy-pasting LaTeX back and forth.

## What it does

| Area | Tools |
|---|---|
| Discover | `list_projects`, `status_summary` (main file, outline, bib, inputs, word count, last commit, pending edits), `list_files` |
| Read selectively | `get_sections` (line-anchored outline, comments ignored), `get_section_content` (by title or line, with subsections), `search` (literal/regex across files), `read_file` (line ranges, numbered) |
| Render | `compile` (latexmk → compact error/warning report), `render_page` (PNG images of pages), `pdf_text` (text of rendered pages) |
| Edit | `edit_file` (exact-match replace), `replace_section`, `write_file`, `pending_changes`, `push_changes`, `discard_changes`, `sync` |

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

Top-level: `cacheDir` (where clones live; default `~/Library/Caches/overleaf-mcp` on macOS, `~/.cache/overleaf-mcp` elsewhere) and `syncTtlSeconds` (reads reuse a clone refreshed within this window).

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

## License

MIT
