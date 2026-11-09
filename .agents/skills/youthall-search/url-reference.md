# Youthall URL Reference

Public, server-rendered HTML pages on `www.youthall.com`. No JSON API backs the
listing (the only XHR on the page is a stats ping). Recorded 2026-11-09.

> Personal use, low volume. `robots.txt` (`User-agent: *`) is `Allow: /` and, per its
> own comments, deliberately no longer disallows the listing filters (`?city`, `?type`,
> `?query`, ...); only tracking params (`/*?v331`, `/*?hl`, `/*?trk`), login,
> password-reset, email-verify and `/crm` paths are disallowed. `Claude-User` and other
> AI-assistant agents are explicitly allowed; model-training crawlers are blocked.
> The user agreement forbids disproportionate load.

## Search

```
GET https://www.youthall.com/tr/is-ilanlari/[<city-slug>/]?query=<q>&type[]=<type>&page=<n>
```

`/tr/jobs/` redirects here. The English twin is `/en/jobs/`.

| Param | Meaning | Example |
|-------|---------|---------|
| `query` | Keywords (position, company, keyword; max 180 chars) | `tasarım` |
| `<city-slug>` path segment | City facet page; 404 for an unknown slug | `istanbul`, `ankara`, `izmir`, `eskisehir` |
| `city[]` | City filter by numeric id (alternative to the path; ids only listed for cities with open postings, e.g. 1 İstanbul, 23 Bursa, 52 Kocaeli) | `1` |
| `type[]` | Listing type, repeatable | `internship`, `mt_internship`, `new_graduated`, `young_professional`, `professional`, `full_time`, `part_time`, `contract`, `periodic`, `project_based`, `freelance`, `volunteer`, `scholarship` |
| `careerLevel[]` | Student year / experience (not exposed by the CLI) | `fourth_year`, `bachelor_graduate`, `experience_0_1` |
| `department[]`, `employee[]` | Department / company size (not exposed) | |
| `order` | `1` newest first (default), `2` oldest first, `3` deadline soonest | `1` |
| `page` | 1-indexed, 18 results per page | `2` |

There is **no posting-age parameter**.

### Response structure

Each result is rendered three ways: a "featured" carousel (`div.jobs`, ignores the
query), a grid card (`#internshipsGrid div.jobs`) and a list row. The CLI uses only the
list rows:

- Region: from `id="internshipsList"` to `<ul class="pagination"` / `class="c-jobs-empty"`.
- One card per `<div class="jobs-row">`:
  - URL: `<a href="https://www.youthall.com/<tr|en>/<companySlug>/<postingSlug>/" class="jobs-row__link">`
  - Company: `<span class="jobs-row__company">`
  - Title: `<div class="jobs-row__title"> ... <h5>`
  - Teaser: `<div class="jobs-row__desc">`
  - Tags (`<div class="jobs-tag">`), identified by icon: `fa-briefcase` = listing type
    ("Stajyer", "Tam Zamanlı", "Management Trainee"...), `far fa-clock` = **application
    deadline** `DD.MM.YYYY`, `fa-map-marker-alt` = first city (a trailing `+` means more
    cities; hybrid postings may show "Hibrit" instead of a city).
- No posting date and no total count on the page. Next page: `<a class="page-link" rel="next">`.
- Empty result: `<div class="c-jobs-empty">` ("Şu an açık ilan yok").

## Detail

```
GET https://www.youthall.com/tr/<companySlug>/<postingSlug>/
```

The `_<n>` suffix on the posting slug is a per-company counter, so the CLI id is the
two-segment path `<companySlug>/<postingSlug>`. English postings redirect from `/tr/`
to `/en/`; labels switch language with them.

- JSON-LD `<script type="application/ld+json">` `@type: JobPosting` (valid JSON):
  `title`, `description` (HTML), `datePosted` (`YYYY-MM-DD`), `validThrough`,
  `employmentType` (`INTERN`, `FULL_TIME`...), `hiringOrganization.name`,
  `identifier.value` (internal id), `jobLocation[]`, `jobLocationType`. The CLI takes
  only the validated dates and `employmentType` enum from it.
- Visible header: `<div class="c-job_info_title">` → `<h1>` company, `<h2>` title.
- Description: first `<div class="c-job_post_content">`; a second one (under
  "İşe Alım Süreci") holds the hiring-process `<ol><li>` steps.
- Sidebar: `<h6>label</h6> ... <small>value</small>` pairs — `Departman`/`Job function`,
  `İlan Türü`/`Type`, `Yayınlanma Tarihi`/`Posted Date`, `Son Başvuru`/`Application
  Deadline`, `Maaş`/`Salary`, `Çalışma Lokasyonları`/`Working Locations` (comma list).
- Apply: `<a href="/tr/internship/<internalId>/apply/">` (requires a Youthall account).
- Expired or unknown postings: 404.

## Notes

- No authentication for search or detail.
- The CLI sends `User-Agent: Mozilla/5.0 (compatible; youthall-cli/1.0)` and backs off on 429/5xx.
- Also available but unused: `/sitemap.tr-jobs.xml` (posting URLs with `lastmod`, not the posting date).
