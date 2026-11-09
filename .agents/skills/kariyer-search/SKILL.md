---
name: kariyer-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Türkiye (Turkey),
  find Turkish job listings, or look up a specific kariyer.net posting, even if
  they do not name kariyer.net. kariyer.net is Türkiye's largest job board, with
  postings mostly in Turkish. Invoke it for open positions, vacancies and hiring
  in Turkish cities (İstanbul, Ankara, İzmir, Bursa and all 81 provinces) or
  remote/hybrid roles at Turkish employers, in any sector (software, web, design,
  marketing, finance, operations). Trigger phrases: Türkiye jobs, jobs in Turkey,
  Turkish job search, jobs in Istanbul, jobs in Ankara, jobs in Izmir, jobs in
  Bursa, kariyer.net, kariyer.net ilanları, iş ilanı, iş ilanları, iş ara, iş
  arama, iş bul, açık pozisyonlar, eleman ilanı, uzaktan iş, remote iş, hibrit iş,
  İstanbul iş ilanları, Bursa iş ilanları, web developer iş ilanı, frontend
  developer ilanı, UI/UX tasarımcı ilanı, grafik tasarımcı iş ilanı.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/kariyer-search/cli/src/cli.ts *)
---

# Kariyer.net Search Skill

Search live job listings on [kariyer.net](https://www.kariyer.net), Türkiye's largest job
board. Postings are mostly in Turkish. No authentication, no API key and **zero runtime
dependencies**: it runs with just `bun`, reading the site's public search page
(`/is-ilanlari`) and posting pages (`/is-ilani/...`).

## ⚠️ Personal use only

robots.txt allows the two paths this skill reads (`/is-ilanlari` and `/is-ilani/`), and the
CLI never touches the disallowed ones (`/servisler/`, `/Services/`, `/filtre`, `?ckw`,
`?copilot`, account and CV paths). kariyer.net's terms of use (Genel Koşullar, Hizmet
Sözleşmesi) load only in a browser, so they could not be checked, and job boards' terms
usually restrict automated collection. **Keep volume low: a handful of searches, not a
crawl. Don't use it commercially or for bulk data collection.** The site runs bot
protection. If it answers with a challenge, the CLI stops with `BLOCKED` and never tries to
get past it. Run it on your own responsibility.

## When to use this skill

- Search for job openings in Türkiye by keyword, Turkish city, or both
- Filter by posting age (today / 3 / 7 / 15 days, cut to exactly N days) or work model (remote / hybrid / on-site)
- Get the full description, deadline and candidate criteria of a specific posting

## Commands

### Search job listings

```bash
bun run .agents/skills/kariyer-search/cli/src/cli.ts search --query "<text>" [flags]
```

Key flags (pass at least one of `--query` / `--location`):
- `--query <text>` / `-q <text>`: keyword search (job title, skill, company). Turkish or English titles both work (`"web developer"`, `"grafik tasarımcı"`).
- `--location <city>` / `-l <city>`: a Turkish province name: `"Bursa"`, `"İstanbul"` (both sides), `"İstanbul Avrupa"`, `"İstanbul Anadolu"`, `"Ankara"`, `"İzmir"`. Diacritics are optional (`"Istanbul"`, `"Izmir"`). Comma-separate several (`"Bursa,Kocaeli"`). An unknown name exits with `BAD_ARG` rather than searching all of Türkiye. Cities abroad are not supported.
- `--jobage <days>`: posted within N days. The site only filters in fixed windows (today, 3, 7, 15 days), so the CLI asks for the smallest window that covers N and then drops cards older than N. Above 15 days only that client-side cut applies.
- `--remote <mode>`: `remote`, `hybrid`, or `onsite` (the site's work-model filter).
- `--page <n>`: page number (1-indexed, 50 results per page). `meta.hasMore` tells you whether a next page exists.
- `--limit <n>` / `-n <n>`: cap total results emitted (client-side).
- `--format json|table|plain`: default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/kariyer-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `4520391`). You may also pass a full
`https://www.kariyer.net/is-ilani/...` URL or its slug. URLs on other hosts are rejected.
Returns the full description, publish date and application deadline, work model, employment
type, position level, experience, department, the "Aday Kriterleri" (candidate criteria),
and whether the ad is still active.

## Usage examples

```bash
# Web developer roles in Bursa
bun run .agents/skills/kariyer-search/cli/src/cli.ts search -q "web developer" -l "Bursa" --format table

# Frontend developer roles anywhere in İstanbul, posted in the last 7 days
bun run .agents/skills/kariyer-search/cli/src/cli.ts search -q "frontend developer" -l "İstanbul" --jobage 7 --format table

# Remote UI/UX designer roles at Turkish employers
bun run .agents/skills/kariyer-search/cli/src/cli.ts search -q "UI/UX designer" --remote remote --format table

# Graphic designer roles in İzmir and Ankara, last 14 days
bun run .agents/skills/kariyer-search/cli/src/cli.ts search -q "grafik tasarımcı" -l "İzmir,Ankara" --jobage 14 --format table

# Everything posted today on İstanbul's Asian side, page 2
bun run .agents/skills/kariyer-search/cli/src/cli.ts search -l "İstanbul Anadolu" --jobage 1 --page 2 --format table

# Full details for a specific posting
bun run .agents/skills/kariyer-search/cli/src/cli.ts detail 4520391 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning (`[S]` marks sponsored cards) |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON: `{ "meta": { "count", "page", "hasMore" }, "results": [ { "id", "title", "company",
"location", "date", "age", "workModel", "employmentType", "sponsored", "url" } ] }`. Missing values
are `null`, never omitted.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits
with code `1`. Codes: `UNKNOWN_FLAG`, `MISSING_REQUIRED`, `BAD_ARG`, `NO_ID`, `BAD_ID`, `NOT_FOUND`,
`BLOCKED` (bot protection, don't retry right away), `LOGIN_REQUIRED`, `SEARCH_FAILED`, `DETAIL_FAILED`.

## Notes

- **Dates on search cards are approximate.** The results page only shows a relative label
  (`"4 gün"`, `"3 saat"`). The CLI keeps it as `age` and converts it to `date` (YYYY-MM-DD,
  Türkiye time). Many cards are re-published ads (the site's "update" icon), so the label
  counts from the last re-publish. `detail` returns the exact `date` (last publish) and `deadline`.
- **`--jobage` and re-published ads.** The site's own date filter appears to use the
  original publish date, so a re-published older ad whose card says `"1 saat"` can be
  excluded by `--jobage`. That is the site's behaviour, not a parsing error.
- **Sponsored cards** (`"sponsored": true`, shown as "Sponsorlu İlan") repeat at the top of
  every page. Dedupe by `id` when paging.
- **Remote cards have no location line.** For them `location` comes from the card's own
  city list, written the way the site writes it (`"Adana +48 il daha"`). Check `workModel`
  (`"Uzaktan / Remote"`, `"Hibrit"`, `"İş Yerinde"`).
- **Applying** happens on the posting page via kariyer.net's "Başvur" button, which needs a
  candidate login. The CLI only reads public pages and never applies.
- Keyword matching is the site's own (partly semantic): `"web developer"` also returns
  "Software Engineer" ads. Narrow results with `--location`, `--remote` and `--jobage`.
- Postings are in Turkish. Common terms: *Tam zamanlı* (full-time), *Yarı zamanlı*
  (part-time), *Uzaktan* (remote), *Hibrit* (hybrid), *İş Yerinde* (on-site), *Tecrübe*
  (experience), *Son başvuru* (deadline), *Engelli ilanı* (role for registered disabled candidates).
- The CLI retries 429/5xx with exponential backoff. Keep volume low (see the warning above).
