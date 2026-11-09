# kariyer-cli

CLI for searching jobs on [kariyer.net](https://www.kariyer.net), Türkiye's largest job board.

**Data source**: kariyer.net's public server-rendered pages: `/is-ilanlari` (search) and `/is-ilani/<slug>-<id>` (posting).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** robots.txt permits the two paths used, but the site's terms load
> only in a browser and could not be checked. Keep volume low, don't use it commercially or
> for bulk data collection, and run it on your own responsibility. If the site's bot
> protection answers, the CLI exits with `BLOCKED` and does not try to get past it.

## Installation

```bash
cd .agents/skills/kariyer-search/cli
bun install   # optional, only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings (`--query` and/or `--location` required) |
| `detail` | Fetch full detail for a single posting |

`search` accepts `--format json|table|plain` (default `json`). `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "web developer" -l "Bursa" --format table
bun run src/cli.ts search -q "frontend developer" -l "İstanbul" --jobage 7 --format table
bun run src/cli.ts search -q "UI/UX designer" --remote remote --format table
bun run src/cli.ts detail 4520391 --format plain
```

See `../SKILL.md` for the full flag reference and portal quirks, and `../url-reference.md`
for the parsing anchors to update when the markup changes.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / company). |
| `--location` | `-l` | Turkish province (`"Bursa"`, `"İstanbul"`, `"İstanbul Anadolu"`, `"Ankara,İzmir"`). |
| `--jobage` | | Posted within N days (site windows 1/3/7/15 days, cut to exactly N client-side). |
| `--remote` | | `remote` \| `hybrid` \| `onsite`. |
| `--page` | | 1-indexed page (50 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun run typecheck
bun run test                       # includes ONE live search against kariyer.net
KARIYER_SKIP_LIVE=1 bun run test   # offline only
```

Everything except `tests/live.test.ts` runs offline on synthetic markup (`tests/fixtures.ts`)
with `fetch` stubbed.
