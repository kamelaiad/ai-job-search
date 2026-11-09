---
name: isbul-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search job listings on isbul.net
  (İşbul), a Turkish job board, or look up a specific isbul.net posting. Covers
  jobs in Turkey (İstanbul, Bursa, Ankara, İzmir, Antalya, Kocaeli and other
  cities), in Turkish, through isbul.net's official public Agent API. Trigger
  phrases: isbul, isbul.net, iş bul, Turkish job board, jobs in Turkey, find a
  job in İstanbul / Bursa, iş ilanı, iş ilanları, iş ara, iş arıyorum, ilan
  detayı, açık pozisyon.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/isbul-search/cli/src/cli.ts *)
---

# isbul.net Search Skill

Search live job listings on [isbul.net](https://www.isbul.net), a Turkish job board, by
keyword and city, and read a single posting's full description. It uses isbul.net's
**official, documented Agent API** (`/api/agent`), which the site publishes for AI agents:
no authentication, no API key, and **zero runtime dependencies** — it runs with just `bun`.
Postings are in Turkish.

## ⚠️ Personal use only

`robots.txt` explicitly allows `/api/agent/*`, and the API's fair-use notes ask agents to keep
page sizes ≤ 25 and avoid parallel bulk scraping. The site's terms of use forbid copying or
redistributing its content without written permission. Use this for your own job search:
**keep volume low, don't use it commercially or for bulk data collection, and don't
republish listings.** Run it on your own responsibility.

## When to use this skill

- Search isbul.net for openings by keyword and/or Turkish city
- Filter by recency (posted within the last N days, applied to the fetched page)
- Get the full description, status and deadline of a specific isbul.net posting

## Commands

### Search job listings

```bash
bun run .agents/skills/isbul-search/cli/src/cli.ts search [--query "<text>"] [--location "<city>"] [flags]
```

At least one of `--query` / `--location` is required.

- `--query <text>` / `-q <text>` — keywords (title, skill, role), Turkish or English, e.g. `"grafik tasarım"`. Full-text: matches title, description and company name.
- `--location <city>` / `-l <city>` — Turkish city: `"İstanbul"`, `"Bursa"`, `"Ankara"`, `"İzmir"`, `"Antalya"`, `"Kocaeli"`… Turkish letters are fine. An unknown city exits 1 with `UNKNOWN_LOCATION`.
- `--jobage <days>` — posted within N days. **The API has no age parameter**, so this filters the fetched page client-side: it can return fewer than 25 results per page, and `meta.total` stays the API's unfiltered total.
- `--page <n>` — page number (1-indexed, 25 results per page — the API maximum).
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/isbul-search/cli/src/cli.ts detail <id|slug|url> [--format json|plain]
```

`id` is the UUID from `search` results (e.g. `cbdadd0c-82cc-4b2b-838a-47f86948caea`); the
listing `slug` or a full `https://www.isbul.net/is-ilani/<slug>` URL also work. Returns the
description, work type, position, sector, experience and education level, vacancy count,
salary if published, deadline (`expiresAt`) and whether the listing is open (`isOpen`).

## Usage examples

```bash
# Graphic designer roles in İstanbul
bun run .agents/skills/isbul-search/cli/src/cli.ts search -q "grafik tasarım" -l "İstanbul" --format table

# Web developer roles in Bursa
bun run .agents/skills/isbul-search/cli/src/cli.ts search -q "web developer" -l "Bursa" --format table

# UI/UX designer roles anywhere in Turkey
bun run .agents/skills/isbul-search/cli/src/cli.ts search -q "ui ux designer" --format table

# Design roles in İzmir posted in the last 14 days
bun run .agents/skills/isbul-search/cli/src/cli.ts search -q "tasarım" -l "İzmir" --jobage 14 --format table

# Web designer roles in Ankara, second page
bun run .agents/skills/isbul-search/cli/src/cli.ts search -q "web tasarımcı" -l "Ankara" --page 2 --format table

# Full details for a specific posting
bun run .agents/skills/isbul-search/cli/src/cli.ts detail cbdadd0c-82cc-4b2b-838a-47f86948caea --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON search output: `{ "meta": { "count", "page", "total", "lastPage" }, "results": [...] }`;
each result has `id`, `title`, `company`, `location`, `date` (ISO 8601), `url`, `slug`,
`workType`, `position`, `sector`, `salary`, `expiresAt` — missing values are `null`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data comes from `GET /api/agent/jobs` and `GET /api/agent/jobs/{id}` (spec:
  `https://www.isbul.net/api/agent/openapi.json`). Nothing else on the site is touched; the
  website's own `?query=` search is disallowed by `robots.txt` and is never used.
- Results are ordered by relevance, not date.
- The board is mid-sized and design/developer roles are sparse: `"web developer"` in Bursa
  often returns 0. Try a broader Turkish word (`"tasarım"`, `"yazılım"`) or drop the city.
- Remote or nationwide postings carry no city, so `location` is `null` for them; they still
  appear in city searches.
- The detail description arrives as one plain-text paragraph (the API flattens line breaks).
- `detail` also returns closed listings: check `isOpen` (true only when `status` is
  `published`) — a future `expiresAt` alone does not mean the listing is open.
- Applying happens on the isbul.net website (candidate account); the CLI only reads.
- The CLI retries 429/5xx with exponential backoff. Keep volume low (see the note above).
