---
name: remoteok-search
version: 1.0.0
description: >
  Use this skill to search live remote job listings on Remote OK (remoteok.com), a
  worldwide remote-only job board in English, or to look up a specific Remote OK
  posting. Covers remote tech and non-tech roles (web development, design, UI/UX,
  graphic design, marketing, support, ops) for candidates in any country, e.g. remote
  roles open to Türkiye, EMEA or worldwide. Trigger phrases: remote jobs, remote work,
  work from home jobs, Remote OK, remoteok, find a remote web developer job, remote
  designer jobs, remote UI designer, remote graphic designer, worldwide remote jobs,
  "are there any remote X jobs", look up this Remote OK job; Turkish: uzaktan iş,
  uzaktan çalışma, remote iş ilanları, evden çalışma.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/remoteok-search/cli/src/cli.ts *)
---

# Remote OK Search Skill

Search live remote job listings from **[Remote OK](https://remoteok.com)** through its
public JSON API (`https://remoteok.com/api`). Country-agnostic: every posting is remote,
and the API is the same for every market. No authentication, no API key and **zero
runtime dependencies**: it runs with just `bun`.

## ⚠️ Attribution required (Remote OK API terms)

Remote OK's API terms (sent as the first element of every API response) say: **link back
to the job's URL on Remote OK and mention Remote OK as the source**, or Remote OK
suspends API access. Do not use the Remote OK logo; using the name "Remote OK" is fine.

- Every result's `url` points to `remoteok.com`. Keep it when you show, save or share
  a job, and name **Remote OK** as the source. JSON output carries `source` on every
  result and an `attribution` line in `meta`; `table` and `plain` print a source footer.
- robots.txt declares `Crawl-delay: 1` and `Content-Signal: search=yes, ai-train=no,
  use=reference`. The CLI waits at least one second between requests, also across back-to-back
  runs. **Do not use Remote OK data to train or fine-tune models.** Use it to find jobs and
  link to them.
- Keep volume low: personal job search, not bulk collection or republishing.

## When to use this skill

- Search remote jobs by keyword and/or Remote OK tag (e.g. `design`, `web dev`)
- Narrow to roles open to a region (`--location "worldwide,europe,emea"`) or recent postings (`--jobage`)
- Read the full description of one Remote OK posting

## Commands

### Search job listings

```bash
bun run .agents/skills/remoteok-search/cli/src/cli.ts search [flags]
```

Remote OK's API has **no keyword, location, date or page parameters**. It returns the
~100 latest jobs, or the 100 latest jobs for one tag. All other filters run client-side
over that feed:

- `--query <text>` / `-q <text>`: keywords. Every word must appear (case-insensitive, at
  the start of a word) in the title, company, tags or description. Optional.
- `--title-only`: match `--query` against the job title only. Use it for precise role
  searches: Remote OK auto-assigns many loosely related tags to each job, and descriptions mention
  many roles.
- `--tag <tag>` / `-t <tag>`: a Remote OK tag sent to the API (`?tag=`). Use it to reach
  older postings in one area: the 100 latest `design` jobs go back months, while the
  default feed holds only the ~100 latest jobs overall. Tags seen in the feed: `design`,
  `designer`, `web dev`, `front end`, `full stack`, `javascript`, `react`, `illustrator`.
  An unknown tag returns 0 results.
- `--location <text>` / `-l <text>`: comma-separated words; a job matches if its location
  text contains **any** of them (diacritics ignored, so `turkiye` matches `Türkiye`). About
  half of the jobs have **no** location, meaning no restriction (the job page shows them as
  "Anywhere"). Those match only the terms `worldwide`, `anywhere` or `global`. Include one
  of these unless you want only jobs that name a region.
- `--jobage <days>`: posted within N days.
- `--page <n>`: 1-indexed page over the filtered results (page size = `--limit`).
- `--limit <n>` / `-n <n>`: results per page. Default 20.
- `--format json|table|plain`: default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/remoteok-search/cli/src/cli.ts detail <id|slug|url> [--format json|plain]
```

`id` is the numeric id from `search` results (e.g. `1137597`). A slug ending in the id
or a `remoteok.com/remote-jobs/...` URL also works. A URL on any other host (e.g. an
employer's apply link) is rejected with `BAD_ID`. The CLI looks the job up in the API
feed first (full description with paragraphs and lists, `origin: "api"`). If the job is no
longer in the feed, it reads the public job page instead (`origin: "page"`). The page adds
employment type, applicant-location requirements and `validThrough`, but its description
has weaker line breaks.

## Usage examples

```bash
# Remote web developer roles (test query), table view
bun run .agents/skills/remoteok-search/cli/src/cli.ts search -q "web developer" --format table

# Designer roles from the design tag, titles only, open worldwide or in Europe/EMEA/Türkiye
bun run .agents/skills/remoteok-search/cli/src/cli.ts search --tag design -q designer --title-only -l "worldwide,europe,emea,türkiye" --format table

# UI / graphic designer roles posted in the last 14 days
bun run .agents/skills/remoteok-search/cli/src/cli.ts search --tag design -q "graphic designer" --title-only --jobage 14 --format table

# Front-end / web developer roles with no location restriction
bun run .agents/skills/remoteok-search/cli/src/cli.ts search --tag "web dev" -q developer -l worldwide --format table

# Second page of a broad search, 10 per page
bun run .agents/skills/remoteok-search/cli/src/cli.ts search --tag design --limit 10 --page 2 --format table

# Full detail for one job
bun run .agents/skills/remoteok-search/cli/src/cli.ts detail 1137597 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, passing ids to `detail` |
| `table` | Quick human-readable scanning (with a Remote OK source footer) |
| `plain` | Reading a single job's full detail (`detail` command) |

Search JSON is `{ "meta": { "count", "page", "total", "source", "sourceUrl", "attribution" }, "results": [...] }`.
Each result has `id`, `title`, `company`, `location`, `date`, `url`, `tags`, `salaryMin`,
`salaryMax`, `source` (missing values are `null`, never omitted). `total` is the number
of matches before paging. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Feed size: the default feed is the ~100 latest jobs across all categories; a `--tag`
  feed is the 100 latest jobs with that tag. Thin results usually mean "add a `--tag`",
  not "no jobs".
- Tags are auto-assigned and noisy (an accountant posting can carry `design` and `dev`).
  Prefer `--title-only` for exact roles.
- Location is employer free text: `Remote`, a city, a country, `US`, sometimes junk such
  as `Time`. Read it as a hint, and check the description for hiring-region rules.
- Salary fields are as listed (Remote OK shows USD per year); `0` from the API becomes `null`.
- The API serves some text as UTF-8 bytes decoded as Latin-1 (`weâ€™re`). The CLI
  repairs this before output.
- `detail` costs one API request (~600 KB), plus one job-page request if the job has left the feed.
