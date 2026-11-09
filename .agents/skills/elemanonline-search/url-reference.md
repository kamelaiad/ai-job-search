# Eleman Online URL Reference

Public, unauthenticated pages on `https://www.elemanonline.com.tr` used by this skill
(recon 2026-11-09). The site is a Next.js app; each server-rendered page embeds its data in
`<script id="__NEXT_DATA__" type="application/json">`. The visible result list is rendered
client-side (the static HTML just says *"Gösterilecek kayıt bulunamadı"*), so the CLI parses
that JSON, not the card markup.

> Personal use only — `robots.txt` allows everything, but the terms of use forbid copying or
> redistributing content without written permission. Keep volume low.

## robots.txt

```
User-agent: *
Allow: /
```

Nothing disallowed. The honest UA `Mozilla/5.0 (compatible; elemanonline-cli/1.0)` gets
HTTP 200 on the homepage (~290 KB), search and detail pages. No Cloudflare challenge seen.

## Search

```
GET https://www.elemanonline.com.tr/is-ilanlari[/<province-slug>]?term=<q>&publishDate=<days>&page=<n>
```

| Param | Where | Meaning | Example |
|-------|-------|---------|---------|
| `<province-slug>` | path | Province, Turkish letters transliterated (ş→s, ı/İ→i, ğ→g, ü→u, ö→o, ç→c), spaces → `-` | `bursa`, `istanbul`, `istanbul-avrupa`, `izmir` |
| `term` | query | Free-text keyword | `grafik tasarım` |
| `publishDate` | query | Posted within N days (verified 1, 3, 7, 30) | `7` |
| `page` | query | 1-indexed page, 10 per page (fixed) | `2` |

Other filters the site supports but the CLI does not expose: `workingPreference` (1 İş Yerinde,
…), `workingType` (1 Tam Zamanlı, …), `jobType=IMMEDIATE` (urgent), `disabled=true`, `gender`,
`townId`. City+position path pages (`/is-ilanlari/izmir/muhasebe`) also exist.

**Unknown slug quirk:** a path slug that is not a province (e.g. `/is-ilanlari/atlantis`) is
not an error — the site treats it as a position slug, leaves `provinceId` null and searches
nationwide. The CLI checks `pageProps.query.provinceId` after the fetch and exits 1 with
`UNKNOWN_LOCATION` when a `--location` resolved to null.

### Response structure (`__NEXT_DATA__` → `props.pageProps`)

| Path | Meaning |
|------|---------|
| `query.provinceId` | Province the slug resolved to (`"16"` Bursa, `"34"` İstanbul), `null` if none |
| `jobs.jobs[]` | Result entries (parsed one by one; a malformed entry is skipped) |
| `jobs.jobsShowcase[]` | Sponsored showcase entries — not search matches, ignored |
| `jobs.totalItems` / `jobs.totalPages` / `jobs.currentPage` | Pagination |
| `provinces[]` | Full province list (`id`, `name`, `slug`) — 84 entries incl. İstanbul sides |

Per entry in `jobs.jobs[]`:

| Field | Source path |
|-------|-------------|
| id | `_id` (24 hex chars) |
| title | `position` |
| company | `company.title` (`company.slug` → `/firma/<slug>/<id>`) |
| location | `location[].townText` + `location[].provinceText` |
| date | `publishDate` (ISO 8601) |
| url | `https://www.elemanonline.com.tr` + `slug` (`/is-ilani/<title-slug>/<id>`) |
| workType | `workingTypeText` |
| salary | `salary` (usually null) |

## Detail

```
GET https://www.elemanonline.com.tr/is-ilani/<any-slug>/<id>
```

The slug is not checked — the CLI uses `/is-ilani/ilan/<id>`. An unknown id answers
**301 → `/is-ilanlari`**, so detail fetches with `redirect: "manual"` and treats a 3xx as
`NOT_FOUND`.

`__NEXT_DATA__` → `props.pageProps.job`:

| Field | Source path |
|-------|-------------|
| description | `content` (plain text with `\n`; run through `visibleHtml` if it carries tags) |
| employment type | `workingTypeText` (Tam Zamanlı, …) |
| work preference | `workingPreferenceText` (İş Yerinde, …) |
| department | `sdp[].departmentText` |
| gender / age | `genderText`, `minAge`, `maxAge` |
| status | `status` (`APPROVE` on live postings) |
| company | `company.title`, `company.about`, `company.slug` |

No deadline field. Applying requires a logged-in candidate account (`appStatus`), so there is
no external apply link.

## Notes

- No authentication required; no JSON API is needed (a GraphQL backend serves the pages, but
  the embedded page data is what the public pages expose).
- Respect rate limits — the CLI backs off on 429/5xx with jitter (max 6 retries).
