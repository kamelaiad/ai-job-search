# secretcv.com URL Reference

Public HTML pages used by this skill (recon 2026-11-09). No JSON API is used: the site's
search form calls an internal helper (`/aranabilir-url`) that turns form fields into a
listing URL, and for keyword + city it returns `/is-ilanlari/<city>-is-ilanlari?k=<kw>` —
a query-string URL the CLI deliberately avoids (see robots.txt below).

> Personal use only — keep volume low; one listing page per search.

## robots.txt (User-agent: *, snapshot 2026-11-09)

`Allow: /`, then these Disallow rules (mirrored in `cli/src/helpers.ts` → `ROBOTS_DISALLOW`;
every URL is checked before it is fetched and after redirects):

```
/banner/redirect/*   /ilan-begen-iptal/*   *hesabim*   /is-ilanlari/ara   /cikis-yap
*kvkk-modal?ilanId=*   *ara?k=*   */?ilanId=*   */?sf=*   */?redirect=*   */?k=*
*/?s=*   */?b=*   */?p=*   */?o=*   */?wtime=*   */?parameters=*   /qr-basvuru   /yeniden-biz
Sitemap: https://www.secretcv.com/sitemap
```

Consequences:
- The search form (`/is-ilanlari/ara`, `?k=`) and filter/pagination parameters are off limits.
- Keyword listing pages paginate with `/<slug>-is-ilanlari/?sf=N` → disallowed → **page 1 only**.
  (City pages link `-is-ilanlari?sf=N` without the slash, which the literal rule does not match;
  the CLI treats `sf` as disallowed everywhere, matching the rule's evident intent.)
- `/is-ilanlari/ara` is a prefix rule, so keyword slugs starting with `ara` are refused.
- The posting page by number (`?ilanId=`) is disallowed, so `detail` needs the full posting path.

## Sitemaps (allowed; they list the listing-page families)

| Sitemap | Contents |
|---------|----------|
| `/sitemap/arama-form` | ~3,250 keyword/position pages `/is-ilanlari/<slug>-is-ilanlari` |
| `/sitemap/sehir-pozisyon` | ~13,500 city + position pages `/is-ilanlari/<city>/<position>-is-ilanlari` |
| `/sitemap/tum-sehir-sektor`, `/sitemap/il-ilce` | city, district and sector pages |

## Search (listing pages)

```
GET https://www.secretcv.com/is-ilanlari/<keyword>-is-ilanlari          # keyword or position
GET https://www.secretcv.com/is-ilanlari/<city>-is-ilanlari             # city (province)
GET https://www.secretcv.com/is-ilanlari/<city>/<position>-is-ilanlari  # city + position
```

| Part | Meaning | Example |
|------|---------|---------|
| `<keyword>` | Turkish-folded slug of the query (ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u) | `web-tasarim`, `grafik-tasarim` |
| `<position>` | A position slug secretcv knows (from `sehir-pozisyon`) | `grafiker`, `grafik-tasarimci` |
| `<city>` | Province permalink | `bursa`, `ankara`, `izmir`, `istanbul`, `istanbul-avrupa`, `istanbul-anadolu` |

20 cards per page. The page's filter state is in a hidden input — the CLI's ground truth for
whether the slug was applied:

```html
<input type="hidden" class="searchParameters"
       value='{"sh":[16],"ilc":[],"k":null,"p":[883],"s":[],"it":[],"minm":"","makm":"","io":[]}'>
```

| Key | Meaning |
|-----|---------|
| `sh` | city IDs (e.g. 16 = Bursa) |
| `ilc` | district IDs |
| `k` | free-text keyword (non-null when the slug was read as a keyword) |
| `p` | position IDs (non-empty when the slug matched a position) |
| `s` | sector IDs |

Observed behaviour:
- `/is-ilanlari/web-tasarim-is-ilanlari` → `k: "Web Tasarim"`, ~230 results (keyword search).
- `/is-ilanlari/grafik-tasarimci-is-ilanlari` → `p: [882]`, 5 results (strict position).
- `/is-ilanlari/bursa/grafik-tasarim-is-ilanlari` → `sh: [16]`, `k: null` — **keyword silently
  dropped**, all Bursa jobs listed. The CLI detects this and falls back to the keyword page with
  a client-side city filter.
- Empty result pages contain "ilan bulunamadı!" and no cards.

### Card anchors

Split on `<div class="cv-job-box job-list` (ad slots are `cv-job-box cv-ads` and skipped):

| Field | Anchor |
|-------|--------|
| title + URL | `<a href=".../<company>/<slug>-is-ilanlari-<id>" title="..." class="title lh-title ">Title</a>` |
| company | `<a ... class="company ">Company</a>` (may be absent) |
| location | first `<span>` inside `<span class="city d-grid ">` (`İstanbul Avrupa, İstanbul Anadolu`) |
| district | `<span class="fs-11 mb-2">` (truncated with `...`; not emitted) |
| date | `<small class="text-muted mt-1">İlan Tarihi: 6 gün önce</small>` — relative only |
| pager | `<a ... href=".../?sf=12" title="Son Sayfa">` (last page number → `meta.lastPage`) |

Relative dates seen: `Bugün`, `N gün önce`, `N ay M gün önce` (plus `Dün`, `N saat/hafta/yıl önce`
handled defensively). The site's own date filter is the query parameter `g` (1/3/7/15/30); the
CLI does not send query parameters, so `--jobage` filters client-side.

## Detail (posting page)

```
GET https://www.secretcv.com/<company-slug>/<job-slug>-is-ilanlari-<id>
```

A wrong company slug returns 404 (no redirect). Page carries `<meta name="robots" content="noindex,nofollow">`
(an indexing directive, not an access rule).

| Field | Source |
|-------|--------|
| title, datePosted, validThrough, employmentType, hiringOrganization.name, jobLocation | JSON-LD `<script type="application/ld+json">` with `"@type": "JobPosting"` |
| title / company / city fallback | `div.cv-job-box.cv-job-box-xs` → `span.text-dark.fs-16`, `span.company`, `span.city` |
| description | first `<div class="cv-card content-job">` up to `<div class="buttons">`; section headings are `<span class="cj-title">` ("İş Açıklaması", "İstenen Yetenek ve Uzmanlıklar"); rich text uses named entities (`&ouml;`, `&uuml;`, `&ccedil;`) |
| fact table | `<div class="cv-card content-job-table">` → `<span class="title">Label</span> ... <span class="desc">Value</span>`: İlan Tarihi (first publish, dd-mm-yyyy), İstihdam Türü, Eleman Sayısı, Sektör, Eğitim Seviyesi, Firma Adı, Anahtar Kelimeler, Şehirler, İlçeler, Yabancı Uyruklu Çalışabilir |

JSON-LD `datePosted` is the latest (re)publish date and matches the card's relative date; the
table's "İlan Tarihi" can be older (first publish). The JSON-LD `description` is a flattened copy
without line breaks, used only as a fallback.

## Notes

- No authentication; the honest UA `Mozilla/5.0 (compatible; secretcv-cli/1.0)` gets 200s.
- The CLI retries 429/5xx with exponential backoff and jitter (max 6 retries).
