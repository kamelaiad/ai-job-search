# Remote OK URL Reference

Public, unauthenticated endpoints used by this skill. Remote OK is a worldwide
remote-only board, so the same endpoints serve every market. Recon: 2026-11-09.

> **API terms** (element `[0]` of every API response, field `legal`): link back to the
> job's URL on Remote OK and mention Remote OK as the source, or API access is
> suspended; do not use the Remote OK logo without written permission (using the name
> is fine). robots.txt: `User-agent: *` → `Allow: /`, `Crawl-delay: 1`,
> `Content-Signal: search=yes,ai-train=no,use=reference`. Disallowed: `/@*` (profiles),
> `/*?action=get_jobs`, `/*?url=`, `/?tags`, `/l/`, `/track-ad`. `/llms.txt` says the
> same: cite with a link back, respect robots.txt and the crawl delay.

## Search: JSON API

```
GET https://remoteok.com/api
GET https://remoteok.com/api?tag=<tag>
```

| Param | Meaning | Example |
|-------|---------|---------|
| `tag` | One Remote OK tag. Spaces or hyphens both work. `?tags=` behaves the same. | `design`, `web-dev`, `web%20dev`, `front-end`, `javascript` |

There are **no** keyword, location, date or pagination parameters: `?page=2` returns
the same response as page 1. An unknown tag (e.g. `web developer`) returns only the legal
element. The CLI therefore filters `--query`, `--location` and `--jobage` and pages the
results client-side.

Response: `application/json`, a JSON array.

- `[0]`: `{ "last_updated": <epoch>, "legal": "<API terms text>" }`. Not a job; skipped.
- `[1..]`: jobs, newest first. ~99 in the default feed, 100 in a tag feed.

| Field | Notes |
|-------|-------|
| `id` | Numeric string, e.g. `"1137703"` → result `id` |
| `slug` | `remote-<title>-<company>-<id>` → result `url` = `https://remoteok.com/remote-jobs/<slug>` |
| `position` | Job title (sometimes contains newlines or entities) |
| `company` | Company name (may contain `&amp;`) |
| `location` | Free text; `""` for ~half the jobs (job page shows "Anywhere") |
| `date` / `epoch` | ISO 8601 / Unix seconds |
| `tags` | Array of lower-case tags, auto-assigned, noisy |
| `description` | Full HTML description |
| `salary_min` / `salary_max` | Numbers; `0` = not given |
| `url` / `apply_url` | Both `https://remoteOK.com/remote-jobs/<slug>` (mixed-case host) |
| `logo` / `company_logo` | Usually empty; not output |

**Encoding quirk:** text fields contain UTF-8 bytes decoded as Latin-1
(`weâ\u0080\u0099re` for "we’re", `MÃ¼nchen` for "München").
`fixMojibake()` re-decodes complete UTF-8 byte runs. It must run before
`stripInvisible()`, because that step deletes the C1 bytes (`\u0080-\u009f`) the repair needs.

## Detail

1. **API feed** (`GET /api`): find the element whose `id` matches. Its HTML
   `description` keeps paragraphs and lists. Covers every job in the current default feed.
2. **Job page** (fallback): `GET https://remoteok.com/remote-jobs/<id>` returns 301 to
   `/remote-jobs/<slug>`, then 200 `text/html`. An unknown id returns 404.
   - `<script type="application/ld+json">` with `"@type": "JobPosting"`: `title`,
     `hiringOrganization.name`, `datePosted`, `employmentType` (`FULL_TIME`),
     `baseSalary.value.minValue/maxValue`, `validThrough`,
     `applicantLocationRequirements[].name` (e.g. `Anywhere`). Its `description` is
     **truncated** (~1000 chars) with tags removed.
   - Full description: inside `<div class="description" itemprop="description">`, either
     `<div class="html">` (markup with `<br>` breaks) or `<div class="markdown">`
     (paragraph tags already removed, so sentences run together, e.g. `come.This`). A
     literal `\n\n#Salary and compensation\n` footer and an "Upgrade to Premium" line
     follow it.
   - `<link rel="canonical">` gives the slug URL.

## Notes

- Behind Cloudflare. The honest UA `Mozilla/5.0 (compatible; remoteok-cli/1.0)` gets
  HTTP 200 on `/api`, `/robots.txt`, `/llms.txt` and job pages.
- The CLI enforces the 1 s crawl delay with a timestamp file in the OS temp dir
  (`remoteok-cli-last-request`), so back-to-back invocations stay spaced.
- 429/5xx: exponential backoff from 1 s with jitter, max 6 retries, `Retry-After` honored
  within a 30 s budget. 404: `null`, leading to `NOT_FOUND`. 403: fails without retrying with
  browser headers.
