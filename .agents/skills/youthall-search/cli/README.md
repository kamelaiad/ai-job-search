# youthall-cli

CLI for searching internships, graduate programs and early-career jobs on
[Youthall](https://www.youthall.com) (Türkiye).

**Data source**: Youthall's public HTML pages (`/tr/is-ilanlari/` and posting pages).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional and only pulls dev type defs.

> **Personal use, low volume.** robots.txt allows these pages, but the user agreement
> forbids disproportionate load and the listings are third-party content. Keep volume
> low and don't republish or bulk-collect them.

## Installation

```bash
cd .agents/skills/youthall-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search listings (keyword, city, listing type) |
| `detail` | Fetch one posting's full detail |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "tasarım" --format table
bun run src/cli.ts search -q "yazılım" -l "İstanbul" --type internship --format table
bun run src/cli.ts search -l "Ankara" --type new_graduated --format table
bun run src/cli.ts detail "AcmeTR/ui-ux-tasarim-stajyeri_12" --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords, Turkish or English. Optional. |
| `--location` | `-l` | Turkish city (`İstanbul`, `Ankara`, `İzmir`, `Bursa`...). |
| `--type` | `-t` | Comma-separated: `internship`, `mt_internship`, `new_graduated`, `young_professional`, `professional`, `full_time`, `part_time`, `contract`, `periodic`, `project_based`, `freelance`, `volunteer`, `scholarship`. |
| `--page` | | 1-indexed page (18 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

`--jobage` is not supported (cards show only the deadline; no posting-age filter) and
exits 1 with `UNSUPPORTED_FLAG`. See `../SKILL.md` and `../url-reference.md`.

## Tests

```bash
bun run typecheck
bun run test   # offline parser tests + a few live requests to youthall.com
```
