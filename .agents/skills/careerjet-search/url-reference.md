# Careerjet Türkiye: URL and API reference

Recon date: 2026-11-09. Everything below was read from Careerjet's own pages or observed in
live responses on that date. Re-check it here first when the CLI starts failing.

## Data source decision

| Route | Status | Why |
|-------|--------|-----|
| careerjet.com.tr HTML search (`/arama/isler?s=<q>&l=<place>`) | **Not used** | Returns HTTP 200 with a Cloudflare Turnstile page ("Doğrulama gerekli": unusual traffic, prove you are not a robot) instead of results for the honest UA `Mozilla/5.0 (compatible; careerjet-cli/1.0)`. The homepage `/` does the same. Bypassing a bot challenge is out of scope for portal skills. |
| careerjet.com.tr job pages (`/job/`, `/jobview/`, `/jobviewx/`, `/jobviewex/`, `/clk/`, `/apply/`) | **Not used** | Disallowed for `User-agent: *` in robots.txt. |
| Legacy API `http://public.api.careerjet.net/search` | **Not used** | Without credentials it answers 403 "Undeclared referrer. Please add a Referer header so we know who is calling this API and from which page." It expects a publisher page and affiliate id. Superseded by v4. |
| **v4 API `https://search.api.careerjet.net/v4/query`** | **Used** | Careerjet's documented partner API (https://www.careerjet.com/partners/api). Needs a free publisher API key. |

robots.txt notes:
- `www.careerjet.com.tr/robots.txt` (`User-agent: *`) disallows `/my/`, `/job/`, `/jobview/`,
  `/jobviewx/`, `/jobviewex/`, `/clk/`, `/clicks/`, `/apply/`, `/apply2/`, `/search/query.html`,
  `/search/rss.html`, `/partners/js*.html`, `/partners/remote.html`, and any URL carrying the
  query parameters `ct`, `cp`, `cmp`, `ay`, `nw`, `p` (pagination), `cs`, `css`, `csl`, `radius`,
  `sort`, `cc`. `/arama/` (search) and `/partners/api` (docs) are not disallowed.
- `search.api.careerjet.net/robots.txt` and `public.api.careerjet.net/robots.txt` are
  `User-agent: * / Disallow: /`. These are API hosts. The robots file keeps crawlers out,
  while access by key holders is what the partner documentation describes. The CLI only
  calls the documented endpoint, with a key, at low volume.

## Search endpoint

```
GET https://search.api.careerjet.net/v4/query?locale_code=tr_TR&keywords=<q>&location=<place>&page=<n>&page_size=20&fragment_size=1500&user_ip=<ip>&user_agent=<ua>
Authorization: Basic base64("<API_KEY>:")
User-Agent: Mozilla/5.0 (compatible; careerjet-cli/1.0)
Accept: application/json
[Referer: $CAREERJET_REFERER]   (only if set)
```

Authentication: HTTP Basic, username = API key, password = empty string. The key comes from
`CAREERJET_API_TOKEN` only.

### Parameters (from the official docs)

| Parameter | Values | CLI flag / source | Notes |
|-----------|--------|-------------------|-------|
| `locale_code` | `<lang>_<COUNTRY>` | fixed `tr_TR` | Selects the Türkiye index (careerjet.com.tr). Defaults to `en_GB` if omitted. 400 "Unsupported locale code" if invalid. |
| `keywords` | string | `--query` / `-q` | One or more search terms. |
| `location` | string | `--location` / `-l` | Omitted = country-wide. May trigger "location mode" (see below). |
| `contract_type` | `p` permanent, `c` contract, `t` temporary, `i` internship, `v` volunteering | `--contract permanent\|contract\|temporary\|internship\|volunteer` | |
| `work_hours` | `f` full-time, `p` part-time | `--hours full\|part` | |
| `fragment_size` | integer | fixed `1500` | Excerpt length in characters (default 120). The long excerpt is what `detail` returns. No documented maximum. |
| `sort` | `relevance`, `date`, `salary` | `--sort`; `date` is implied by `--jobage` | Default `relevance`. |
| `offset` | 1-999 | not used | |
| `page` | 1-10 | `--page` | The CLI rejects values above 10. |
| `page_size` | 1-100 (default 20) | fixed `20` | |
| `radius` | integer (km/miles) | not exposed | Default 5. |
| `user_ip` | string | `$CAREERJET_USER_IP`, else `127.0.0.1` | **Required**: the end user's IP. Missing → 403 "Missing param user_ip or user_agent". Whether the API accepts the loopback default is unverified (no key at build time). |
| `user_agent` | string | the CLI's own UA | **Required**: the end user's user agent. |

There is **no posted-within (age) parameter**. `--jobage` sorts by date and filters client-side
on the parsed `date`.

## Response structure

Success (HTTP 200, JSON):

```json
{
  "type": "JOBS",
  "hits": 62,
  "message": "62 matching jobs found",
  "pages": 4,
  "response_time": 0.322,
  "jobs": [
    {
      "title": "Python Developer",
      "company": "NBC",
      "date": "Wed,15 Nov 2025 19:13:43 GMT",
      "description": "Job description excerpt",
      "locations": "London",
      "salary": "$30000 - 33000",
      "salary_currency_code": "USD",
      "salary_max": 33000.0,
      "salary_min": 30000.0,
      "salary_type": "Y",
      "url": "https://jobviewtrack.com/v2/<unique link>"
    }
  ]
}
```

(The example is from Careerjet's docs. Note the date has no space after the comma; the CLI
normalises that.) `salary_type`: `Y` yearly, `M` monthly, `W` weekly, `D` daily, `H` hourly.

Field mapping → CLI result:

| API field | CLI field | Cleaning |
|-----------|-----------|----------|
| `title` | `title` | visibleHtml → strip tags → decode entities → stripInvisible. A job without a title is skipped. |
| `company` | `company` | same; `null` if empty |
| `locations` | `location` | same; `null` if empty |
| `date` | `date` | RFC-1123 → `YYYY-MM-DD` (UTC); `null` if unparseable |
| `url` | `url` | must be `http(s)`; a job without one is skipped |
| `description` | `snippet` (search, ≤240 chars) / `description` (detail) | line breaks kept for detail |
| `salary`, `salary_min`, `salary_max`, `salary_currency_code`, `salary_type` | `salary`, `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod` | |
| (none) | `id` | `cj-` + first 16 hex chars of SHA-1(lowercased title, company, location, date) |

Each job object is parsed independently. A malformed entry is dropped and the rest survive.
Exact duplicates (same id) are collapsed.

### Location mode (HTTP 200, not an error, but no search happens)

```json
{ "type": "LOCATIONS", "locations": [], "message": "no matching location found", "response_time": 0.11 }
{ "type": "LOCATIONS", "locations": ["choice 1", "choice 2"], "message": "multiple locations found", "response_time": 0.11 }
```

The CLI exits 1 with `LOCATION_NOT_FOUND` or `AMBIGUOUS_LOCATION` (listing the candidates).

### Errors (observed live 2026-11-09 unless noted)

| HTTP | Body | CLI code |
|------|------|----------|
| 401 | `{"error": "You did not provide an API key. ...", "type": "ERROR"}` | (never sent: the CLI exits `MISSING_CREDENTIALS` first) |
| 401 | `{"error": "Invalid API key provided", "type": "ERROR"}` | `AUTH_FAILED` |
| 400 | "Unsupported locale code" (docs) | `API_ERROR` |
| 403 | "Missing param user_ip or user_agent" (docs) | `API_ERROR` |
| 429 / 5xx | | retried with backoff, then `API_UNAVAILABLE` |
| 404 | | `NOT_FOUND` |

## Detail

There is no single-posting API call, and careerjet.com.tr's job pages are robots-disallowed.
The result `url` (`jobviewtrack.com`) is a click-tracking redirect, counted per click, to the
original posting. The CLI never fetches it. `detail <id|url>` reads the local cache that
`search` writes (`$TMPDIR/careerjet-search-cache.json`, or `$CAREERJET_CACHE_FILE`). Entries
are kept 14 days, up to 1000 entries.

## Sign-up

- Docs: https://www.careerjet.com/partners/api (curl/Python/JS/PHP/Perl/Java examples under `/partners/api/<lang>`)
- Publisher program: https://www.careerjet.com/partners/publishers ("Monetize your web traffic by displaying Careerjet's job listings")
- Registration: https://www.careerjet.com/partners/register/as-publisher (redirects to login, so a Careerjet account is needed first). One API key per publisher website.
