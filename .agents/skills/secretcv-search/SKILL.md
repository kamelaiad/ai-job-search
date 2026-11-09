---
name: secretcv-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Turkey on
  secretcv.com, or look up a specific secretcv job posting. Covers white-collar
  and retail roles across Turkish cities (İstanbul, Ankara, İzmir, Bursa, ...):
  design, web, marketing, sales, IT, operations and more. Trigger phrases:
  secretcv, secret cv, jobs in Turkey, Turkish job board, find a job in
  Istanbul/Bursa, web designer jobs Turkey; Turkish: iş ilanı, iş ilanları,
  iş ara, iş arıyorum, eleman ilanı, secretcv ilanları, açık pozisyon,
  web tasarımcı ilanı, grafik tasarımcı iş ilanı.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/secretcv-search/cli/src/cli.ts *)
---

# secretcv Search Skill

Search live job listings on [secretcv.com](https://www.secretcv.com), a general Turkish job
board. No authentication, no API key, and **zero runtime dependencies** — it runs with just
`bun`. Postings are in Turkish.

## ⚠️ Personal use only

secretcv's `robots.txt` disallows its search form and the query-string URLs behind it
(`/is-ilanlari/ara`, `?k=`, `?sf=` pagination, `?wtime=`, `?parameters=`, ...). This skill reads
**only** the path-based listing pages the site publishes in its own sitemaps
(`/is-ilanlari/<keyword>-is-ilanlari`, `/is-ilanlari/<city>-is-ilanlari`,
`/is-ilanlari/<city>/<position>-is-ilanlari`) and the public posting pages — and it refuses,
before any request, every URL that matches a `robots.txt` Disallow rule. Because pagination is
disallowed, **each search returns page 1 only (up to 20 postings)**. Keep volume low, don't use
it commercially or for bulk data collection, and run it on your own responsibility.

## When to use this skill

- Search for open positions in Turkey by keyword/role and/or province
- Keep only recent postings (posted within N days)
- Get the full description of a specific secretcv posting

## Commands

### Search job listings

```bash
bun run .agents/skills/secretcv-search/cli/src/cli.ts search -q "<keyword>" [-l "<city>"] [flags]
```

Key flags (at least one of `--query` / `--location` is required):
- `--query <text>` / `-q <text>` — keyword or job title, e.g. `"web tasarım"`, `"grafik tasarım"`, `"ui ux designer"`.
- `--location <text>` / `-l <text>` — Turkish province, e.g. `"İstanbul"`, `"Ankara"`, `"İzmir"`, `"Bursa"`. `"İstanbul Avrupa"` / `"İstanbul Anadolu"` select one side of İstanbul.
- `--jobage <days>` — keep postings at most N days old. **Client-side**: computed from each card's relative date ("6 gün önce"; months count as 30 days). Cards without a readable date are dropped.
- `--page <n>` — only `1` is accepted (pagination is robots-disallowed; `--page 2` exits 1 with `PAGE_NOT_ALLOWED`).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/secretcv-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the `id` field from `search` results — the posting's URL path,
e.g. `acme-ltd/web-tasarimci-is-ilanlari-1880001`. A full `https://www.secretcv.com/...` posting URL
works too. A bare posting number (`jobId`) **cannot** be resolved: secretcv's posting URLs need the
company slug, and its by-number lookup (`?ilanId=`) is robots-disallowed. Returns the full
description, posting date, application deadline, employment type, sector, education level,
openings and districts.

## Usage examples

```bash
# Web design roles anywhere in Turkey
bun run .agents/skills/secretcv-search/cli/src/cli.ts search -q "web tasarım" --format table

# Graphic design roles in İstanbul, posted in the last 14 days
bun run .agents/skills/secretcv-search/cli/src/cli.ts search -q "grafik tasarım" -l "İstanbul" --jobage 14 --format table

# UI/UX designer roles in Ankara
bun run .agents/skills/secretcv-search/cli/src/cli.ts search -q "ui ux designer" -l "Ankara" --format table

# Everything new in Bursa today
bun run .agents/skills/secretcv-search/cli/src/cli.ts search -l "Bursa" --jobage 1 --format table

# Web developer roles in İzmir, top 5 as JSON
bun run .agents/skills/secretcv-search/cli/src/cli.ts search -q "web developer" -l "İzmir" --limit 5

# Full details for a specific posting (id from search results)
bun run .agents/skills/secretcv-search/cli/src/cli.ts detail acme-ltd/web-tasarimci-is-ilanlari-1880001 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing `id` to `detail` |
| `table` | Quick human-readable scanning (the `id` column is the detail key) |
| `plain` | Reading a single posting's full detail (`detail` command) |

Search JSON: `{ "meta": { "count", "page", "lastPage", "source", "locationFilter" }, "results": [...] }`.
Each result has `id`, `jobId`, `title`, `company`, `location`, `date` (approximate ISO date),
`dateText` (the card's own relative date), `ageDays` and `url`; missing values are `null`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **How the keyword is matched.** The query becomes a URL slug (`"web tasarım"` → `web-tasarim`).
  secretcv reads a slug that equals one of its position names (e.g. `grafik-tasarimci`) as a
  **strict position filter** (few results), and any other slug as a **keyword search** (many
  results). For broad coverage prefer a stem like `"grafik tasarım"` over `"grafik tasarımcı"`.
- **Keyword + city.** When secretcv knows the keyword as a position, the city filter is applied by
  the portal (`meta.locationFilter: "portal"`). Otherwise secretcv would silently drop the keyword
  and list every job in the city, so the CLI instead fetches the keyword page and keeps only cards
  whose location mentions the city (`meta.locationFilter: "client-side"`) — that is page 1 of the
  nationwide keyword results, so counts can be small.
- The CLI verifies which filters secretcv actually applied (from the page's hidden
  `searchParameters` input) and exits `1` with `QUERY_NOT_RECOGNIZED` / `LOCATION_NOT_RECOGNIZED`
  rather than presenting an unfiltered page as matches.
- Keywords whose slug starts with `ara` (e.g. "araştırma", "araç") hit the `Disallow: /is-ilanlari/ara`
  prefix rule and exit `1` with `ROBOTS_DISALLOWED`; rephrase them (e.g. "Ar-Ge uzmanı").
- `meta.lastPage` reports how many pages the portal has; only page 1 is fetched.
- Posting pages carry `noindex` for search engines; that does not restrict fetching, and the paths
  are allowed by `robots.txt`.
- The CLI retries 429/5xx with exponential backoff. Keep volume low (see the warning above).
