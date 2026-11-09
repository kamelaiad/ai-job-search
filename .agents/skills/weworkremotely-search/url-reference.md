# We Work Remotely URL Reference

Public RSS feeds used by this skill. We Work Remotely is a worldwide remote-only board,
so the same feeds serve every market. Recon: 2026-11-09.

> robots.txt: `User-agent: *` → `Allow: /`. Disallowed: `/admin/`, `/account/`,
> `/job-seekers/account/`, `/job-seekers/profile/`, `/manage-company/`,
> `/*edit?token=/`, `/*cancel?token=/`. No crawl delay.
> **Terms of Service: not verified.** `/terms-of-service` (like every HTML page) answers
> the honest UA, and WebFetch, with a Cloudflare challenge (HTTP 403, "Just a moment...").
> SKILL.md therefore carries a personal-use-only warning.

## What is reachable (honest UA `Mozilla/5.0 (compatible; weworkremotely-cli/1.0)`)

| URL | Result |
|-----|--------|
| `/remote-jobs.rss` | 200 `application/rss+xml`, ~2.2 MB, 100 items |
| `/categories/<slug>.rss` | 200 `application/rss+xml` |
| `/robots.txt` | 200 |
| `/` (home), `/remote-jobs/search?term=...`, `/remote-jobs/<slug>`, `/sitemap.xml`, `/terms-of-service` | **403 Cloudflare challenge.** Not used; the CLI never retries with browser headers |

## Search: RSS feeds

```
GET https://weworkremotely.com/remote-jobs.rss                   # 10 newest per category
GET https://weworkremotely.com/categories/<slug>.rss             # all current jobs in a category
```

| CLI alias | Feed slug | Items (2026-11-09) |
|-----------|-----------|--------------------|
| `design` | `remote-design-jobs` | 17 |
| `full-stack` | `remote-full-stack-programming-jobs` | 104 |
| `front-end` | `remote-front-end-programming-jobs` | 10 |
| `back-end` | `remote-back-end-programming-jobs` | 13 |
| `programming` | `remote-programming-jobs` | 25 (overlaps full-stack/back-end) |
| `devops` | `remote-devops-sysadmin-jobs` | 32 |
| `product` | `remote-product-jobs` | 29 |
| `customer-support` | `remote-customer-support-jobs` | 84 |
| `sales-marketing` | `remote-sales-and-marketing-jobs` | 134 |
| `management-finance` | `remote-management-and-finance-jobs` | 59 |
| `other` | `all-other-remote-jobs` | 99 |

The union of the category feeds (575 unique jobs) contains every all-jobs-feed item.
There are no query, location, date or paging parameters. The CLI filters `--query`,
`--location` and `--jobage` and pages the results client-side, de-duplicating by slug
across feeds.

## Item structure (RSS 2.0, no CDATA, no `media:` elements)

| Element | Notes |
|---------|-------|
| `<title>` | `Company: Job title`, XML-escaped (`&amp;`). Split on the first `": "` |
| `<link>` / `<guid>` | `https://weworkremotely.com/remote-jobs/<slug>` → result `id` = slug, `url` |
| `<region>` | `Anywhere in the World`, `USA Only`, `Europe Only`, `Latin America Only`, `North America Only`, ... |
| `<country>` | Often empty; flag + name list, e.g. `🇹🇷 Türkiye` or `🇫🇷 France, 🇩🇪 Germany, and 🇬🇧 ...` |
| `<state>` | Often empty; US state names |
| `<skills>` | Comma list, last item prefixed `and ` |
| `<category>` | Display name, e.g. `Design`, `Full-Stack Programming` |
| `<type>` | `Full-Time`, `Contract` |
| `<description>` | Full HTML, escaped **once** at the XML level. Starts with a logo `<img>` and a `<p>` holding `<strong>Headquarters:</strong> ...<br /><strong>URL:</strong> <a ...>`; ends with `<p><strong>To apply:</strong> <a href="https://weworkremotely.com/remote-jobs/<slug>">` |
| `<pubDate>` | RFC 822; renewed posts keep the original date |
| `<expires_at>` | RFC 822 |

Decoding order matters. XML-decode the element **once** (giving HTML), then run
`visibleHtml`, strip tags and HTML-decode **once**. Both decoders are single-pass, so
`&amp;lt;` ends up as the text `&lt;` → `<`, never decoded twice in one step.

## Detail

No fetchable job page. `detail <slug>` finds the RSS item: the all-jobs feed first, then
each category feed (or only the `--category` feeds given). The description comes from
the item; `headquarters` is parsed from the header paragraph.

## Notes

- Requests within one run are spaced ≥ 1 s. 429/5xx: exponential backoff from 1 s with
  jitter, max 6 retries, `Retry-After` honored within a 30 s budget. 404: `null`. 403:
  fails without escalation.
- A body that is not RSS (e.g. a challenge page) fails loudly; it is never treated as zero results.
