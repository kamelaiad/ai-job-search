# techcareer-cli

CLI for searching tech jobs on [Techcareer.net](https://www.techcareer.net/jobs), the
Türkiye tech-career platform launched by Kariyer.net.

**Data source**: the `__NEXT_DATA__` JSON payload of the public, server-rendered `/jobs`
and `/jobs/detail/<slug>` pages.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex/JSON parsing). `bun install` is
optional and only pulls dev type definitions.

> Keep volume low: this is for your own job search, not bulk collection.

## Installation

```bash
cd .agents/skills/techcareer-search/cli
bun install   # optional, only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings by keyword and/or city |
| `detail` | Fetch full detail for a single posting (by slug or URL) |

`search` accepts `--format json|table|plain` (default `json`). `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "frontend" --format table
bun run src/cli.ts search -q "web" -l "İstanbul" --format table
bun run src/cli.ts search -q "tasarım" -l "İzmir" --limit 5
bun run src/cli.ts detail back-end-developer-4491449 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords. Short Turkish terms match best. Omit to list the whole board, newest first. |
| `--location` | `-l` | City, e.g. `"İstanbul"`, `"Ankara"`, `"İzmir"`, `"Bursa"`. |
| `--page` | | 1-indexed page (20 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

`--jobage` is **not supported**: the portal has no date filter and search results carry
no date. The flag exits 1 with `UNSUPPORTED_FLAG`. `detail` returns `date` and `deadline`.

## Tests

```bash
bun run test        # offline parsing/contract tests plus one live smoke test (2 requests)
SKIP_LIVE_TESTS=1 bun run test   # offline only
bun run typecheck
```

See `../SKILL.md` for the full reference and `../url-reference.md` for the parsing anchors.
