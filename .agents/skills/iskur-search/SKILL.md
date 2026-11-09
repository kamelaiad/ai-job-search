---
name: iskur-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search İŞKUR (Türkiye İş Kurumu,
  Turkey's state employment agency) for job ads in Türkiye, or read a specific
  İŞKUR job ad. Covers private-sector and public-sector (kamu) vacancies in all
  81 provinces (İstanbul, Ankara, İzmir, Bursa, ...). Trigger phrases: İŞKUR,
  ISKUR, iskur jobs, Turkish state employment agency jobs, public sector jobs in
  Turkey, government jobs Türkiye, iskur iş ilanları, İŞKUR ilanları, açık iş
  ilanları, kamu iş ilanı, kamu işçi alımı, devlet iş ilanı, e-Şube iş ilanı,
  "İŞKUR'da <meslek> ilanı var mı", "Bursa'da İŞKUR iş ilanları".
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/iskur-search/cli/src/cli.ts *)
---

# İŞKUR Search Skill

Search the public job ads ("Açık İş İlanları") of **İŞKUR**, Türkiye's state employment
agency, on its e-Şube site (`esube.iskur.gov.tr`). Turkish-language ads, all 81 provinces,
private sector (özel) and public sector (kamu). No login, no API key, and **zero runtime
dependencies** - it runs with just `bun`.

## Fair use

e-Şube's `robots.txt` allows the search and detail pages, and no terms forbidding automated
reading were found (checked 2026-11-09). It is still a **government service**: keep volume
low (a handful of searches, not a crawl). The CLI already spaces its requests about a
second apart; don't loop it over hundreds of pages. Applying to an ad needs an İŞKUR /
e-Devlet login on the site itself - this skill never logs in and never applies.

## When to use this skill

- Find İŞKUR job ads by keyword, province, sector (private / public) and recency
- Look for public-sector (kamu) worker vacancies announced through İŞKUR
- Read the full description (İş Tanımı), required skills and education of a specific ad

## Commands

### Search job ads

```bash
bun run .agents/skills/iskur-search/cli/src/cli.ts search [-q "<keywords>"] [-l "<province>"] [flags]
```

Flags:
- `--query <text>` / `-q <text>` - keywords: position, occupation, skill or employer name
  (`"grafik tasarım"`, `"web tasarım"`, `"muhasebe"`). İŞKUR matches it against the whole
  ad, description included, so some hits have a different job title.
- `--location <text>` / `-l <text>` - a **province (il)** by name or plate code: `Bursa`,
  `İstanbul` / `Istanbul`, `İzmir`, `Ankara`, `16`, `34`. Casing and Turkish diacritics
  don't matter. Province level only: districts (ilçe) are not a filter, but each result's
  `location` carries the district (`"Bursa / Nilüfer"`) for client-side filtering.
  Omit for all of Türkiye.
- `--sector <s>` - `private` (`özel`, default) or `public` (`kamu`). İŞKUR searches one
  sector at a time; run twice to cover both.
- `--jobage <days>` - posted within N days. İŞKUR only offers **24 hours / 1 week /
  15 days**, so N rounds **up** to 1, 7 or 15; anything above 15 means no age filter. The
  window actually applied is reported in `meta.jobageWindow` (`24h`, `7d`, `15d`, `all`).
- `--page <n>` - 1-indexed page, **15 results per page**. `meta.totalPages` / `meta.total`
  tell you how many exist.
- `--limit <n>` / `-n <n>` - cap results emitted (client-side).
- `--format json|table|plain` - default `json`.

### Fetch full ad detail

```bash
bun run .agents/skills/iskur-search/cli/src/cli.ts detail <ilanNo|url> [--format json|plain]
```

`ilanNo` is the 11-digit ad number from `search` (e.g. `00009887102`; leading zeros
optional). A full `https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=...` URL
also works. Returns the description (İş Tanımı), qualifications (Nitelik ve Beceriler),
occupations with required experience, and minimum/maximum education.

## Usage examples

```bash
# Graphic design ads in Bursa
bun run .agents/skills/iskur-search/cli/src/cli.ts search -q "grafik tasarım" -l Bursa --format table

# Web design ads in İstanbul posted in the last week
bun run .agents/skills/iskur-search/cli/src/cli.ts search -q "web tasarım" -l İstanbul --jobage 7 --format table

# Public-sector (kamu) vacancies in Ankara
bun run .agents/skills/iskur-search/cli/src/cli.ts search -l Ankara --sector public --format table

# Accounting ads in İzmir, last 15 days, second page
bun run .agents/skills/iskur-search/cli/src/cli.ts search -q "muhasebe" -l İzmir --jobage 14 --page 2 --format table

# Full detail of one ad
bun run .agents/skills/iskur-search/cli/src/cli.ts detail 00009887102 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default - programmatic use, passing `id`s to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading results or a single ad's full detail |

Search JSON: `{ "meta": { "count", "page", "totalPages", "total", "sector", "location",
"jobageWindow" }, "results": [...] }`. Each result has `id`, `title`, `company`, `location`,
`date`, `url` (missing values are `null`) plus `deadline` (ISO application deadline),
`employerHidden`, `sector` (Özel/Kamu), `employmentType` (Tam/Kısmi Zamanlı),
`contractType` (Daimi/Geçici), `openings`, `applicationScope` and `disabilityQuota`.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1`.

## Notes

- **`company` is `null` for most private-sector ads**: İŞKUR shows "İşyeri adını görmek
  için Sisteme Üye Girişi yapmanız gerekmektedir" (log in to see the employer) instead of
  the name. `employerHidden: true` marks those. Public-sector ads show the institution.
  The CLI never guesses an employer.
- **`date` is always `null`**: İŞKUR does not publish the posting date. Use `--jobage` to
  scope recency server-side; `deadline` (Son Başvuru Tarihi) is the closing date.
- The detail page shown to anonymous visitors omits employer, location and deadline -
  keep those from the search result. It also always shows a "log in to see details and
  apply" banner (`loginNotice: true`); the description itself is public.
- Many İŞKUR ads ask candidates to apply through their İŞKUR job counsellor (İş ve Meslek
  Danışmanı) rather than directly; read the qualifications text.
- `disabilityQuota: true` marks ads flagged with İŞKUR's disabled-candidate icon (engelli
  ilanı).
- e-Şube is an ASP.NET WebForms page: one search = GET of the form + POST of the criteria
  (+ one more POST for `--page` > 1). Markup anchors are recorded in `url-reference.md`.
- The CLI retries 429/5xx with exponential backoff and reports `BLOCKED` if İŞKUR's
  firewall rejects a request, `PORTAL_CHANGED` if the page layout no longer matches.
