---
name: weworkremotely-search
version: 1.0.0
description: >
  Use this skill to search live remote job listings on We Work Remotely
  (weworkremotely.com), a worldwide remote-only job board in English, or to look up a
  specific We Work Remotely posting. Covers design, front-end / back-end / full-stack
  programming, DevOps, product, customer support, sales/marketing and management roles,
  for candidates in any country, e.g. remote roles open to Türkiye, EMEA or worldwide.
  Trigger phrases: remote jobs, We Work Remotely, WWR, weworkremotely, remote web
  designer jobs, remote web developer jobs, remote UI designer, remote graphic designer,
  work from anywhere jobs, worldwide remote jobs, "are there any remote X jobs", look up
  this We Work Remotely job; Turkish: uzaktan iş, uzaktan çalışma, remote iş ilanları,
  evden çalışma.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/weworkremotely-search/cli/src/cli.ts *)
---

# We Work Remotely Search Skill

Search live remote job listings from **[We Work Remotely](https://weworkremotely.com)**
through its public **RSS feeds**: one all-jobs feed plus one feed per category.
Country-agnostic: every posting is remote. No authentication, no API key and **zero
runtime dependencies**: it runs with just `bun`.

## ⚠️ Personal use only

robots.txt allows everything except account/admin paths, and the RSS feeds are public
syndication feeds. But We Work Remotely's HTML pages, **including its Terms of Service**,
sit behind a Cloudflare challenge this CLI does not pass, so the terms could not be read
and checked. Treat this as **personal job search only: keep volume low, no commercial
use, bulk collection or republishing**, on your own responsibility. Link to the job's
We Work Remotely `url` when you share a posting.

## When to use this skill

- Search remote jobs by keyword, optionally within categories (`design`, `front-end`, `full-stack`, ...)
- Narrow to roles open worldwide or in a region (`--location "worldwide,europe,türkiye"`) or recent postings (`--jobage`)
- Read the full description of one We Work Remotely posting

## Commands

### Search job listings

```bash
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search [flags]
```

The feeds have **no query, location, date or page parameters**. The CLI reads the feed(s)
and filters client-side:

- `--query <text>` / `-q <text>`: keywords. Every word must appear (case-insensitive, at
  the start of a word) in the title, company, skills, category or description. Optional.
- `--title-only`: match `--query` against the job title only (precise role searches).
- `--category <list>` / `-c <list>`: comma-separated category feeds to read **instead of**
  the all-jobs feed. The all-jobs feed holds only the **10 newest jobs per category** (100
  total). A category feed holds every current job in that category. Values: `design`,
  `full-stack`, `front-end`, `back-end`, `programming`, `devops`, `product`,
  `customer-support`, `sales-marketing`, `management-finance`, `other`. Each category is
  one request (0.1–1.8 MB), spaced one second apart.
- `--location <text>` / `-l <text>`: comma-separated words; a job matches if its location
  text contains **any** of them (diacritics ignored). The location text is WWR's region
  (`Anywhere in the World`, `USA Only`, `Europe Only`, `Latin America Only`, ...) plus its
  country/state fields. `worldwide` matches `Anywhere in the World`.
- `--jobage <days>`: posted within N days (RSS `pubDate`).
- `--page <n>`: 1-indexed page over the filtered results (page size = `--limit`).
- `--limit <n>` / `-n <n>`: results per page. Default 20.
- `--format json|table|plain`: default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts detail <slug|url> [--category <cat>] [--format json|plain]
```

`slug` is the `id` from `search` results (e.g. `thatch-brand-designer`). A
`weworkremotely.com/remote-jobs/<slug>` URL also works. A URL on any other host (e.g. an
employer's apply link) is rejected with `BAD_ID`. Job pages are behind the Cloudflare
challenge, so `detail` reads the job's **RSS item**, which carries the full description.
It looks in the all-jobs feed first, then each category feed until the job turns up (up
to 12 requests). **Pass `--category` with the result's category** (`design`,
`front-end`, ...) to make it a single request. A job that has expired out of the feeds
returns `NOT_FOUND`.

## Usage examples

```bash
# Remote web designer roles (test query), table view
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -q "web designer" --format table

# Every current design job with "designer" in the title, open worldwide or to Europe/Türkiye
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -c design -q designer --title-only -l "worldwide,europe,türkiye" --format table

# Web developer roles from the front-end and full-stack feeds, last 14 days
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -c front-end,full-stack -q "web developer" --jobage 14 --format table

# UI / UX designer roles, anywhere in the world
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -c design -q ux --title-only -l worldwide --format table

# Full detail for one job (one request thanks to --category)
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts detail thatch-brand-designer -c design --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing slugs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total", "source", "feeds" }, "results": [...] }`.
Each result has `id` (the slug), `title`, `company`, `location`, `date`, `url`, `category`,
`employmentType`, `region`, `skills`, `expiresAt`, `source` (missing values are `null`,
never omitted). `total` is the number of matches before paging. `detail` adds `country`,
`state`, `headquarters` and `description`. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Feed titles are `Company: Job title`; the CLI splits on the first `": "`.
- `region` is WWR's hiring-region field. `country`/`state` often mirror the employer's HQ
  (e.g. `Anywhere in the World · 🇺🇸 United States of America · California`), and the
  description sometimes adds its own restriction ("only candidates based in the US").
  Read the description before you count a job as open to your country.
- Renewed postings keep their original `pubDate` (some category feeds still list 2023–2024
  dates with a future `expiresAt`), so `--jobage` drops them even though they are live.
- A search or detail that gets an HTML page instead of RSS fails with `SEARCH_FAILED` /
  `DETAIL_FAILED` ("not an RSS feed"), never as zero results.
- Feeds refresh hourly (`<ttl>60</ttl>`); there is no reason to poll more often.
