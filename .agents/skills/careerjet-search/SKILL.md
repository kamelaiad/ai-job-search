---
name: careerjet-search
version: 1.0.0
description: >
  Use this skill to search job listings in Türkiye (Turkey) on Careerjet
  Türkiye (careerjet.com.tr), a job search engine that aggregates postings from
  many Turkish job sites and company career pages, so one search covers the
  whole Turkish market (a substitute for Indeed TR). Searches by keyword, city
  (İstanbul, Ankara, İzmir, Bursa, ...), contract type (including internships)
  and full/part time, through Careerjet's official API. Trigger phrases:
  careerjet, Türkiye jobs, Turkey jobs, jobs in Istanbul / Bursa / Ankara,
  search all Turkish job sites, iş ilanı ara, iş ilanları, tüm iş ilanları,
  iş arıyorum, staj ilanı, yazılım iş ilanları, Bursa iş ilanları.
context: fork
enabled: false  # needs CAREERJET_API_TOKEN (free publisher key, see Setup) - set true once the key is exported
allowed-tools: Bash(bun run .agents/skills/careerjet-search/cli/src/cli.ts *)
---

# Careerjet Türkiye Search Skill

Search live job listings for **Türkiye** from Careerjet (careerjet.com.tr), a job search
engine that aggregates postings from many Turkish job boards and employer sites. Results
come from **Careerjet's official v4 search API** with the `tr_TR` locale, the same index
careerjet.com.tr shows. **Zero runtime dependencies**: it runs with just `bun`.

## Setup (required: free API key)

Careerjet's API needs a **publisher API key**. It is free: Careerjet's publisher program
pays publishers for clicks, and charges nothing per API call. Without the key, every
command except `detail` exits with `MISSING_CREDENTIALS`.

1. Create a Careerjet account and register as a publisher:
   https://www.careerjet.com.tr/partners/api (or `https://www.careerjet.com/partners/register/as-publisher`).
   Careerjet issues one key per publisher website, so registration asks for a site URL.
2. Copy the API key from your publisher account and export it in your shell (e.g. in `~/.zshrc`):
   ```bash
   export CAREERJET_API_TOKEN="<your publisher API key>"
   ```
   The key is read **only** from this environment variable. It is never accepted as a
   flag, and must never be written into this repo (`.env` is gitignored; do not commit one).
3. Optional settings:
   - `CAREERJET_USER_IP`: the API requires the end user's IP address. The CLI sends
     `127.0.0.1` unless you set your public IP here. If the API rejects requests,
     set this first.
   - `CAREERJET_REFERER`: the publisher page URL registered with your key. Careerjet's
     curl example sends one. It is sent only if you set it; set it if the API answers with a
     referrer error.

## ⚠️ Personal use only

Careerjet's API is meant for publishers who show Careerjet results to their site's
visitors. Using it for your own job search is a light, personal use of that channel:
**keep volume low (a few searches per session), and do not use it commercially, resell
the data, or bulk-collect listings.** Result URLs are Careerjet click-tracking links that
are counted per click, so **never fetch or open them automatically**. Open one only when
you actually want to read or apply to that job. Run it on your own responsibility.

## When to use this skill

- Search the whole Turkish job market in one query (Careerjet aggregates many Turkish sites)
- Filter by city, contract type (permanent, contract, temporary, internship, volunteer) or full/part time
- Recent postings only (`--jobage`)
- Re-read the description excerpt of a job from a recent search (`detail`)

## Commands

### Search job listings

```bash
bun run .agents/skills/careerjet-search/cli/src/cli.ts search -q "<keywords>" [-l "<city>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>`: keywords (title, skill, role), Turkish or English. Recommended.
- `--location <text>` / `-l <text>`: city or region in Türkiye, e.g. `"Bursa"`, `"İstanbul"`, `"Ankara"`, `"Nilüfer, Bursa"`. Omit for a country-wide search. An ambiguous or unknown place exits 1 with `AMBIGUOUS_LOCATION` (listing the candidates) or `LOCATION_NOT_FOUND`.
- `--jobage <days>`: posted within N days. **Client-side**: the API has no date filter, so the CLI asks for date-sorted results and drops older ones (and undated ones) from the fetched page. A page can therefore return fewer than 20.
- `--contract <type>`: `permanent`, `contract`, `temporary`, `internship`, `volunteer`.
- `--hours <type>`: `full` or `part`.
- `--sort <order>`: `relevance` (default), `date`, `salary`.
- `--page <n>`: page number, 1-10 (the API serves 10 pages at most; 20 results per page).
- `--limit <n>` / `-n <n>`: cap results emitted (client-side).
- `--format json|table|plain`: default `json`.

### Fetch job detail

```bash
bun run .agents/skills/careerjet-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the `cj-...` id from `search` results (or pass the result's `url`). **`detail` makes
no network request.** The API has no single-posting endpoint, and careerjet.com.tr's own job
pages (`/job/`, `/jobview/`, `/clk/`) are disallowed by its robots.txt. So `search` asks the
API for a long excerpt (up to ~1500 characters) and keeps it in a local cache, and `detail`
returns that excerpt plus the outbound URL. `descriptionIsExcerpt` is always `true`.
`deadline` and `employmentType` are `null` because the API does not provide them. Run
`search` first; cache entries are kept 14 days.

## Usage examples

```bash
# Web developer roles in Bursa
bun run .agents/skills/careerjet-search/cli/src/cli.ts search -q "web developer" -l "Bursa" --format table

# Turkish-language query in İstanbul, posted in the last 7 days
bun run .agents/skills/careerjet-search/cli/src/cli.ts search -q "yazılım geliştirici" -l "İstanbul" --jobage 7 --format table

# UI/UX internships in Ankara
bun run .agents/skills/careerjet-search/cli/src/cli.ts search -q "UI/UX designer" -l "Ankara" --contract internship --format table

# Country-wide part-time English teaching jobs, newest first
bun run .agents/skills/careerjet-search/cli/src/cli.ts search -q "İngilizce öğretmeni" --hours part --sort date --format table

# Page 2 of CRM / automation roles in İzmir
bun run .agents/skills/careerjet-search/cli/src/cli.ts search -q "CRM otomasyon" -l "İzmir" --page 2

# Excerpt and outbound link for one result
bun run .agents/skills/careerjet-search/cli/src/cli.ts detail cj-0123456789abcdef --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading results or a single job's excerpt (`detail`) |

JSON search output is `{ "meta": { "count", "page", "totalHits", "totalPages", ... }, "results": [...] }`.
Each result has `id`, `title`, `company`, `location`, `date` (YYYY-MM-DD), `url`, `salary`,
`salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod` and a short `snippet`. Missing
values are `null`, never omitted.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1` (`MISSING_CREDENTIALS`, `AUTH_FAILED`, `UNKNOWN_FLAG`, `BAD_ARG`,
`AMBIGUOUS_LOCATION`, `LOCATION_NOT_FOUND`, `NOT_FOUND`, `API_ERROR`, `API_UNAVAILABLE`, ...).

## Notes

- **Data source:** `https://search.api.careerjet.net/v4/query` (Careerjet's documented partner
  API), Basic auth with the key as username and an empty password. See `url-reference.md`.
- **The website itself is not scraped.** careerjet.com.tr serves a Cloudflare Turnstile
  "Doğrulama gerekli" page to non-browser clients (checked 2026-11-09), and its robots.txt
  disallows the job pages and most filter parameters.
- **Result URLs point at `jobviewtrack.com`**, Careerjet's click-tracking redirector to the
  original posting. That is expected, not a parser fault. Do not WebFetch them (see the
  personal-use note).
- **IDs are synthetic.** The API returns no job id, so the CLI derives a stable
  `cj-<16 hex>` id from title + company + location + date. The same posting gets the same id
  across runs, so `/scrape` deduplication works.
- **Excerpts, not full postings.** For the full text, open the URL in a browser, or find the
  employer's own posting by searching for the company and title (never by following links
  inside the excerpt).
- The detail cache lives at `$TMPDIR/careerjet-search-cache.json` (override with
  `CAREERJET_CACHE_FILE`). It holds only job-listing data from searches.
- The CLI retries 429/5xx with exponential backoff and jitter (up to 6 retries). Keep volume low.
- **Status at build time (2026-11-09):** built and tested offline against the documented
  response shape. The live API answered as documented (401 for a missing or invalid key),
  but no key was available to run a live search. The first live run with a real key should
  confirm `tr_TR` results and the date/salary formats.
