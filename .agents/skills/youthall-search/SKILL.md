---
name: youthall-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search Youthall (youthall.com), the
  Türkiye career platform for university students, new graduates and young
  professionals: internships, management-trainee programs, new-graduate and
  early-career jobs at large companies in Türkiye, in Turkish or English. Invoke
  it for internship or graduate job searches in Türkiye, in Turkish cities
  (İstanbul, Ankara, İzmir, Bursa, Kocaeli...), or to read a Youthall posting.
  Trigger phrases: youthall, internship Türkiye, internship Turkey, graduate
  jobs Türkiye, new graduate jobs Turkey, entry-level jobs İstanbul, management
  trainee Turkey, staj ilanı, staj ilanları, stajyer ilanı, yaz stajı, uzun
  dönem staj, yeni mezun iş ilanı, yeni mezun ilanları, genç yetenek programı,
  management trainee programı, iş ilanı İstanbul, kariyer fırsatları öğrenci.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/youthall-search/cli/src/cli.ts *)
---

# Youthall Search Skill

Search live listings on [Youthall](https://www.youthall.com), Türkiye's career platform
for students and new graduates (18-35). It covers internships (staj), long-term
internships, management-trainee and talent programs, new-graduate, full-time,
part-time, project-based and volunteer roles, mostly at large companies. Postings are
in Turkish or English. No authentication, no API key, **zero runtime dependencies**.

## Personal use, low volume

`robots.txt` allows the public listing and posting pages (including the search filters)
for all crawlers and explicitly for AI assistants. Youthall's user agreement forbids
putting disproportionate load on the site, and listings are third-party content. **Keep
volume low (a few searches, not a crawl), use it for your own job search, and don't
republish or bulk-collect the listings.** Run it on your own responsibility.

## When to use this skill

- Find internships, graduate programs or early-career jobs in Türkiye by keyword
- Narrow to a Turkish city or to a listing type (internship, new graduate, full time...)
- Read the full description, deadline and hiring process of one Youthall posting

## Commands

### Search listings

```bash
bun run .agents/skills/youthall-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keywords (position, company or keyword), Turkish or English. Optional; without it you get every open listing.
- `--location <city>` / `-l <city>` — Turkish city, e.g. `"İstanbul"`, `"Ankara"`, `"İzmir"`, `"Bursa"`. Maps to Youthall's city page; an unknown city exits 1 with `UNKNOWN_LOCATION`.
- `--type <types>` / `-t <types>` — comma-separated listing types: `internship`, `mt_internship` (management trainee), `new_graduated`, `young_professional`, `professional`, `full_time`, `part_time`, `contract`, `periodic`, `project_based`, `freelance`, `volunteer`, `scholarship`.
- `--page <n>` — page number (1-indexed, 18 results per page). `meta.hasMore` says whether a next page exists.
- `--limit <n>` / `-n <n>` — cap the results emitted (client-side).
- `--format json|table|plain` — default `json`.

> **`--jobage` is not supported.** Result cards show only the application **deadline**,
> not the posting date, and Youthall has no posting-age filter, so `date` is `null` in
> search results and `--jobage` exits 1 with `UNSUPPORTED_FLAG`. Every listed posting is
> still open (Youthall removes postings once the deadline passes) and the default order
> is newest first. `detail` returns the posting date.

### Fetch one posting

```bash
bun run .agents/skills/youthall-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the `id` from search results, `<companySlug>/<postingSlug>` (e.g.
`AcmeTR/ui-ux-tasarim-stajyeri_12`). A full `https://www.youthall.com/tr/...` or `/en/...`
posting URL also works. Returns the description, posting date, deadline, department,
listing type, salary note, working locations, hiring-process steps and the apply link
(applying needs a Youthall account).

## Usage examples

```bash
# Design internships and roles anywhere in Türkiye
bun run .agents/skills/youthall-search/cli/src/cli.ts search -q "tasarım" --format table

# Software internships in İstanbul
bun run .agents/skills/youthall-search/cli/src/cli.ts search -q "yazılım" -l "İstanbul" --type internship --format table

# New-graduate and full-time roles in Ankara
bun run .agents/skills/youthall-search/cli/src/cli.ts search -l "Ankara" --type new_graduated,full_time --format table

# Frontend / web developer listings in İzmir, English keyword
bun run .agents/skills/youthall-search/cli/src/cli.ts search -q "frontend" -l "İzmir" --format table

# Every open internship in Bursa, second page
bun run .agents/skills/youthall-search/cli/src/cli.ts search -l "Bursa" --type internship --page 2 --format table

# Full posting
bun run .agents/skills/youthall-search/cli/src/cli.ts detail "AcmeTR/ui-ux-tasarim-stajyeri_12" --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing `id`s to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading results or a single posting's full detail |

Search JSON: `{ "meta": { "count", "page", "hasMore" }, "results": [ { "id", "title",
"company", "location", "multipleLocations", "type", "date" (always null), "deadline",
"snippet", "url" } ] }`. Missing values are `null`, never omitted.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Youthall is a small, curated board: a few dozen open postings at a time, so many keyword searches return 0 results. An English job title (e.g. "designer") often finds nothing while the Turkish term ("tasarım") does; try both, or search without `--query` and filter by `--type`/`--location`.
- The keyword search also matches posting text, not just titles (e.g. "tasarım" can return an engineering program).
- `location` on a card is the first city; `multipleLocations: true` means the card showed "+" (more cities). Hybrid postings may show a workplace label such as `"Hibrit"` instead of a city. `detail` lists every working location.
- A city filter also returns multi-city postings that include that city, even when the card shows a different first city.
- Some postings are in English and live under `/en/`; the id is the same either way and `detail` follows Youthall's redirect.
- Data comes from the public HTML pages (no JSON API). The CLI retries 429/5xx with exponential backoff.
