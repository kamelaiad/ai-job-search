---
name: techcareer-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search tech, software, IT, data,
  design or digital-marketing job listings in Türkiye (Turkey) on Techcareer.net,
  the tech-career platform launched by Kariyer.net, or look up a specific
  Techcareer posting. Covers İstanbul, Ankara, İzmir, Bursa, Antalya and the rest
  of Türkiye; postings are in Turkish and English. Trigger phrases: techcareer,
  techcareer.net, tech jobs Türkiye, software jobs Turkey, developer jobs
  Istanbul, frontend developer jobs Türkiye; yazılım iş ilanları, yazılımcı iş
  ilanı, yazılım geliştirici ilanları, bilişim iş ilanları, teknoloji iş
  ilanları, iş ilanı ara, İstanbul yazılım işleri.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/techcareer-search/cli/src/cli.ts *)
---

# Techcareer Search Skill

Search live job listings on [Techcareer.net](https://www.techcareer.net/jobs), a
Türkiye tech-career platform launched by Kariyer.net. No authentication, no API key
and **zero runtime dependencies**: it runs with just `bun`. The board is small and
tech-focused (about 120 open postings on 2026-11-09): software, IT and system roles,
data, ERP, web design and digital marketing, mostly in Turkish.

## Fair use

`robots.txt` allows the job pages this skill reads, and the Techcareer service
agreement (`/hizmet-sozlesmesi`) has no clause on automated access as of 2026-11-09
(checked by keyword search, which is not a legal review). Use it for your own job
search: **keep volume low** (a few searches and details per session) and do not use
it for bulk collection or commercial purposes.

## When to use this skill

- Search Techcareer for open tech positions by keyword and/or city in Türkiye
- List the newest postings on the board (a search with no keywords)
- Get the full description, publication date, deadline, skills and work model of one posting

## Commands

### Search job listings

```bash
bun run .agents/skills/techcareer-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>`: keyword search (title, skill, role). **Short Turkish
  keywords match best** (`yazılım`, `web`, `tasarım`, `frontend`, `veri`). Long English
  phrases often return nothing (`"UI/UX designer"` returned 0 results on 2026-11-09).
  Omit it to list every open posting, newest first.
- `--location <text>` / `-l <text>`: city, e.g. `"İstanbul"`, `"Ankara"`, `"İzmir"`,
  `"Bursa"`. Diacritics are optional (`istanbul` works). There is no remote filter:
  `"Uzaktan"` as a location returns nothing. Remote postings show `"workplace": "Uzaktan"`.
- `--page <n>`: page number (1-indexed, 20 results per page, fixed by the portal).
- `--limit <n>` / `-n <n>`: cap total results emitted (client-side).
- `--format json|table|plain`: default `json`.

**`--jobage` is not supported.** Techcareer has no posting-age filter, and its search
results carry no date (`"date": null`). Passing `--jobage` exits 1 with
`UNSUPPORTED_FLAG` rather than silently returning old postings. Results come **newest
first**. To check recency, run `detail` on the postings you care about: it returns
`date` (published) and `deadline`.

### Fetch full job detail

```bash
bun run .agents/skills/techcareer-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the posting's slug from `search` results (e.g. `back-end-developer-4491449`).
You may also pass a full `https://www.techcareer.net/jobs/detail/...` URL (the `/en/`
path works too). URLs on any other host are rejected. Returns the full description,
publication date, deadline, workplace type, employment type, experience, skills,
languages, external apply link (if any) and an `isActive` flag.

## Usage examples

```bash
# Frontend roles anywhere in Türkiye
bun run .agents/skills/techcareer-search/cli/src/cli.ts search -q "frontend" --format table

# Web developer / web design roles in İstanbul
bun run .agents/skills/techcareer-search/cli/src/cli.ts search -q "web" -l "İstanbul" --format table

# UI/UX and design roles (Turkish keyword matches best) in İzmir
bun run .agents/skills/techcareer-search/cli/src/cli.ts search -q "tasarım" -l "İzmir" --format table

# Software roles in Ankara, first 5
bun run .agents/skills/techcareer-search/cli/src/cli.ts search -q "yazılım" -l "Ankara" --limit 5

# Newest postings in Bursa, second page
bun run .agents/skills/techcareer-search/cli/src/cli.ts search -l "Bursa" --page 2 --format table

# Full details for one posting
bun run .agents/skills/techcareer-search/cli/src/cli.ts detail back-end-developer-4491449 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON: `{ "meta": { "count", "page", "total", "totalPages" }, "results": [...] }`.
Each result has `id`, `title`, `company`, `location`, `date` (always `null`, see
above), `url`, plus `workplace`, `position`, `otherLocations` and `applyUrl`. Missing
values are `null`, never omitted.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data comes from the server-rendered `__NEXT_DATA__` JSON on the public `/jobs` and
  `/jobs/detail/<slug>` pages. No login and no internal API. See `url-reference.md`.
- The `?q=` URL parameter is **ignored** by the site (it returns the whole board). The
  real search parameters are `jobs[search][keyword]`, `jobs[search][location]` and
  `jobs[page]`, which the CLI builds for you.
- Keyword matching is the portal's own and is loose: `"frontend developer"` returned two
  backend roles on 2026-11-09 (no frontend posting was open). Always check titles.
- The `id` is the slug. The bare trailing number (`4491449`) is not addressable, and an
  unknown or expired slug redirects to the job list, which the CLI reports as `NOT_FOUND`.
- Location strings look like `"İstanbul(Avr.) / Türkiye"` / `"İstanbul(Asya) / Türkiye"`
  (European / Asian side). `otherLocations` counts further cities a posting lists.
- Some employers hide their name. `company` is then the portal's anonymous blurb or `null`.
- `applyUrl: null` means you apply on Techcareer / Kariyer.net (account required to apply,
  not to read).
- The CLI retries 429/5xx with exponential backoff. Pages are about 200-430 KB each, so
  keep volume low.
