# eleman.net URL Reference

Public HTML pages used by this skill (recon 2026-11-09). No JSON API is used. The site sits
behind Cloudflare (`server: cloudflare`, `cf-cache-status: DYNAMIC`) but served the honest UA
`Mozilla/5.0 (compatible; elemannet-cli/1.0)` with plain 200s — no challenge.

> Personal use only — keep volume low.

## robots.txt (User-agent: *, snapshot 2026-11-09)

No `Allow` lines and no `Sitemap` line (`/sitemap.xml` is a 404 page). Disallow rules (mirrored
in `cli/src/helpers.ts` → `ROBOTS_DISALLOW`; every URL is checked before it is fetched and after
redirects):

```
/*.asp$   /*.html$   /*.htm$   *?t=arama*   *?yazi=*   *?uyelik_tipi=*   *?tip=*   *?ilan_id=*
*?t=*   *?wbtrck=*   /favori.php   /resim_goster.php   /uye_yorum.php   /dogrulama_kodu.php
/basvuru_yap.php   /cv_guncelle.php   /eleman.php   /is_ilanlari.php   /firmalar.php   /arama_complete.php
```

Consequences:
- The legacy keyword search (`/is_ilanlari.php`, `?t=arama`) is off limits.
- Posting pages are `/is-ilani/<slug>-i<id>` with **no** `.html` suffix, so `/*.html$` does not apply.
- `?sy=` (pagination) and `?gun=` (age filter) are not listed; the site's own canonical link
  includes `?gun=N` on filtered pages.
- The current search form submits `GET /is-ilanlari?aranan=<text>&arandi=e&sehir=<id>`. `aranan`
  is not listed in robots.txt, but those pages are `noindex, nofollow`; this skill does **not**
  use them (decision left to the user — enabling it would add free-text search).

## Search (listing pages)

```
GET https://www.eleman.net/is-ilanlari/<position-or-category>
GET https://www.eleman.net/is-ilanlari/<city-or-district>
GET https://www.eleman.net/is-ilanlari/<city>/<position-or-category>
```

| Param / part | Meaning | Example |
|--------------|---------|---------|
| `<position-or-category>` | Turkish-folded slug of an eleman.net position or category name | `grafik-tasarim-uzmani`, `grafik`, `grafiker`, `arayuz-tasarimcisi`, `muhasebe` |
| `<city>` | Province, side or district slug | `istanbul`, `istanbul-avrupa`, `bursa`, `nilufer`, `ankara`, `izmir` |
| `sy` | Page number (2, 3, ...); ~30 cards per page | `?sy=2` |
| `gun` | Posted within N days: `1`, `4`, `7`, `15`, `30` (`0` = all) | `?gun=7` |

Position names: `/is_ilanlari_pozisyonlar.php` (allowed, `robots: all`, split by initial letter);
category and city lists: `/is_ilanlari_bolumler.php`, `/is_ilanlari_sehirler.php`.

### Recognising a fallback

An unknown slug is **not** a 404. Examples:

| Request | canonical | Result |
|---------|-----------|--------|
| `/is-ilanlari/grafik-tasarim-uzmani` | same path | position listing |
| `/is-ilanlari/web-tasarim` | `/is-ilanlari` | every job (fallback) |
| `/is-ilanlari/bursa/grafik-tasarimci` | `/is-ilanlari/bursa` | every Bursa job (fallback) |
| `/is-ilanlari/bursa/grafik` | same path | 0 exact matches + "Genişletilmiş arama sonuçlarını görüyorsunuz" + 4 padded cards |

The CLI compares `<link rel="canonical" href="...">` (path only) with the requested path and
errors on a fallback; it splits the page at the "Genişletilmiş arama sonuçlar" notice and keeps
only the cards before it.

### Card anchors

Split on `class="c-box__body ilan_listeleme_bol` (regular cards continue `" id="ilan_id_<id>"`,
featured ones ` renkli-vitrin-ilan "`). Each card is one `<a>` holding all fields; the first
`</a>` ends the card.

| Field | Anchor |
|-------|--------|
| URL + id | `<a href="https://www.eleman.net/is-ilani/<slug>-i<id>" title="<title> iş ilanı">` |
| title | `<h3 class="c-showcase-box__title ...">Title <div class="ilantik-grubu">badges</div></h3>` |
| company + location (regular) | `<span class="c-showcase-box__subtitle"><i hgi-corporate></i> Company <br> <i hgi-location-01></i> City - District</span>` |
| company + location (featured) | `<span class="c-showcase-box__subtitle"> Company - <i icon-map-marker></i> <span class="notranslate">City</span> </span>` |
| benefits | `<span class="c-showcase-box__text u-equalize-line-height "><i hgi-eraser-add></i> <span>Yemek, Servis</span></span>` |
| teaser | `<span class="c-showcase-box__text " style="line-height:1.5;">...</span>` (truncated) |
| date | — none on cards |
| pager | links `?sy=N` (a window of page numbers) |

## Detail (posting page)

```
GET https://www.eleman.net/is-ilani/<slug>-i<id>
GET https://www.eleman.net/is-ilani/ilan-i<id>   → 301 to the canonical slug URL
```

| Field | Source |
|-------|--------|
| title | `<h1>` → `<span class="h3 ... u-text-ilan-baslik">`; fallback JSON-LD `title` |
| company | `<p class="h5 u-text-ilan-altbaslik" title="...">`; fallback JSON-LD `hiringOrganization.name` |
| location | after `icon-map-marker` → `<span class="notranslate">City - District</span>` |
| date, deadline, employmentType, jobBenefits | JSON-LD `JobPosting`: `datePosted` (`2026-11-06 19:43:05`), `validThrough`, `employmentType`, `jobBenefits`; header `icon-calendar` date (`06-11-2026`) as fallback |
| description | `<div class="d-information">` → first `<div ... class="u-font-size-sm">` (`<br/>`-separated text) |
| requirement badges | `<span class="is_ilani_ozellik_kutusu">` — gender, age range, `No: <id>`, `Eğitim:`, `Ehliyet:`, `Deneyim:`, `Dil:`, employment type, `Yan Haklar:` |

The JSON-LD `description` is entity-escaped HTML (`&lt;br /&gt;`), used only as a fallback.
Phone numbers in the contact block are masked (`0534 204 ** **`) and need login; not parsed.

## Notes

- No authentication required for listings or postings.
- The CLI retries 429/5xx with exponential backoff and jitter (max 6 retries).
