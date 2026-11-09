# dribbble-cli

CLI for searching design jobs (product, UI/UX, web, graphic/brand, motion, illustration) on
Dribbble's public job board, worldwide and remote.

**Data source**: `https://dribbble.com/jobs` (search) and `https://dribbble.com/jobs/<id>` (detail), server-rendered HTML.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Dribbble's Terms of Service prohibit scraping and automated access
> faster than a person browsing. Keep volume low (one request per call), don't use it
> commercially or for bulk data collection, and run it on your own responsibility.
> `robots.txt` disallows `/jobs/*/apply_now`; the CLI prints apply links but never fetches them.

## Installation

```bash
cd .agents/skills/dribbble-search/cli
bun install   # optional, only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search the job board (all flags optional) |
| `detail` | Fetch full detail for a single job (`<id>`, `<id>-<slug>` or a dribbble.com job URL) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Product designer roles, remote-friendly
bun run src/cli.ts search -q "product designer" --remote --format table

# UI or UX roles posted in the last 14 days
bun run src/cli.ts search --specialty ui,ux --jobage 14 --format table

# Freelance brand/graphic work
bun run src/cli.ts search --specialty brand --type freelance --format table

# Full detail for one job
bun run src/cli.ts detail 311562 --format plain
```

See `../SKILL.md` for the full flag reference and portal quirks, and `../url-reference.md`
for the parameters and HTML anchors the parser relies on.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keyword phrase, matched literally against the whole posting. |
| `--location` | `-l` | Location filter, e.g. `"London"`, `"Istanbul"`. |
| `--remote` | | Switch: remote-only and remote-friendly postings (overrides `--location`). |
| `--specialty` | `-s` | Comma-separated: `ui`, `ux`, `product`, `web`, `brand`, `mobile`, `animation`, `illustration`, `leadership`. |
| `--type` | | `fulltime` \| `freelance`. |
| `--jobage` | | Posted within N days (client-side filter). |
| `--page` | | 1-indexed page (the whole board currently fits on page 1). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun run typecheck
bun run test   # offline parser/contract tests + a 2-request live smoke test
```

Test fixtures are synthetic (invented companies and text) that mirror the live markup recorded
in `../url-reference.md`.
