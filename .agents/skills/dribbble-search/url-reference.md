# Dribbble Jobs URL Reference

Public, unauthenticated, server-rendered HTML pages used by this skill. Recorded from live
responses on 2026-11-09 with the CLI's own User-Agent
(`Mozilla/5.0 (compatible; dribbble-cli/1.0)`): HTTP 200, no bot challenge, no login wall.

> Personal use only. Dribbble's Terms of Service (section 7) prohibit scraping and automated
> access faster than a person browsing; keep volume low.

## Access rules

- `robots.txt` (`User-agent: *`) does **not** disallow `/jobs` or `/jobs/<id>`.
  It **does** disallow `/jobs/*/apply_now` (plus `/autocompletes/*`, `/*/listings$`,
  `/sessions/new`, `/messages/*`, `/talent/matches/*`, ...). The CLI never requests an apply
  link and only prints it.
- No JSON API backs the board: the listing has no `__NEXT_DATA__` and no XHR "load more";
  the job-board JS (`job-search-*.js`) only wires up the filter form. A `CaptchaSiteKey` config
  value appears in every page; it is not a block page.

## Search

```
GET https://dribbble.com/jobs
```

Query params (names taken from the board's own filter form, `form#options`):

| Param | Meaning | Example |
|-------|---------|---------|
| `keyword` | Literal phrase matched against the whole posting text (title, company, description) | `product designer` |
| `location` | Free-text location, geocoded by Dribbble | `London` · `Berlin` · `Istanbul` |
| `anywhere` | `true` = "Open to remote": remote-only and remote-friendly postings only; overrides `location` | `true` |
| `specialty_ids[]` | Repeatable, OR'ed. 1 Animation · 2 Brand / Graphic Design · 3 Illustration · 4 Leadership · 5 Mobile Design · 6 UI / Visual Design · 7 Product Design · 8 UX Design / Research · 9 Web Design | `6` |
| `fulltime` | `true` = full-time only | `true` |
| `freelance_or_contract` | `true` = freelance/contract only | `true` |
| `page` | Server-side page, 1-indexed. The whole board (~46 postings) fit on page 1; `page=2` returned the no-results page | `2` |

There is **no posting-age parameter**; the CLI's `--jobage` filters client-side on the
card's relative age. Listings expire after 30 days.

Verified behaviour (2026-11-09): `keyword=product designer` → 11 cards; `keyword=UI designer`
→ 0; `keyword=UI` → 45 of 46; `location=London` → 1; `location=Turkey` → 0;
`location=London&anywhere=true` → the 31 remote cards and not the London on-site one;
`specialty_ids[]=6` → 4; `keyword=product designer&specialty_ids[]=7&fulltime=true` → 7.

### Response structure

Results live in `<ol class="job-board-job-list">`, one card per
`<li class="job-list-item ...">` (no results → `<p class="no-results-text">` instead). The CLI
runs `visibleHtml` over the page, splits on the `<li ... job-list-item` opening tag, and parses
each chunk independently:

| Field | Anchor |
|-------|--------|
| id + slug | `<a class="job-link" href="/jobs/<id>-<Slug>?source=index">` (also the "View job" button `href="/jobs/<id>-<Slug>"`) |
| title | `<h4 class="job-title job-board-job-title">` |
| company | `<span class="job-board-job-company">` (featured cards add a tooltip "Featured listing posted by ..." next to it - not part of the name) |
| location | `<span class="location">` in `.job-additional-details-container`; fallback `.job-details--mobile .location-container` |
| remote badge | `.job-details--mobile` holds a separate `<div class="color-deep-blue-sea-light-40">Remote</div>` on remote-only/remote-friendly cards (the CLI checks for a non-location child div whose text is exactly "Remote") |
| posted | `<div class="posted-on hide-on-mobile">Posted 3 days ago</div>` (Rails `time_ago_in_words`: "about 12 hours ago", "1 day ago", "30 days ago", "about 1 month ago") |
| featured | `job-list-item--boosted` class on the `<li>` |

Apply buttons on cards are `<button data-signup-trigger="true">` (sign-up modal), not links.

## Detail

```
GET https://dribbble.com/jobs/<id>
```

The bare numeric ID works (HTTP 200, no redirect); the canonical URL is
`/jobs/<id>-<Slug>`. An unknown ID returns a page without a posting (CLI: `NOT_FOUND`).

| Field | Anchor |
|-------|--------|
| title | `<h1 class="margin-t-16 job-details-title">` |
| description | `<div class="margin-t-16 job-details-description">` (rich HTML: `p`, `h2`, `ul/ol/li`, `strong`, `a`) |
| company | `.sidebar-content-container .organization-name` |
| company website | `<a ...>Visit Website</a>` in the sidebar header |
| job type / location / date | sidebar blocks `<div class="font-sublabel">Job Type|Location|Date posted</div>` followed by `<div class="font-label margin-t-8">` values; Location may add a second value "Remote Friendly"; date is `Nov 05, 2026` |
| canonical slug | the "Copy" share link `href="/jobs/<id>-<Slug>"` |
| location type | inline script `Dribbble.JobListing.initialize({ locationType: "remote_only" | "onsite_only" | "onsite_or_remote" | "remote_option", ... })` |
| apply link | same script, `job_apply_link: "/jobs/<id>-<Slug>/apply_now"` (disallowed by robots.txt: printed, never fetched) |
| structured data | `<script type="application/ld+json">` `JobPosting`: `datePosted`, `validThrough` (posted + 30 days), `employmentType` (`FULL_TIME`, ...), `hiringOrganization`, `jobLocation`, `jobLocationType` |

The CLI takes every text field from the visible page. Scripts and ld+json are read only for
strictly validated values: ISO dates (`datePosted` fallback, `validThrough`), the
`locationType` enum, `employmentType` enum fallback, and an apply path matching
`/jobs/<digits>[-slug]/apply_now`.

Quirk: the posting page includes a full "Related Jobs" card list **inside an HTML comment**
(`<!-- <div class="related-jobs-container"> ... -->`). `visibleHtml` drops it, so those cards
are never mistaken for the posting or for search results.

## Notes

- No authentication required; one request per CLI call.
- The CLI backs off exponentially (with jitter) on 429/5xx, max 6 retries; 404 → `NOT_FOUND`.
- Country-agnostic: `location` takes any place; most postings are US/EU or remote.
