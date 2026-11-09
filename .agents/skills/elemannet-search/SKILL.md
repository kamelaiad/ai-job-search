---
name: elemannet-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Turkey on
  eleman.net, or look up a specific eleman.net job posting. eleman.net is a
  large Turkish job board with many local, blue-collar, retail and service
  jobs plus office roles (design, accounting, sales, IT) across Turkish cities
  and districts (İstanbul, Ankara, İzmir, Bursa, ...). Trigger phrases:
  eleman.net, elemannet, jobs in Turkey, local jobs in Bursa/Istanbul, Turkish
  job board; Turkish: eleman.net ilanları, iş ilanı, iş ilanları, eleman
  ilanı, eleman ilanları, iş ara, iş arıyorum, grafik tasarım uzmanı ilanı,
  Bursa iş ilanları, İstanbul iş ilanları.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/elemannet-search/cli/src/cli.ts *)
---

# eleman.net Search Skill

Search live job listings on [eleman.net](https://www.eleman.net), a large Turkish job board
(strong on local, blue-collar, retail and service jobs; also office roles). No authentication,
no API key, and **zero runtime dependencies** — it runs with just `bun`. Postings are in Turkish.

## ⚠️ Personal use only

eleman.net's `robots.txt` disallows its legacy search script (`/is_ilanlari.php`, `?t=arama`),
`.html`/`.asp` pages and several query parameters (`?t=`, `?tip=`, `?ilan_id=`, ...). This skill
reads **only** the path-based listing pages (`/is-ilanlari/<position>`, `/is-ilanlari/<city>`,
`/is-ilanlari/<city>/<position>`, with the site's own `?sy=` pagination and `?gun=` age filter)
and the posting pages `/is-ilani/<slug>-i<id>` — and it refuses, before any request, every URL
that matches a `robots.txt` Disallow rule. It does **not** use the site's free-text search form
(`?aranan=`): those pages are marked `noindex, nofollow`. Keep volume low, don't use it
commercially or for bulk data collection, and run it on your own responsibility.

## When to use this skill

- Search for open positions in Turkey by eleman.net position/category name and/or city or district
- Keep only recent postings (last 1 / 4 / 7 / 15 / 30 days)
- Get the full description, deadline and requirements of a specific eleman.net posting

## Commands

### Search job listings

```bash
bun run .agents/skills/elemannet-search/cli/src/cli.ts search -q "<position>" [-l "<city>"] [flags]
```

Key flags (at least one of `--query` / `--location` is required):
- `--query <text>` / `-q <text>` — an **eleman.net position or category name**, e.g. `"grafik tasarım uzmanı"`, `"grafik"`, `"grafiker"`, `"arayüz tasarımcısı"`, `"muhasebe"`. This is not free-text search: a name eleman.net has no listing page for (e.g. `"web tasarım"`, `"grafik tasarım"`) exits `1` with `QUERY_NOT_RECOGNIZED` — try a broader category (`"grafik"`) or the formal position title.
- `--location <text>` / `-l <text>` — Turkish province or district, e.g. `"İstanbul"`, `"Ankara"`, `"İzmir"`, `"Bursa"`, `"Nilüfer"`, `"İstanbul Avrupa"`.
- `--jobage <days>` — posted within N days. eleman.net offers `1`, `4`, `7`, `15`, `30`; other values **round up** to the next window (`2` → 4, `10` → 15), and anything above 30 means no filter. The applied window is reported in `meta.jobageDays`.
- `--page <n>` — page number (1-indexed, about 30 results per page; `meta.hasNextPage` says whether another page exists).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/elemannet-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric posting number from `search` results (e.g. `4802848`). A posting slug
(`grafik-tasarim-uzmani-i4802848`) or a full `https://www.eleman.net/is-ilani/...` URL works too.
Returns the full description, posting date, application deadline, employment type, education,
experience, benefits and the posting's requirement badges (`criteria`).

## Usage examples

```bash
# Graphic design specialist roles anywhere in Turkey
bun run .agents/skills/elemannet-search/cli/src/cli.ts search -q "grafik tasarım uzmanı" --format table

# Graphic-design category in İstanbul, posted in the last week
bun run .agents/skills/elemannet-search/cli/src/cli.ts search -q "grafik" -l "İstanbul" --jobage 7 --format table

# UI designer (arayüz tasarımcısı) roles in Ankara
bun run .agents/skills/elemannet-search/cli/src/cli.ts search -q "arayüz tasarımcısı" -l "Ankara" --format table

# Everything in Bursa, second page
bun run .agents/skills/elemannet-search/cli/src/cli.ts search -l "Bursa" --page 2 --format table

# Graphic designers in İzmir posted today, as JSON
bun run .agents/skills/elemannet-search/cli/src/cli.ts search -q "grafiker" -l "İzmir" --jobage 1

# Full details for a specific posting
bun run .agents/skills/elemannet-search/cli/src/cli.ts detail 4802848 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single posting's full detail (`detail` command); in `search` it adds benefits and the teaser |

Search JSON: `{ "meta": { "count", "page", "hasNextPage", "jobageDays", "expandedOmitted", "source" }, "results": [...] }`.
Each result has `id`, `title`, `company`, `location`, `date`, `benefits`, `snippet`, `featured`
and `url`; missing values are `null`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **`date` is always `null` in search results**: eleman.net's listing cards carry no posting date.
  `detail` returns the real `date` and `deadline`. Use `--jobage` to filter by age.
- **Unknown names are errors, not results.** For an unknown slug eleman.net answers 200 with its
  generic listing (all jobs, or all jobs in the city) and says so only in the canonical link; the
  CLI checks it and exits `1` with `QUERY_NOT_RECOGNIZED` / `LOCATION_NOT_RECOGNIZED` instead of
  presenting unrelated jobs as matches.
- **Padded results are dropped.** When a listing has no exact matches, eleman.net shows
  "Genişletilmiş arama sonuçlarını görüyorsunuz" followed by broadened, mostly unrelated postings.
  The CLI omits those and reports how many in `meta.expandedOmitted` (so `count: 0` with
  `expandedOmitted: 4` means "no real matches").
- Position pages match loosely (e.g. "grafik tasarım uzmanı" also lists "Grafiker", "Dijital
  Tasarım Elemanı", "Teknik Tasarım Uzmanı") — check titles before treating them as fits.
- Featured ("vitrin") postings are flagged `featured: true` and can repeat across pages.
- Posting descriptions sometimes include the employer's (partly masked) phone number as written in
  the ad; full contact details require login and are not fetched.
- The CLI retries 429/5xx with exponential backoff. Keep volume low (see the warning above).
