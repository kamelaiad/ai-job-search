# isbul-cli

CLI for searching jobs on [isbul.net](https://www.isbul.net) (Turkey).

**Data source**: isbul.net's official public Agent API — `GET /api/agent/jobs` and
`GET /api/agent/jobs/{id}` (spec: `https://www.isbul.net/api/agent/openapi.json`).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** `robots.txt` allows `/api/agent/*`, but the site's terms forbid copying
> or redistributing its content without written permission. Keep volume low, don't use it
> commercially or for bulk data collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/isbul-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings (`--query` and/or `--location` required) |
| `detail` | Fetch full detail for a single listing (id, slug or URL) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "grafik tasarım" -l "İstanbul" --format table
bun run src/cli.ts search -q "web developer" -l "Bursa" --format table
bun run src/cli.ts detail cbdadd0c-82cc-4b2b-838a-47f86948caea --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role), sent as `q`. |
| `--location` | `-l` | Turkish city, e.g. `"İstanbul"`, `"Bursa"`. Unknown cities exit 1. |
| `--jobage` | | Posted within N days — client-side filter (the API has no age parameter). |
| `--page` | | 1-indexed page (25 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun run typecheck
bun run test   # offline parser tests + a 2-request live smoke test
```

See `../SKILL.md` for usage notes and `../url-reference.md` for the API reference.
