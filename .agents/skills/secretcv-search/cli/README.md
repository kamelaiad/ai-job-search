# secretcv-cli

CLI for searching jobs on [secretcv.com](https://www.secretcv.com), a general Turkish job board.

**Data source**: secretcv's path-based listing pages (`/is-ilanlari/<slug>-is-ilanlari`, `/is-ilanlari/<city>/<position>-is-ilanlari`) and public posting pages.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** secretcv's robots.txt disallows its search form, query-string filters and
> pagination. This CLI reads only robots-permitted pages (and refuses disallowed URLs before
> fetching), one results page per search. Keep volume low, don't use it commercially or for bulk
> data collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/secretcv-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search listings (`--query` and/or `--location` required) |
| `detail` | Fetch full detail for one posting (`id` or URL from `search`) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "web tasarım" --format table
bun run src/cli.ts search -q "grafik tasarım" -l "İstanbul" --jobage 14 --format table
bun run src/cli.ts search -l "Bursa" --jobage 1 --limit 10
bun run src/cli.ts detail acme-ltd/web-tasarimci-is-ilanlari-1880001 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keyword or job title (Turkish or English). |
| `--location` | `-l` | Turkish province, e.g. `"İstanbul"`, `"Bursa"`, `"İstanbul Avrupa"`. |
| `--jobage` | | Keep postings at most N days old (client-side, from relative card dates). |
| `--page` | | Only `1` (pagination is robots-disallowed). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Error codes

| Code | Meaning |
|------|---------|
| `NO_QUERY` | neither `--query` nor `--location` given |
| `BAD_ARG` / `UNKNOWN_FLAG` | invalid or unknown flag |
| `PAGE_NOT_ALLOWED` | `--page` above 1 |
| `QUERY_NOT_RECOGNIZED` / `LOCATION_NOT_RECOGNIZED` | secretcv did not apply the keyword / city |
| `ROBOTS_DISALLOWED` | the URL the query maps to is disallowed by robots.txt |
| `BAD_ID` / `NO_ID` / `NOT_FOUND` | `detail` input problems or a removed posting |
| `PARSE_FAILED` | page markup changed (see `../url-reference.md`) |
| `SEARCH_FAILED` / `DETAIL_FAILED` | network or HTTP failure after retries |

## Tests

```bash
bun run typecheck
bun run test   # offline parser tests + one live search request
```

See `../SKILL.md` for usage notes and `../url-reference.md` for the parsing anchors.
