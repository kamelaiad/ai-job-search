# toptalent-cli

CLI for searching internships, new-graduate programs and junior jobs on
[toptalent.co](https://toptalent.co) (Türkiye).

**Data source**: the site's own listing request (`POST /Job/SearchJob`, HTML fragment) and public posting pages.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** toptalent's terms forbid copying, reproducing, distributing or
> commercially using site content without permission. Keep volume low and use it for
> your own job search only.

## Installation

```bash
cd .agents/skills/toptalent-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search listings (keyword, city, who-can-apply level) |
| `detail` | Fetch one posting's full detail |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "grafik tasarım" --format table
bun run src/cli.ts search -q "yazılım" -l "İstanbul" --format table
bun run src/cli.ts search --level new-grad -l "Ankara,İzmir" --format table
bun run src/cli.ts detail acme-ui-ux-designer-121900 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords. Optional. |
| `--location` | `-l` | Comma-separated Turkish provinces; `İstanbul` = Avrupa + Anadolu. Excludes nationwide postings. |
| `--level` | | Comma-separated: `prep`, `1st-year`…`4th-year`, `masters-student`, `phd-student`, `new-grad`, `exp-0-1`, `exp-1-3`, `exp-3-5`, `exp-5-10`, `exp-10-plus`. |
| `--page` | | 1-indexed page (9 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

`--jobage` is not supported (cards carry no posting date; no posting-age filter) and
exits 1 with `UNSUPPORTED_FLAG`. See `../SKILL.md` and `../url-reference.md`.

## Tests

```bash
bun run typecheck
bun run test   # offline parser tests + a few live requests to toptalent.co
```
