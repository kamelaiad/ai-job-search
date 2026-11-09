# elemannet-cli

CLI for searching jobs on [eleman.net](https://www.eleman.net), a large Turkish job board.

**Data source**: eleman.net's path-based listing pages (`/is-ilanlari/<city>/<position>`, with `?sy=` pagination and `?gun=` age filter) and posting pages (`/is-ilani/<slug>-i<id>`).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** eleman.net's robots.txt disallows its legacy search script and several
> query parameters. This CLI reads only robots-permitted pages (and refuses disallowed URLs before
> fetching). Keep volume low, don't use it commercially or for bulk data collection, and run it on
> your own responsibility.

## Installation

```bash
cd .agents/skills/elemannet-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search listings (`--query` and/or `--location` required) |
| `detail` | Fetch full detail for one posting (number, slug or URL) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "grafik tasarım uzmanı" --format table
bun run src/cli.ts search -q "grafik" -l "İstanbul" --jobage 7 --format table
bun run src/cli.ts search -l "Bursa" --page 2 --limit 10
bun run src/cli.ts detail 4802848 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | eleman.net position or category name (not free text). |
| `--location` | `-l` | Turkish province or district, e.g. `"İstanbul"`, `"Bursa"`, `"Nilüfer"`. |
| `--jobage` | | Posted within N days; rounds up to 1/4/7/15/30, above 30 = all. |
| `--page` | | 1-indexed page (~30 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Error codes

| Code | Meaning |
|------|---------|
| `NO_QUERY` | neither `--query` nor `--location` given |
| `BAD_ARG` / `UNKNOWN_FLAG` | invalid or unknown flag |
| `QUERY_NOT_RECOGNIZED` / `LOCATION_NOT_RECOGNIZED` | eleman.net has no listing page for that name (it fell back to a generic listing) |
| `ROBOTS_DISALLOWED` | the URL is disallowed by robots.txt |
| `BAD_ID` / `NO_ID` / `NOT_FOUND` | `detail` input problems or a removed posting |
| `PARSE_FAILED` | page markup changed (see `../url-reference.md`) |
| `SEARCH_FAILED` / `DETAIL_FAILED` | network or HTTP failure after retries |

## Tests

```bash
bun run typecheck
bun run test   # offline parser tests + one live search request
```

See `../SKILL.md` for usage notes and `../url-reference.md` for the parsing anchors.
