# isbul.net URL Reference

isbul.net publishes an official, documented **Agent API** for AI agents (recon 2026-11-09):

- Capability index: `GET https://www.isbul.net/api/agent`
- OpenAPI 3.1 spec: `https://www.isbul.net/api/agent/openapi.json`
- Docs: `https://www.isbul.net/llms-full.txt` ("Public REST API", "Fair Use" sections)
- Plugin manifest: `https://www.isbul.net/.well-known/ai-plugin.json`

Public, unauthenticated, JSON. The honest UA `Mozilla/5.0 (compatible; isbul-cli/1.0)` gets
HTTP 200; no bot challenge seen.

> Personal use only — the site's terms forbid copying or redistributing its content without
> written permission. Keep volume low.

## robots.txt (User-agent: *)

```
Allow: /api/agent
Allow: /api/agent/*
Allow: /.well-known/
Disallow: /api/
Disallow: /auth/
Disallow: /profilim
Disallow: /ozgecmis-goruntule
Disallow: /*?query=
Disallow: /*&query=
```

`/api/agent/*` is the longer (more specific) match, so it wins over `Disallow: /api/`. The
API's keyword parameter is `q`, which the `query=` rules do not match. The CLI never calls the
website's own search (`?query=`), nor anything outside `/api/agent/jobs`.

## Fair use (from llms-full.txt)

- `per_page` ≤ 25 (the CLI always sends 25, the max, so one request per page)
- Cache responses for at least 60 seconds (the CLI is one-shot; don't loop it)
- Avoid parallel bulk scraping

## Search

```
GET https://www.isbul.net/api/agent/jobs?q=<text>&city=<slug>&page=<n>&per_page=25
```

| Param | Meaning | Example |
|-------|---------|---------|
| `q` | Full-text search (Turkish or English) | `grafik tasarım` |
| `city` | City slug, Turkish letters transliterated (ş→s, ı/İ→i, ğ→g, ü→u, ö→o, ç→c) | `istanbul`, `bursa`, `izmir` |
| `category` | Position/category slug (not exposed by the CLI) | `garson` |
| `page` | 1-indexed page | `2` |
| `per_page` | Page size, default 10, max 25 | `25` |

No posting-age or sort parameter exists; results are relevance-ordered. The CLI implements
`--jobage` client-side on `published_at`.

An unknown filter value answers **HTTP 400**:
`{"error":"unknown_filter_value","parameter":"city","value":"…","message":"…"}`. The CLI maps
`parameter: "city"` to `UNKNOWN_LOCATION` and builds its own message from `parameter`/`value`
(the free-text `message` is not relayed).

### Response structure

| Path | Meaning |
|------|---------|
| `data[]` | Listings (parsed one by one; a malformed entry is skipped) |
| `data[].id` | UUID |
| `data[].title` | Title |
| `data[].company` / `company_slug` | Company name / slug |
| `data[].city` / `district` | Location (`null` for remote / nationwide listings) |
| `data[].published_at` / `expires_at` | ISO 8601 |
| `data[].url` | `https://www.isbul.net/is-ilani/<slug>` (the CLI rebuilds it from `slug` if it points elsewhere) |
| `data[].work_type` | Tam Zamanlı, Yarı Zamanlı, Uzaktan, Hibrit, Freelancer… |
| `data[].position` / `sector` / `salary` | Strings or null |
| `meta.current_page` / `last_page` / `per_page` / `total` | Pagination; `from`/`to` are null past the last page |

## Detail

```
GET https://www.isbul.net/api/agent/jobs/<id-or-slug>
```

Returns `{ "data": { … }, "source": "isbul.net" }` with the search fields plus
`description` (plain text, line breaks flattened to one paragraph), `education_level`,
`experience_level`, `vacancy_count`, `status` (`published | pending_update | pending | draft |
passive | archive | rejected`) and `is_open` (true only for `published`). Closed listings are
returned with HTTP 200 — check `is_open`. An unknown id/slug answers **404**
(`{"error":"Failed to fetch job detail",…}`) → `NOT_FOUND`.

## Notes

- Other endpoints (`/api/agent/companies`, `/api/agent/calculators`) are not used.
- Per llms-full.txt, job pages on the website (`/is-ilani/<slug>`) carry `JobPosting` JSON-LD, a fallback if the
  API ever goes away (allowed by robots.txt).
- Respect rate limits — the CLI backs off on 429/5xx with jitter (max 6 retries).
