# elemanonline-cli

CLI for searching jobs on [elemanonline.com.tr](https://www.elemanonline.com.tr) (Turkey).

**Data source**: public search pages (`/is-ilanlari[/<province>]?term=…`) and posting pages
(`/is-ilani/<slug>/<id>`), read from the embedded Next.js `__NEXT_DATA__` JSON.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** `robots.txt` allows all paths, but the site's terms forbid copying or
> redistributing its content without written permission. Keep volume low, don't use it
> commercially or for bulk data collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/elemanonline-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings (`--query` and/or `--location` required) |
| `detail` | Fetch full detail for a single posting |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "grafik tasarım" -l "Bursa" --format table
bun run src/cli.ts search -q "web tasarım" -l "İstanbul" --jobage 30 --format table
bun run src/cli.ts detail 6ad5d48e4701e9810bc4a09d --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). |
| `--location` | `-l` | Turkish province, e.g. `"İstanbul"`, `"Bursa"`, `"İstanbul Avrupa"`. Unknown names exit 1. |
| `--jobage` | | Posted within N days (`publishDate`). |
| `--page` | | 1-indexed page (10 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun run typecheck
bun run test   # offline parser tests + a 2-request live smoke test
```

See `../SKILL.md` for usage notes and `../url-reference.md` for the parsing anchors.
