# weworkremotely-cli

CLI for searching remote jobs on **[We Work Remotely](https://weworkremotely.com)**, a
worldwide remote-only job board, through its public RSS feeds.

**Data source**: `https://weworkremotely.com/remote-jobs.rss` and
`https://weworkremotely.com/categories/<slug>.rss` (search and detail).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** robots.txt allows the feeds, but the site's HTML pages (including
> its Terms of Service) are behind a Cloudflare challenge, so the terms could not be
> checked. Keep volume low; no commercial use, bulk collection or republishing.

## Installation

```bash
cd .agents/skills/weworkremotely-search/cli
bun install   # optional - only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Read the all-jobs feed (or `--category` feeds) and filter client-side |
| `detail` | Full detail for one job (`<slug|url>`), read from its RSS item |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "web designer" --format table
bun run src/cli.ts search -c design -q designer --title-only -l "worldwide,europe" --format table
bun run src/cli.ts search -c front-end,full-stack -q "web developer" --jobage 14 --format table
bun run src/cli.ts detail thatch-brand-designer -c design --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords; every word must start a word in title/company/skills/category/description. |
| `--title-only` | | Match `--query` against the title only. |
| `--category` | `-c` | Comma list: `design`, `full-stack`, `front-end`, `back-end`, `programming`, `devops`, `product`, `customer-support`, `sales-marketing`, `management-finance`, `other`. |
| `--location` | `-l` | Comma-separated words matched against region/country/state, OR'd. `worldwide` matches "Anywhere in the World". |
| `--jobage` | | Posted within N days (`pubDate`). |
| `--page` | | 1-indexed page over the filtered results. |
| `--limit` | `-n` | Results per page, default 20. |
| `--format` | | `json` \| `table` \| `plain`. |

See `../SKILL.md` for semantics and `../url-reference.md` for the feed notes.

## Tests

```bash
bun run typecheck
bun run test   # offline parsing/contract tests + one live search against weworkremotely.com
```
