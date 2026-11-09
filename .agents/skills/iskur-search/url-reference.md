# İŞKUR e-Şube URL Reference

Public, unauthenticated pages of İŞKUR's e-Şube used by this skill (recon 2026-11-09).
ASP.NET WebForms; no JSON API backs the public search. All fetches use the honest UA
`Mozilla/5.0 (compatible; iskur-cli/1.0)`; no Cloudflare challenge, an F5 BIG-IP cookie
(`TS01...`) is set and simply carried along.

## Access rules

- `https://esube.iskur.gov.tr/robots.txt`: `User-agent: *` / `Allow: /` /
  `Disallow: /Meslek/ViewMeslekDetayPopUp.aspx/` - the search and detail pages are allowed.
- `https://www.iskur.gov.tr/robots.txt` disallows `/*?*`, `/is-arama?*`, `/api/` and more
  for all agents, with `Crawl-delay: 2` (`5` for `*bot*` UAs). The CLI never touches
  `www.iskur.gov.tr`; that site only links to the e-Şube search below.
- No terms of use forbidding automated reading were found (only KVKK and cookie policy
  pages). Login (T.C. Kimlik No / e-Devlet) is needed only to see private employers'
  names and to apply - not to search or read ads.

## Search

```
GET  https://esube.iskur.gov.tr/Istihdam/AcikIsIlanAra.aspx      (form + __VIEWSTATE, sets cookies)
POST https://esube.iskur.gov.tr/Istihdam/AcikIsIlanAra.aspx      (application/x-www-form-urlencoded)
```

Cookies to carry from the GET: `ASP.NET_SessionId`, `iskur_cookie`, `TS018caa8c`.
POST every field the browser would submit (hidden inputs incl. `__VIEWSTATE`,
`__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`, text inputs, checked radios/checkboxes,
selected `<select>` options; disabled controls such as `ctl04$ctlUlke` are left out) and
override:

| Field | Meaning | Values |
|-------|---------|--------|
| `__EVENTTARGET` | Postback source | `ctl04$ctlAcikIsPageCommand$CommandItem_Search` (the "Ara" link) |
| `ctl04$ctlArananMetin2` | Free-text keywords (position, occupation, skill, employer) | `grafik tasarım` |
| `ctl04$IsyeriTuruRadios` | Sector | `ozelSektorRadio` (private, default) · `kamuRadio` (public). Omitting it = private. |
| `ctl04$ctlIl` | Province | plate code `1`-`81` (`16` Bursa, `34` İstanbul, `6` Ankara, `35` İzmir), `""` = all |
| `ctl04$ctlIlce` | District | AJAX-loaded per province (`ajaxpro` `IskurAjaxParameterComboBox`) - not used, `""` |
| `ctl04$ctlIlanTarihi` | Posted within | `1` all · `2` last 24 h · `3` last week · `4` last 15 days |
| `ctl04$ctlCalismaSekli` | Full/part time | `""` all · `1` Tam Zamanlı · `2` Kısmi Zamanlı (not exposed by the CLI) |
| `ctl04$ctlCalismaPeryodu` | Permanent/temporary | `""` all · `2` Daimi · `1` Geçici (not exposed) |
| `ctl04$ctlOgrenimDurum` | Education | `""` all, `1` Lisans, ... (not exposed) |

### Pagination

15 rows per page. To reach page N, POST the **results page's** form state again (its new
`__VIEWSTATE` / `__EVENTVALIDATION`, same criteria) with:

| Field | Value |
|-------|-------|
| `__EVENTTARGET` | `ctl04$ctlDataPagerDetay$btnChangeCurrentPage` ("Sayfaya Git") |
| `ctl04$ctlDataPagerDetay$txtCurrentPage` | `N` |

The pager markup: `<input name="ctl04$ctlDataPagerDetay$txtCurrentPage" value="1" ...> / 4
... - Toplam Kayıt: 50`. It is absent when everything fits on one page. Totals are not
capped (İstanbul, no keyword: 3081 ads / 206 pages).

### Result anchors

Results are rows of `<table id="ctl04_ctlGridAcikIslerListeDetail">`; the first row is the
sort header. Ids are `ctl04_ctlGridAcikIslerListeDetail_ctlNN_<suffix>`:

| Field | Anchor |
|-------|--------|
| id (İlan No / İşgücü İstemi No, 11 digits) + title | `<a id="..._flag_<ilanNo>" onclick="PopupJobDetails('<ilanNo>','Özel','0')">` text = occupation title |
| company | `<span id="..._ctlIsverenDL">` - for private ads the text is "İşyeri adını görmek için Sisteme Üye Girişi yapmanız gerekmektedir." (→ `null`) |
| sector / contract / hours | `_ctlIsverenTurDL` (Özel/Kamu), `_ctlCalismaPeriyotDL` (Daimi/Geçici), `_ctlCalismaSekliDL` (Tam/Kısmi Zamanlı) |
| openings | `_Label9` ("N Açık Pozisyon") |
| location | `_ctlCalismaYeriDL`: `İlçe Geneli Başvuru <br> (Çalışma Yeri: BURSA / OSMANGAZİ)` - scope before the parenthesis, `İL / İLÇE` inside |
| deadline | `_ctlSonBasvuruTarihi` (`3.12.2026`, d.m.yyyy); `_ctlSonBasvuruDL` = "24 Gün Kaldı" |
| disabled-candidate ad | `<img id="..._ctlEngelGif" src="../Images/engelli.gif">` |
| share data | `data-url`, `data-ilanno`, `data-sontarih`, `data-il`, `data-meslekler` on `.share-toggle` |

No posting date is published anywhere public. A notice/validation message, if any, is in
`<span id="ctl04_ctlMessageBox_lblMessage">`. A zero-hit search returns no result rows
(exit 0, empty `results`).

## Detail

```
GET https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=<ilanNo>[&isyeriTuru=Özel|Kamu]
```

Public. The anonymous view shows the banner `ctl01_ctlLabelUyari` ("İlan detaylarını görmek
ve iş başvurusu yapmak için sisteme giriş yapınız.") and a login box, then:

| Field | Anchor (id suffix) |
|-------|--------------------|
| description (İş Tanımı) | `_ctlIsIlanBilgileri_ctlGenelSartlar`, `_ctlOzelSartlarText`, `_ctlGenelSartlarManuel` (rich HTML `<p>`) |
| qualifications (Nitelik ve Beceriler) | `_ctlIsIlanBilgileri_ctlGenelSartlar2` |
| occupations | `_repeaterMeslek_ctlNN_ctlMeslekLabel`, experience `_ctlMeslekDeneyimSuresiLabel` (years) / `...LabelAy` (months) |
| education | `_ctlOgrenimAsgari` (min), `_ctlOgrenimAzami` (max) |
| ad type | `_ctlIsIlanBilgileri_ctlKisiselDurum` (Engelli, Eski Hükümlü, ...) |

Employer, location and deadline are **not** on the anonymous detail page. An unknown
`uiID` yields a page with none of the fields above; the CLI reports `NOT_FOUND`. `&nbsp` sometimes appears without its semicolon.

## Other public pages (not used)

- `Istihdam/AcikIsMeslek.aspx` - open ads grouped by occupation.
- `Istihdam/AcikIsIlanAra.aspx?calismasekli=2` - linked from www for part-time ads.
- `/ajaxpro/...` - autocomplete / district dropdown endpoints.
