# careerjet-cli

CLI for searching **Careerjet Türkiye** (careerjet.com.tr) job listings: an aggregator of
postings from many Turkish job sites.

**Data source**: Careerjet's official v4 search API (`https://search.api.careerjet.net/v4/query`, locale `tr_TR`).
**Authentication**: a free Careerjet publisher API key in the `CAREERJET_API_TOKEN` environment variable (never a flag).
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** The API is meant for publishers. Keep volume low, don't use it
> commercially or for bulk collection, and never fetch result URLs automatically (they are
> per-click tracking links). See `../SKILL.md`.

## Installation

```bash
cd .agents/skills/careerjet-search/cli
bun install   # optional: only installs TypeScript dev types
export CAREERJET_API_TOKEN="<your publisher API key>"   # see ../SKILL.md → Setup
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job listings (needs `CAREERJET_API_TOKEN`) |
| `detail` | Show the cached excerpt + outbound URL for a result from a recent `search` (no network request) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "web developer" -l "Bursa" --format table
bun run src/cli.ts search -q "yazılım geliştirici" -l "İstanbul" --jobage 7 --format table
bun run src/cli.ts search -q "UI/UX designer" -l "Ankara" --contract internship
bun run src/cli.ts detail cj-0123456789abcdef --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). |
| `--location` | `-l` | City or region in Türkiye; omit for country-wide. |
| `--jobage` | | Posted within N days (client-side filter; implies `--sort date`). |
| `--contract` | | `permanent` \| `contract` \| `temporary` \| `internship` \| `volunteer`. |
| `--hours` | | `full` \| `part`. |
| `--sort` | | `relevance` \| `date` \| `salary`. |
| `--page` | | 1-10 (20 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `CAREERJET_API_TOKEN` | yes (for `search`) | Publisher API key (Basic auth username). |
| `CAREERJET_USER_IP` | no | Your public IP for the API's required `user_ip` (default `127.0.0.1`). |
| `CAREERJET_REFERER` | no | Publisher page URL registered with the key, sent as `Referer`. |
| `CAREERJET_CACHE_FILE` | no | Where `search` stores results for `detail` (default `$TMPDIR/careerjet-search-cache.json`). |

## Tests

```bash
bun run typecheck
bun run test   # offline tests always run; the live smoke test runs only when CAREERJET_API_TOKEN is set
```
