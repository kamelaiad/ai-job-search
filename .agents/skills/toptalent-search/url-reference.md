# toptalent URL Reference

Public pages on `toptalent.co` (ASP.NET MVC). Recorded 2026-11-09.

> Personal use only. `robots.txt` (`user-agent: *`) disallows `/App_Data/`, `/Areas/`,
> `/images/`, `*/feed/`, `/EmailTemplate/`, `/Elmah/`, `/Account/`, some
> `/businessschool/...` paths and one posting, `/turkiye-sigorta-geleceginin-sigortasi-120944`
> (the CLI refuses that slug). `/Job/` and posting slugs are not disallowed. Terms
> ("Şartlar ve Koşullar" §6): content may not be copied, reproduced, distributed or used
> commercially without permission.

## Search

The listing page `GET /is-ilanlari` server-renders the first cards and loads the rest
through an XHR, which the CLI calls directly:

```
POST https://toptalent.co/Job/SearchJob
Content-Type: application/json; charset=utf-8

{"PageSize":9,"PageNumber":1,"IsCardView":false,"SearchKey":"grafik tasarım",
 "DepartmentIds":[],"CityIds":[],"PositionLevelIds":[],"OrderBy":"newests",
 "FilterTags":[],"DepartmentSeo":null,"CitySeo":null}
```

| Field | Meaning | Example |
|-------|---------|---------|
| `SearchKey` | Keywords (the site sends it once 3+ characters are typed) | `intern` |
| `CityIds` | City ids = licence-plate codes, except İstanbul Avrupa `34` / İstanbul Anadolu `82` | `[6]` Ankara, `[35]` İzmir, `[16]` Bursa, `[41]` Kocaeli |
| `PositionLevelIds` | Who can apply | `10` Hazırlık, `9`-`6` 1st-4th year, `5` Master öğr., `4` Doktora öğr., `3` Yeni Mezun, `2` 0-1 yıl, `1` 1-3 yıl, `11` 3-5, `12` 5-10, `13` 10+ |
| `DepartmentIds` | Department (not exposed by the CLI) | `3` Yazılım ve BT, `15` Pazarlama, `7` Dijital |
| `PageNumber` / `PageSize` | 1-indexed page; the site uses 9 | `2` / `9` |
| `OrderBy` | Only `newests` is offered | `newests` |

The full id lists come from `GET /Job/JobsFilter` (the filter modal's HTML:
`plstateId-<id>`, `dstateId-<id>`, `ctateId-<id>` checkboxes with labels).
City SEO pages also exist (`/is-ilanlari/ankara-is-ilanlari`), but the CLI uses `CityIds`.
There is **no posting-age parameter** and no total count.

### Response structure

`text/html` fragment; no results = `"\r\n\r\n\r\n"`. One card per posting:

- `<a href="/<slug>" class="position">` — the posting slug is the id.
- Title: `<h5 class="card-title f-16 ff-pnova-b">`
- `<p class="card-text">` — company as text, then `<span class="text-grey-l f-12 pl-3">location</span>`
  (`Tüm Türkiye` = nationwide; city filtering excludes these).
- Deadline countdown: `<span class='... badge-circle-green'>Son 36 Gün</span>` (rendered
  twice, desktop and mobile; may be an empty `<span></span>`).

## Detail

```
GET https://toptalent.co/<slug>
```

Slugs are usually `<company>-<title>-<number>` but program pages drop the number
(`/bsh-we-power-2026`). Two layouts:

**Posting** (has `<div class="col-12 job-content">`):
- Header `<li class="media"> ... <div class="media-body">`: title in
  `<span class="f-18 ff-pnova-b">`, deadline badge `badge-circle-green` ("Son 17 Gün"),
  company as text after `<div class="clearfix"></div>`; logo `img.comp-logo[alt]`.
- `<h5>Departman</h5><p>• A<br>• B</p>`, `<h5>Lokasyon</h5><p>City<br></p>`.
- `<h5>Kimler Başvurabilir?</h5>` followed by `<input type="button" value="4. Sınıf">` chips.
- Description: `div.job-content` up to `<div class="menu-seperator">` (share buttons follow).
- JSON-LD `JobPosting` is **not strict JSON** (raw newlines in `description`), so the CLI
  only regex-reads `datePosted` (ISO) and `employmentType` (`INTERN`, ...).
- Apply: `a.LoginBtn` "Şimdi Başvur" opens a login modal; no separate apply URL.

**Company program page** (no `job-content`): banner `<h1 class="title text-center">`,
`<p class="lead">`, `button.LoginBtn` "Hemen Başvur", CMS content in
`<div class="container ckContent">` blocks; company from `<title>Toptalent.co | <title> - <company></title>`.
No JSON-LD, no deadline. CMS pages such as `/sartlar-ve-kosullar` also use `ckContent`
but have no `h1.title`, so they are rejected.

## Notes

- No authentication for search or detail; applying requires an account.
- The CLI sends `User-Agent: Mozilla/5.0 (compatible; toptalent-cli/1.0)` and backs off on 429/5xx.
- An expired posting is expected to 404 or redirect away from `/<slug>`; both are reported as `NOT_FOUND`.
