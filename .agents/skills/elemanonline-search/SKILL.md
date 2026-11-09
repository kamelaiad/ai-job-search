---
name: elemanonline-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search job listings on
  elemanonline.com.tr (Eleman Online), a Turkish job board, or look up a
  specific Eleman Online posting. Covers jobs in Turkey (İstanbul, Bursa,
  Ankara, İzmir and every other province), mostly blue- and white-collar
  local-employer roles, in Turkish. Trigger phrases: elemanonline, eleman
  online, Turkish job board, jobs in Turkey, find a job in Bursa / İstanbul,
  iş ilanı, iş ilanları, iş ara, iş arıyorum, eleman ilanı, ilan detayı.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/elemanonline-search/cli/src/cli.ts *)
---

# Eleman Online Search Skill

Search live job listings from [elemanonline.com.tr](https://www.elemanonline.com.tr), a
Turkish job board, by keyword, province and posting age, and read a single posting's full
description. No authentication, no API key, and **zero runtime dependencies** — it runs
with just `bun`. Postings are in Turkish.

## ⚠️ Personal use only

`robots.txt` allows all paths, but the site's terms of use (*Site Kullanım Şartları*)
forbid copying, distributing or storing its content without written permission. Use this
for your own job search: **keep volume low, don't use it commercially or for bulk data
collection, and don't republish listings.** Run it on your own responsibility.

## When to use this skill

- Search Eleman Online for openings by keyword and/or Turkish province
- Filter by recency (posted within the last N days)
- Get the full description of a specific Eleman Online posting

## Commands

### Search job listings

```bash
bun run .agents/skills/elemanonline-search/cli/src/cli.ts search [--query "<text>"] [--location "<city>"] [flags]
```

At least one of `--query` / `--location` is required.

- `--query <text>` / `-q <text>` — keywords (title, skill, role), e.g. `"grafik tasarım"`. The site matches title, description **and company name**, so broad words return loosely related jobs.
- `--location <city>` / `-l <city>` — Turkish province: `"İstanbul"`, `"Bursa"`, `"Ankara"`, `"İzmir"`, or a side of İstanbul (`"İstanbul Avrupa"`, `"İstanbul Anadolu"`). Turkish letters are fine. An unknown name exits 1 with `UNKNOWN_LOCATION` (the site itself would silently search nationwide).
- `--jobage <days>` — posted within N days (e.g. `1`, `3`, `7`, `30`). Omit for all postings.
- `--page <n>` — page number (1-indexed, 10 results per page, fixed by the site).
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/elemanonline-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the 24-character hex id from `search` results (e.g. `6ad5d48e4701e9810bc4a09d`). A
full `https://www.elemanonline.com.tr/is-ilani/<slug>/<id>` URL also works. Returns the
description, work type (*çalışma şekli*), work preference (on-site / remote / hybrid),
department, salary if published, gender and age requirements if stated, and the listing
status.

## Usage examples

```bash
# Graphic designer roles in Bursa
bun run .agents/skills/elemanonline-search/cli/src/cli.ts search -q "grafik tasarım" -l "Bursa" --format table

# Web design roles in İstanbul, posted in the last 30 days
bun run .agents/skills/elemanonline-search/cli/src/cli.ts search -q "web tasarım" -l "İstanbul" --jobage 30 --format table

# UI/UX designer roles in Ankara
bun run .agents/skills/elemanonline-search/cli/src/cli.ts search -q "ui ux" -l "Ankara" --format table

# Web developer roles anywhere in Turkey
bun run .agents/skills/elemanonline-search/cli/src/cli.ts search -q "web developer" --format table

# Everything posted in İzmir this week, second page
bun run .agents/skills/elemanonline-search/cli/src/cli.ts search -l "İzmir" --jobage 7 --page 2 --format table

# Full details for a specific posting
bun run .agents/skills/elemanonline-search/cli/src/cli.ts detail 6ad5d48e4701e9810bc4a09d --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON search output: `{ "meta": { "count", "page", "total", "totalPages" }, "results": [...] }`;
each result has `id`, `title`, `company`, `companyUrl`, `location`, `date` (ISO 8601),
`url`, `workType`, `salary` — missing values are `null`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data comes from the public search and posting pages; the CLI reads the page's embedded
  Next.js data (`__NEXT_DATA__`) because the visible result list is rendered client-side.
- Eleman Online is a small board (a Bursa search lists ~20-25 active postings in total), and
  design/developer roles are rare: `"grafik tasarım"` in Bursa often returns 0. Widen to
  nationwide or use a broader word (`"tasarım"`) when a search is empty.
- A province search also includes nationwide postings (location `Türkiye Geneli`).
- `location` lists every town a posting covers, as `Town, Province` joined with `; `.
- Applying requires an Eleman Online candidate account on the site; the CLI only reads.
- No application deadline is published; `status` is the site's raw value (`APPROVE` on live
  postings). Removed postings answer `NOT_FOUND`.
- The CLI retries 429/5xx with exponential backoff. Keep volume low (see the note above).
