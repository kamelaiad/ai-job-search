---
name: toptalent-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search toptalent.co, the Türkiye
  early-career platform for students, new graduates and young professionals:
  internships, long-term internships, new-graduate programs and junior jobs at
  companies in Türkiye, mostly in Turkish. Invoke it for early-career or
  internship searches in Turkish cities (İstanbul, Ankara, İzmir, Bursa,
  Kocaeli...) or to read a toptalent posting. Trigger phrases: toptalent,
  toptalent.co, internship Türkiye, new graduate jobs Turkey, early-career jobs
  Türkiye, junior jobs İstanbul, iş ilanı, iş ilanları, yeni mezun, yeni mezun
  iş ilanı, staj ilanı, stajyer, kariyer fırsatları, genç yetenek programı,
  uzun dönem staj, part time staj.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/toptalent-search/cli/src/cli.ts *)
---

# toptalent Search Skill

Search live listings on [toptalent.co](https://toptalent.co), a Türkiye career platform
for students and new graduates: internships (staj), long-term internships, new-graduate
and talent programs, and junior roles. Postings are mostly in Turkish, some in English.
No authentication, no API key, **zero runtime dependencies**.

## ⚠️ Personal use only

`robots.txt` does not disallow the search endpoint or posting pages (it does disallow one
specific posting, which the CLI refuses to fetch). toptalent's terms
("Şartlar ve Koşullar", §6) say site content may not be copied, reproduced, distributed
or used commercially without permission. **Read listings for your own job search only:
keep volume low, don't republish, bulk-collect or commercially use the data.** Run it on
your own responsibility.

## When to use this skill

- Find internships, new-graduate programs or junior jobs in Türkiye on toptalent
- Narrow to Turkish cities or to who can apply (student year, new graduate, experience)
- Read one toptalent posting: description, department, who can apply, days left

## Commands

### Search listings

```bash
bun run .agents/skills/toptalent-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords, e.g. `"grafik tasarım"`, `"yazılım"`, `"intern"`. Optional; without it you get every open listing.
- `--location <cities>` / `-l <cities>` — comma-separated Turkish provinces, e.g. `"İstanbul"`, `"Ankara,İzmir"`. `"İstanbul"` covers both sides; `"İstanbul Avrupa"` / `"İstanbul Anadolu"` narrow to one. Unknown names exit 1 with `UNKNOWN_LOCATION`. **Nationwide ("Tüm Türkiye") postings are excluded when a city is set** — omit `--location` to see them.
- `--level <levels>` — comma-separated "who can apply" levels: `prep`, `1st-year`, `2nd-year`, `3rd-year`, `4th-year`, `masters-student`, `phd-student`, `new-grad`, `exp-0-1`, `exp-1-3`, `exp-3-5`, `exp-5-10`, `exp-10-plus`.
- `--page <n>` — page number (1-indexed, 9 results per page). `meta.hasMore` is true when the page was full.
- `--limit <n>` / `-n <n>` — cap the results emitted (client-side).
- `--format json|table|plain` — default `json`.

> **`--jobage` is not supported.** Result cards carry no posting date (only a
> "Son N Gün" deadline countdown, returned as `daysLeft`) and toptalent has no
> posting-age filter, so `date` is `null` in search results and `--jobage` exits 1 with
> `UNSUPPORTED_FLAG`. Results are ordered newest first; `detail` returns the posting date.

### Fetch one posting

```bash
bun run .agents/skills/toptalent-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the posting slug from search results (e.g. `acme-ui-ux-designer-121900`); a
`https://toptalent.co/<slug>` URL also works. Returns the description, departments,
locations, who can apply, days left, posting date and employment type. Company
program pages (a branded landing page instead of a normal posting) come back with
`layout: "campaign"` and only title, company and description. Applying needs a
toptalent account.

## Usage examples

```bash
# Graphic design roles anywhere in Türkiye
bun run .agents/skills/toptalent-search/cli/src/cli.ts search -q "grafik tasarım" --format table

# Software / web developer roles in İstanbul
bun run .agents/skills/toptalent-search/cli/src/cli.ts search -q "yazılım" -l "İstanbul" --format table

# New-graduate openings in Ankara or İzmir
bun run .agents/skills/toptalent-search/cli/src/cli.ts search --level new-grad -l "Ankara,İzmir" --format table

# Internships for 3rd/4th-year students in Bursa
bun run .agents/skills/toptalent-search/cli/src/cli.ts search -q "stajyer" -l "Bursa" --level 3rd-year,4th-year --format table

# Everything currently open (toptalent is small), newest first
bun run .agents/skills/toptalent-search/cli/src/cli.ts search --format table

# Full posting
bun run .agents/skills/toptalent-search/cli/src/cli.ts detail acme-ui-ux-designer-121900 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing `id`s to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading results or a single posting's full detail |

Search JSON: `{ "meta": { "count", "page", "hasMore" }, "results": [ { "id", "title",
"company", "location", "date" (always null), "daysLeft", "url" } ] }`. Missing values are
`null`, never omitted.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- toptalent is a small board: on 2026-11-09 it had **5 open postings in total**, so most keyword searches (e.g. "grafik tasarım", "web", "yazılım") return 0 results. An empty result is normal, not an error; search without `--query` to see everything that is open.
- `location` is shown as on the site: a province, `"İstanbul Avrupa"` / `"İstanbul Anadolu"`, or `"Tüm Türkiye"` (nationwide).
- `daysLeft` comes from the "Son N Gün" badge; some postings (often company programs) show none.
- Search goes through the site's own listing request (`POST /Job/SearchJob`, an HTML fragment); a full HTML page in its place exits 1 with `UNEXPECTED_RESPONSE` rather than passing as zero results.
- `detail` refuses `turkiye-sigorta-geleceginin-sigortasi-120944` (`ROBOTS_DISALLOWED`): robots.txt disallows that posting.
- The CLI retries 429/5xx with exponential backoff.
