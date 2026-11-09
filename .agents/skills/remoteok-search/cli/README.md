# remoteok-cli

CLI for searching remote jobs on **[Remote OK](https://remoteok.com)**, a worldwide
remote-only job board, through its public JSON API.

**Data source**: `https://remoteok.com/api` (search, and detail for jobs still in the feed);
`https://remoteok.com/remote-jobs/<id>` (detail fallback, JSON-LD + description block).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex). `bun install` is optional and only pulls dev type defs.

> **Attribution required.** Remote OK's API terms: link back to the job's URL on Remote OK
> and mention Remote OK as the source, or API access is suspended. Every result's `url`
> stays on remoteok.com and every output names Remote OK. robots.txt asks for a 1-second
> crawl delay (enforced across invocations) and says `ai-train=no`. Keep volume low.

## Installation

```bash
cd .agents/skills/remoteok-search/cli
bun install   # optional - only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search the latest remote jobs (optionally one tag), filtered client-side |
| `detail` | Fetch full detail for one job (`<id|slug|url>`) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "web developer" --format table
bun run src/cli.ts search --tag design -q designer --title-only -l "worldwide,europe,emea" --format table
bun run src/cli.ts search --tag "web dev" --jobage 14 --format table
bun run src/cli.ts detail 1137597 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords; every word must start a word in title/company/tags/description (client-side). |
| `--title-only` | | Match `--query` against the title only. |
| `--tag` | `-t` | Remote OK tag sent to the API (`design`, `web dev`, `front end`, ...). |
| `--location` | `-l` | Comma-separated location words, OR'd (client-side). `worldwide` also matches jobs without a location. |
| `--jobage` | | Posted within N days (client-side). |
| `--page` | | 1-indexed page over the filtered results. |
| `--limit` | `-n` | Results per page, default 20. |
| `--format` | | `json` \| `table` \| `plain`. |

See `../SKILL.md` for semantics and `../url-reference.md` for the endpoint notes.

## Tests

```bash
bun run typecheck
bun run test   # offline parsing/contract tests + one live search against remoteok.com
```
