# Techcareer.net URL Reference

Public, unauthenticated pages used by this skill. Recorded from live responses on
2026-11-09. Techcareer is a Next.js app: every page is server-rendered with a
`<script id="__NEXT_DATA__" type="application/json">` payload, and that payload is the
data source. The rendered job cards have no links or dates of their own (they are
click handlers), so there is nothing useful to scrape from the visible markup.

Inside the payload, Next.js escapes `<`, `>` and `&` as `<`, `>` and `&`,
so description HTML cannot close the `<script>` element early.

## robots.txt (User-agent: *)

Disallows only `*/clkn/*`, `*/clkg/*` and `*?lpt=*`. `/jobs` and `/jobs/detail/*` are
allowed. Sitemaps: `/sitemap-jobs.xml` lists `/jobs/detail/<slug>` and
`/jobs/positions/<position-slug>` URLs, but its `lastmod` is the sitemap's generation
time for every entry, not a posting date.

## Search

```
GET https://www.techcareer.net/jobs?jobs[search][keyword]=<kw>&jobs[search][location]=<city>&jobs[page]=<n>
```

The query string is `qs`-style (the front end uses `qs.stringify` with
`arrayFormat: "comma"`). Brackets may be percent-encoded (`jobs%5Bsearch%5D%5Bkeyword%5D`).

| Param | Meaning | Example |
|-------|---------|---------|
| `jobs[search][keyword]` | Free-text keyword (title/skill). Loose matching | `frontend`, `yazılım` |
| `jobs[search][location]` | City, free text, diacritics optional | `İstanbul`, `istanbul`, `Ankara` |
| `jobs[page]` | 1-indexed page, 20 per page (fixed) | `1`, `2` |
| `jobs[search][select]` | Search mode for the keyword box (default `position`) | not used |
| `jobs[filters][workPlace]` etc. | Workplace / type-of-work / experience filters. Values are numeric IDs from an internal `/bff/jobs/job-filter-options` call | not used |
| `q` | **Ignored** by the site: returns the whole board | do not use |

There is **no posting-age / date filter and no sort parameter**. Results are newest
first (by internal id) for keyword searches. Location-only searches may surface a few
older postings first.

### Response: `props.pageProps`

| Path | Notes |
|------|-------|
| `initialJobList` | `null` when nothing matches |
| `initialJobList.pagination` | `{ page, pageCount, pageSize: 20, total }` |
| `initialJobList.jobListItems[]` | One object per posting (fields below) |
| `searchIdData.totalPage` | Despite the name, the total posting count (unused) |
| `initialJobDetail` | Full detail of the first list item (unused) |
| `positionsData` | Facet counts by normalised position (unused) |

Per-item fields (`jobListItems[i]`):

| Field | CLI field | Notes |
|-------|-----------|-------|
| `slug` | `id` | e.g. `back-end-developer-4491449`. Ends in the Kariyer.net posting number. May contain `.` |
| `title` | `title` | Plain text (rendered by React as text) |
| `owner.name` | `company` | Replaced by `hiddenCompanyInfo` (or null) when `isCompanyHidden === true` |
| `location` | `location` | e.g. `İstanbul(Avr.) / Türkiye`, `Antalya / Türkiye` |
| `otherLocations` | `otherLocations` | Number of further cities (an array of names in the detail payload) |
| `workPlaces[]` | `workplace` | `İş Yerinde` (on-site), `Hibrit`, `Uzaktan` (remote) |
| `jobTitle` / `jobTitleEn` | `position` | Portal's normalised position (Turkish / English) |
| `applyLink` | `applyUrl` | External apply link, usually `""` |
| `id` | (unused) | Internal Techcareer id, not addressable |
| *(none)* | `date` | **No date in list items**. Always `null` |

## Detail

```
GET https://www.techcareer.net/jobs/detail/<slug>
GET https://www.techcareer.net/en/jobs/detail/<slug>   (English UI, same data)
```

An unknown or expired slug, or a bare number (`/jobs/detail/4491449`), answers
`307 → /jobs`. The CLI follows redirects and treats any page whose `__NEXT_DATA__.page`
is not `/jobs/detail/[jobSlug]` as `NOT_FOUND`.

`props.pageProps.jobDetail`:

| Path | CLI field | Notes |
|------|-----------|-------|
| `head.title` | `title` | |
| `head.slug` | `id` | |
| `head.company.name` (`owner.name`) | `company` | `isCompanyHidden` / `hiddenCompanyInfo` as in search |
| `head.location` | `location` | |
| `head.otherLocations[]` | `otherLocations` | Array of city strings |
| `head.startDate` | `date` | ISO timestamp (`2026-06-29T00:00:00.000Z`) → `YYYY-MM-DD` |
| `head.endDate` | `deadline` | Application deadline, same format |
| `head.workPlaces[]` | `workplace` | |
| `head.typeOfWorks[]` | `employmentType` | e.g. `Tam Zamanlı` |
| `head.yearsOfExperiences[]` | `experience` | e.g. `Deneyim: 4-6 Yıl` |
| `head.positionLevels[]` | `positionLevel` | Often empty |
| `head.jobTitle` | `position` | |
| `head.applyLink` | `applyUrl` | `null` = apply on Techcareer/Kariyer.net |
| `head.isCompleted`, `head.isDisabledJob` | `isActive` | Inactive if either is true or the deadline has passed |
| `content.description` | `description` | **HTML**. Run through `visibleHtml`, line breaks kept at `<br>`/block ends, `<li>` → `• ` |
| `content.skills[]` | `skills` | Strings |
| `content.languages[]`, `content.educationLevels[]` | `languages`, `educationLevels` | Strings (often empty) |
| `owner.description` | (unused) | Employer marketing blurb (HTML) |

## Not used

- `/bff/jobs/job-list`, `/bff/jobs/job-detail`, `/bff/jobs/job-filter-options`: internal
  JSON endpoints the front end calls through its own API client (a probe of the
  same-origin `/bff/jobs/job-filter-options` path answered 404). The server-rendered
  pages carry the same data.
- `/sirketler/<slug>`: company pages exist only for featured employers. Job payload
  company slugs (`...-445875`) do not map to them, so no `companyUrl` is emitted.

## Notes

- No authentication required to read. Applying needs a Kariyer.net/Techcareer account.
- The CLI backs off on 429/5xx (max 6 retries, jitter) and returns `""` on 404.
- Page weight: search pages are about 260-430 KB and detail pages about 200 KB.
