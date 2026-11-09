# Kariyer.net URL Reference

Public, unauthenticated pages used by this skill, recorded during reconnaissance on
2026-11-09. kariyer.net is a Nuxt (Vue SSR) app: both pages are fully server-rendered, so
the CLI parses HTML. It does **not** call the site's JSON API.

> Personal use only. Keep volume low (see SKILL.md).

## robots.txt (User-agent: *)

Allowed and used: `/is-ilanlari` (search) and `/is-ilani/<slug>-<id>` (posting).

Disallowed and never used: `/servisler/`, `/Services/` (the JSON services), `/filtre`,
`/filtre/*`, `*?ckw*` (company-keyword search), `*?copilot*`, `/*?v=`, `/UploadFiles/`,
`/support/`, plus account, CV and application paths (`/ozgecmis/*`, `/basvuru-*`,
`/hesabim`, `/profil`, `/aday/giris?returnUrl*`, …). So the CLI never sends `ckw=`.

The terms pages (`/genel-kosullar`, `/veri-politikamiz/hizmet-sozlesmesi`) load their text
client-side, so a plain fetch could not read them. That is why SKILL.md carries the
personal-use warning.

## Search

```
GET https://www.kariyer.net/is-ilanlari?kw=<text>[&ct=<cityIds>][&date=<window>][&wm=<model>][&cp=<page>]
```

| Param | Meaning | Values |
|-------|---------|--------|
| `kw` | Keyword query | `web developer` (encoded `web+developer`) |
| `ct` | City IDs, comma-separated | licence-plate codes (`16` Bursa, `6` Ankara, `35` İzmir, …) except İstanbul: `998` all, `34` Avrupa, `82` Asya |
| `date` | Posting-date window | `1g` today · `3s` 3 h · `8s` 8 h · `3g` 3 days · `7g` 7 days · `15g` 15 days |
| `wm` | Work model | `0` on-site · `1` remote · `2` hybrid (verified: the page's filter chips read "Uzaktan / Remote" for `wm=1`) |
| `cp` | Page (1-indexed, 50 cards per page) | `2`, `3`, … |
| `sd` | Sort (not exposed by the CLI) | `dd` newest first |

A `ct` request is answered with a **301 to the SEO path**, e.g. `?kw=web+developer&ct=16` →
`/is-ilanlari/bursa?ct=16&kw=web+developer`, and `ct=998` → `/is-ilanlari/istanbul-…?ct=34,82`.
`fetch` follows it. Both paths are allowed.

These parameter names come from the site's own query-to-filter mapping
(`convertQueriesToFilters` in the main JS bundle). Other keys it knows: `cs` sector,
`lpst` position level, `wa` department, `tpst` work type, `edl` education, `pst` position,
`lg` ad language, `tt` district, `wex` experience range, `ea` easy apply. None are wired up.

### Result cards

Each result is one element, and the CLI splits the page on it:

```html
<div data-test="ad-card" time="4 gün" [sponsor="true" isRealSponsored="true"] jobStatus="…"
     locations="[object Object],…" workModelText="Hibrit" workTypeText="Tam zamanlı"
     jobDateStatus="New|Updated|LastDay" cityId="34" cityName="İstanbul(Avr.)" … class="job-list-card-item">
  <a href="/is-ilani/<company>-<title>-<id>" data-test="ad-card-item" …>
    <span data-test="ad-card-title">Title</span>
    <span data-test="subtitle">Company</span>
    <span data-test="location">İstanbul (Tümü)</span>   <!-- absent on remote cards -->
    <span data-test="work-model">Hibrit</span>
    <span data-test="ad-date-item-date-other"><i>update</i> 4 gün</span>
```

| Field | Anchor |
|-------|--------|
| `id` | trailing digits of the `/is-ilani/...-<id>` href |
| `title` | `span[data-test=ad-card-title]` |
| `company` | `span[data-test=subtitle]` |
| `location` | `span[data-test=location]`, else `cityName` attr + count of `[object Object]` in `locations` ("+N il daha") |
| `age` / `date` | `time` attr (fallback: `ad-date` span minus the `<i>` icon), a relative label converted to YYYY-MM-DD |
| `workModel` | `span[data-test=work-model]`, else `workModelText` attr |
| `employmentType` | `workTypeText` attr |
| `sponsored` | `sponsor="true"` or `isRealSponsored="true"` |

Next page exists when the pagination has a link to `cp=<page+1>`.

The in-page `window.__NUXT__` payload repeats the list (`advertisement.list`, `adCount`), but
it is a minified function whose values are positional arguments. It is not parsed.

## Detail

```
GET https://www.kariyer.net/is-ilani/<id>          → 301 to /is-ilani/<slug>-<id>
```

An unknown or removed ID answers **302 → `/is-ilanlari`**. The CLI treats any final URL that
is not this posting's `/is-ilani/...-<id>` as `NOT_FOUND`. There is no `JobPosting` JSON-LD,
only a `BreadcrumbList`.

| Field | Anchor |
|-------|--------|
| `title` | `div[data-test=job-title]` |
| `company`, `companyUrl` | `a[data-test=company-name]` (href → `/firma-profil/...`) |
| `location` | `span[data-test=company-location]` |
| `employmentType`, `positionLevel`, `experience`, `department`, `workModel` | attrs `workType`, `positionLevel`, `experienceLevel`, `departmentName`, `workModelText` on `div.headline-top-box` |
| `date`, `deadline`, `isActive` | attrs `lastPublishDate`, `closingDate` (dd.mm.yyyy), `isActive` on `div.job-container` |
| `description` | `div[data-test=qualifications-and-job-description]` (rich HTML, often pasted from Word) |
| `criteria` | `div[data-test=alignment-list-title]` / `div[data-test=alignment-list-value]` pairs ("Aday Kriterleri") |

Apply is the on-page "Başvur" button (`button[data-test=apply-button]`), which needs a login.

## Bot protection

Every page loads a PerimeterX/HUMAN sensor (`client.px-cloud.net/.../main.min.js`). On normal
pages that script is all there is. A challenge would be a 403 or a page with
`id="px-captcha"` ("press and hold"). The CLI reports either as `BLOCKED` and does not
escalate to browser headers. During recon, about 20 requests with the honest
`kariyer-cli/1.0` UA all returned 200.

## Response sizes

Search page about 370 to 420 KB, posting page about 300 KB.
