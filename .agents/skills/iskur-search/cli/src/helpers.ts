// Data source: İŞKUR e-Şube public job-ad search ("Açık İş İlanları"), an ASP.NET
// WebForms page. Search is a GET of the form (to obtain __VIEWSTATE /
// __EVENTVALIDATION and the session cookies) followed by a POST of the form with
// the search criteria; further pages are one more POST through the grid's pager.
// The detail page is a plain GET. No login is needed for either; İŞKUR hides the
// employer name of private-sector ads from anonymous visitors, so `company` is
// null for those. We parse with regex (zero runtime dependencies).

export const BASE_URL = "https://esube.iskur.gov.tr"
export const SEARCH_URL = `${BASE_URL}/Istihdam/AcikIsIlanAra.aspx`
export const DETAIL_URL = `${BASE_URL}/Istihdam/AcikIsIlanDetay.aspx`

/** __EVENTTARGET values of the form's postback links. */
export const SEARCH_TARGET = "ctl04$ctlAcikIsPageCommand$CommandItem_Search"
export const PAGER_TARGET = "ctl04$ctlDataPagerDetay$btnChangeCurrentPage"

/** Form field names the CLI sets (everything else is echoed back as the page served it). */
export const FIELD = {
  keyword: "ctl04$ctlArananMetin2",
  sector: "ctl04$IsyeriTuruRadios",
  province: "ctl04$ctlIl",
  district: "ctl04$ctlIlce",
  postedWithin: "ctl04$ctlIlanTarihi",
  currentPage: "ctl04$ctlDataPagerDetay$txtCurrentPage",
} as const

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** An error that carries the stderr `code` the CLI should report. */
export class CliError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

const UA = "Mozilla/5.0 (compatible; iskur-cli/1.0)"

// --- polite pacing ---------------------------------------------------------

// A search is 2-3 requests to a government server; space them out.
let politeDelayMs = 1000

/** Override the pause between requests of one invocation (tests set 0). */
export function setPoliteDelay(ms: number): void {
  politeDelayMs = ms
}

export function politePause(): Promise<void> {
  return politeDelayMs > 0 ? new Promise((r) => setTimeout(r, politeDelayMs)) : Promise.resolve()
}

// --- cookies ---------------------------------------------------------------

/** Minimal cookie jar: ASP.NET_SessionId + the load balancer cookies, carried across one search. */
export class CookieJar {
  private cookies = new Map<string, string>()

  store(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    const raw =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : (headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_.-]+=)/)
    for (const c of raw) {
      const pair = c.split(";")[0]
      const eq = pair.indexOf("=")
      if (eq <= 0) continue
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }

  get size(): number {
    return this.cookies.size
  }
}

// --- fetching --------------------------------------------------------------

export interface FetchOpts {
  method?: "GET" | "POST"
  body?: URLSearchParams
  jar?: CookieJar
  referer?: string
}

/**
 * Fetch HTML with exponential backoff (plus jitter) on 429/5xx. Returns "" on
 * a 404. Redirects are followed by hand so cookies set on the way are kept.
 */
export async function htmlFetch(url: string, opts: FetchOpts = {}): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let target = url
    let method = opts.method ?? "GET"
    let body: string | undefined = opts.body?.toString()
    let response: Response | null = null
    for (let hop = 0; hop < 5; hop++) {
      const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      }
      if (opts.jar && opts.jar.size > 0) headers.Cookie = opts.jar.header()
      if (opts.referer) headers.Referer = opts.referer
      if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded"
      response = await fetch(target, {
        method,
        headers,
        body: method === "POST" ? body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      })
      opts.jar?.store(response)
      const location = response.headers.get("location")
      if (response.status >= 300 && response.status < 400 && location) {
        target = new URL(location, target).toString()
        method = "GET"
        body = undefined
        continue
      }
      break
    }
    if (!response) throw new Error("Request failed: no response")
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Request failed: too many redirects (last ${response.status})`)
    }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    const text = await response.text()
    if (/requested URL was rejected|Request Rejected/i.test(text) && !/AcikIs/i.test(text)) {
      throw new CliError("İŞKUR's firewall rejected the request (bot protection); try again later", "BLOCKED")
    }
    return text
  }
  throw new Error("Request failed after max retries")
}

// --- text hygiene (copied from linkedin-search) ----------------------------

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/** Named entities that show up in İŞKUR's rich-text ad bodies (Turkish letters, typography). */
const NAMED_ENTITIES: Record<string, string> = {
  lt: "<", gt: ">", quot: '"', apos: "'",
  ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü",
  acirc: "â", Acirc: "Â", icirc: "î", Icirc: "Î", ucirc: "û", Ucirc: "Û",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—",
  hellip: "…", bull: "•", middot: "·", deg: "°", euro: "€", copy: "©", reg: "®", trade: "™",
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&([A-Za-z]+);/g, (whole, name: string) => NAMED_ENTITIES[name] ?? whole)
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    // İŞKUR's markup also writes a bare "&nbsp" without the semicolon.
    .replace(/&nbsp;?/g, " ")
    // &amp; last, so "&amp;lt;" stays the literal text "&lt;".
    .replace(/&amp;/g, "&")
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a portal's JSON or
 * markup as easily as through a numeric entity.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ""
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments (including Word's
 * conditional ones), <script>/<style>/<template> blocks, and elements marked
 * hidden - before tags are stripped. A plain tag strip keeps their text, which
 * hands the model words the posting's reader never saw. CSS-only tricks
 * (off-screen, zero font size) need a renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  // One pass, collecting what is kept: slicing the string per hidden element
  // would make a page full of them quadratic.
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) {
      // Skip to the matching close tag, counting nested same-name elements. An
      // unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak the hidden text.
      const same = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[1]) depth--
        else if (!s[0].endsWith("/>")) depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

function stripTags(html: string): string {
  return visibleHtml(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** Visible text of an HTML fragment on one line. */
export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/** Visible text of an HTML fragment, keeping paragraph and line breaks. */
export function cleanMultiline(html: string): string {
  // Hidden markup goes before the line split: a hidden element can span the
  // breaks, and cleaning line by line would only see half of it.
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
  return withBreaks.split("\n").map(clean).join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

// --- small parsers ---------------------------------------------------------

/**
 * Inner HTML of the first `<tag ... id="...<idSuffix>" ...>` element, matching
 * nested same-name tags by depth. ASP.NET prefixes ids with the naming
 * container (`ctl01_`, `ctl04_`, ...), so we match on the id's suffix.
 */
export function innerById(html: string, idSuffix: string, tag = "span"): string | null {
  const esc = idSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const open = new RegExp(`<${tag}\\b[^>]*\\bid="[^"]*${esc}"[^>]*>`, "i").exec(html)
  if (!open) return null
  const start = open.index + open[0].length
  const same = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi")
  same.lastIndex = start
  let depth = 1
  let s: RegExpExecArray | null
  while ((s = same.exec(html)) !== null) {
    if (s[1]) depth--
    else if (!s[0].endsWith("/>")) depth++
    if (depth === 0) return html.slice(start, s.index)
  }
  return html.slice(start)
}

/** "3.12.2026" / "03.12.2026" -> "2026-12-03"; null when it is not a d.m.yyyy date. */
export function trDateToIso(text: string | null | undefined): string | null {
  const m = (text ?? "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
}

/** "BURSA / OSMANGAZİ" -> "Bursa / Osmangazi" with Turkish casing rules (İ/i, I/ı). */
export function turkishTitleCase(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/(^|[\s/(-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase("tr-TR"))
}

// --- form state ------------------------------------------------------------

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))
  return m ? decodeHtmlEntities(m[1] ?? m[2] ?? "") : null
}

/**
 * The fields a browser would submit for this WebForms page: hidden and text
 * inputs, checked radios/checkboxes and the selected option of every enabled
 * <select>. Only the page's own fields (`__*` and the `ctl04$` content
 * container) are kept.
 */
export function formFields(html: string): URLSearchParams {
  const fields = new URLSearchParams()
  const keep = (name: string) => name.startsWith("__") || name.startsWith("ctl04$")
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0]
    const name = attr(tag, "name")
    if (!name || !keep(name)) continue
    const type = (attr(tag, "type") ?? "text").toLowerCase()
    if (["submit", "button", "image", "reset", "file", "password"].includes(type)) continue
    if (/\sdisabled\b/i.test(tag)) continue
    if (type === "radio" || type === "checkbox") {
      if (!/\schecked\b/i.test(tag)) continue
      fields.set(name, attr(tag, "value") ?? "on")
      continue
    }
    fields.set(name, attr(tag, "value") ?? "")
  }
  for (const m of html.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/gi)) {
    const name = attr(m[1], "name")
    if (!name || !keep(name) || /\sdisabled\b/i.test(m[1])) continue
    const options = [...m[2].matchAll(/<option\b[^>]*>/gi)].map((o) => o[0])
    const chosen = options.find((o) => /\sselected\b/i.test(o)) ?? options[0]
    fields.set(name, chosen ? attr(chosen, "value") ?? "" : "")
  }
  return fields
}

/** Text of the page's message box (validation / error notices), or null. */
export function pageMessage(html: string): string | null {
  const inner = innerById(html, "ctlMessageBox_lblMessage")
  const text = inner ? clean(inner) : ""
  return text || null
}

// --- provinces ---------------------------------------------------------------

/** İŞKUR's province dropdown values are the official plate codes (1-81). */
export const PROVINCES: Record<string, string> = {
  "1": "Adana", "2": "Adıyaman", "3": "Afyonkarahisar", "4": "Ağrı", "5": "Amasya",
  "6": "Ankara", "7": "Antalya", "8": "Artvin", "9": "Aydın", "10": "Balıkesir",
  "11": "Bilecik", "12": "Bingöl", "13": "Bitlis", "14": "Bolu", "15": "Burdur",
  "16": "Bursa", "17": "Çanakkale", "18": "Çankırı", "19": "Çorum", "20": "Denizli",
  "21": "Diyarbakır", "22": "Edirne", "23": "Elazığ", "24": "Erzincan", "25": "Erzurum",
  "26": "Eskişehir", "27": "Gaziantep", "28": "Giresun", "29": "Gümüşhane", "30": "Hakkari",
  "31": "Hatay", "32": "Isparta", "33": "Mersin", "34": "İstanbul", "35": "İzmir",
  "36": "Kars", "37": "Kastamonu", "38": "Kayseri", "39": "Kırklareli", "40": "Kırşehir",
  "41": "Kocaeli", "42": "Konya", "43": "Kütahya", "44": "Malatya", "45": "Manisa",
  "46": "Kahramanmaraş", "47": "Mardin", "48": "Muğla", "49": "Muş", "50": "Nevşehir",
  "51": "Niğde", "52": "Ordu", "53": "Rize", "54": "Sakarya", "55": "Samsun",
  "56": "Siirt", "57": "Sinop", "58": "Sivas", "59": "Tekirdağ", "60": "Tokat",
  "61": "Trabzon", "62": "Tunceli", "63": "Şanlıurfa", "64": "Uşak", "65": "Van",
  "66": "Yozgat", "67": "Zonguldak", "68": "Aksaray", "69": "Bayburt", "70": "Karaman",
  "71": "Kırıkkale", "72": "Batman", "73": "Şırnak", "74": "Bartın", "75": "Ardahan",
  "76": "Iğdır", "77": "Yalova", "78": "Karabük", "79": "Kilis", "80": "Osmaniye",
  "81": "Düzce",
}

/** Common short or older names people type. */
const PROVINCE_ALIASES: Record<string, string> = {
  afyon: "3", maras: "46", urfa: "63", antep: "27", icel: "33", izmit: "41", adapazari: "54",
}

/** Lower-case with Turkish rules, then fold diacritics so "Istanbul", "İSTANBUL" and "istanbul" all match. */
export function foldTurkish(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/̇/g, "")
    .normalize("NFC")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/\s+/g, " ")
}

/** Resolve a province name (any casing/diacritics) or plate code to İŞKUR's dropdown code. */
export function resolveProvince(input: string): { code: string; name: string } | null {
  const raw = input.trim()
  if (/^\d{1,2}$/.test(raw)) {
    const code = String(parseInt(raw, 10))
    return PROVINCES[code] ? { code, name: PROVINCES[code] } : null
  }
  const key = foldTurkish(raw)
  for (const [code, name] of Object.entries(PROVINCES)) {
    if (foldTurkish(name) === key) return { code, name }
  }
  const alias = PROVINCE_ALIASES[key]
  return alias ? { code: alias, name: PROVINCES[alias] } : null
}

// --- posting-age filter ----------------------------------------------------

export type AgeWindow = "24h" | "7d" | "15d" | "all"

/**
 * İŞKUR's "İlan Tarihi" dropdown only offers 24 hours / 1 week / 15 days /
 * all. A requested age rounds UP to the smallest window that contains it, and
 * anything beyond 15 days cannot be narrowed (window "all").
 */
export function jobageWindow(days: number | undefined): { code: string; window: AgeWindow } {
  if (days === undefined || days >= 9999) return { code: "1", window: "all" }
  if (days <= 1) return { code: "2", window: "24h" }
  if (days <= 7) return { code: "3", window: "7d" }
  if (days <= 15) return { code: "4", window: "15d" }
  return { code: "1", window: "all" }
}

// --- sector ------------------------------------------------------------------

export type Sector = "private" | "public"

/** Map a --sector value (English or Turkish) to İŞKUR's radio value. */
export function sectorValue(input: string): { sector: Sector; value: string } | null {
  switch (foldTurkish(input)) {
    case "private":
    case "ozel":
    case "ozel sektor":
      return { sector: "private", value: "ozelSektorRadio" }
    case "public":
    case "kamu":
    case "government":
      return { sector: "public", value: "kamuRadio" }
    default:
      return null
  }
}

// --- search results ----------------------------------------------------------

export interface JobCard {
  id: string
  title: string
  company: string | null
  /** true when İŞKUR shows "log in to see the employer" instead of a name. */
  employerHidden: boolean
  location: string | null
  /** Posting date. İŞKUR does not publish it, so this is always null; use `deadline`. */
  date: string | null
  /** Application deadline (Son Başvuru Tarihi), ISO yyyy-mm-dd. */
  deadline: string | null
  url: string
  sector: string | null
  employmentType: string | null
  contractType: string | null
  openings: number | null
  applicationScope: string | null
  disabilityQuota: boolean
}

export function detailUrl(id: string): string {
  return `${DETAIL_URL}?uiID=${id}`
}

const EMPLOYER_HIDDEN = /giri[şs]/i

/**
 * Parse the results grid. Each posting is one <tr> whose title link carries
 * id="..._flag_<ilanNo>"; we split on <tr and parse every row on its own so one
 * malformed card cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const gridStart = html.search(/<table\b[^>]*id="[^"]*ctlGridAcikIslerListeDetail"/i)
  if (gridStart === -1) return []
  const gridEnd = html.indexOf("</table>", gridStart)
  const grid = html.slice(gridStart, gridEnd === -1 ? undefined : gridEnd)
  const results: JobCard[] = []
  const seen = new Set<string>()

  for (const row of grid.split(/<tr\b/i).slice(1)) {
    try {
      const card = parseRow(row)
      if (card && !seen.has(card.id)) {
        seen.add(card.id)
        results.push(card)
      }
    } catch {
      // A malformed row is skipped; the others still parse.
    }
  }
  return results
}

function spanText(row: string, suffix: string): string | null {
  const inner = innerById(row, suffix)
  if (inner === null) return null
  return clean(inner) || null
}

function parseRow(row: string): JobCard | null {
  const link = row.match(/<a\b[^>]*\bid="[^"]*_flag_(\d+)"[^>]*>([\s\S]*?)<\/a>/i)
  if (!link) return null
  const id = link[1]
  const title = clean(link[2])
  if (!title) return null

  const employer = spanText(row, "_ctlIsverenDL")
  const employerHidden = employer !== null && EMPLOYER_HIDDEN.test(employer)
  const company = employer && !employerHidden ? employer : null

  // "İlçe Geneli Başvuru <br> (Çalışma Yeri: BURSA / OSMANGAZİ)"
  const place = spanText(row, "_ctlCalismaYeriDL")
  let location: string | null = null
  let applicationScope: string | null = null
  if (place) {
    const where = place.match(/Çalışma Yeri\s*:\s*([^)]*)\)?/i)
    location = where ? turkishTitleCase(where[1].trim()) || null : null
    applicationScope = place.replace(/\(.*$/, "").trim() || null
    if (!where && !location) location = turkishTitleCase(place)
  }

  const openingsText = spanText(row, "_Label9")
  const openings = openingsText && /^\d+$/.test(openingsText) ? parseInt(openingsText, 10) : null

  return {
    id,
    title,
    company,
    employerHidden,
    location,
    date: null,
    deadline: trDateToIso(spanText(row, "_ctlSonBasvuruTarihi")),
    url: detailUrl(id),
    sector: spanText(row, "_ctlIsverenTurDL"),
    employmentType: spanText(row, "_ctlCalismaSekliDL"),
    contractType: spanText(row, "_ctlCalismaPeriyotDL"),
    openings,
    applicationScope,
    disabilityQuota: /\bid="[^"]*_ctlEngelGif"/i.test(row),
  }
}

export interface PagerInfo {
  currentPage: number
  totalPages: number
  total: number | null
}

/** The grid pager: "<input ... txtCurrentPage value="1"> / 4 ... Toplam Kayıt: 50". Null when absent (one page). */
export function parsePager(html: string): PagerInfo | null {
  const input = html.match(/<input\b[^>]*name="[^"]*txtCurrentPage"[^>]*>/i)
  if (!input) return null
  const after = html.slice(input.index! + input[0].length, input.index! + input[0].length + 2000)
  const pages = after.match(/^\s*\/\s*(\d+)/)
  const total = after.match(/Toplam Kay[ıi]t\s*:\s*(\d+)/i)
  const current = attr(input[0], "value")
  return {
    currentPage: current && /^\d+$/.test(current) ? parseInt(current, 10) : 1,
    totalPages: pages ? parseInt(pages[1], 10) : 1,
    total: total ? parseInt(total[1], 10) : null,
  }
}

/** Whether the response is the search page at all (vs. an error or login page). */
export function isSearchPage(html: string): boolean {
  return /id="[^"]*divAcikIsAramaForm"/i.test(html)
}

// --- detail ------------------------------------------------------------------

export interface Occupation {
  name: string
  experience: string | null
}

export interface JobDetail {
  id: string
  title: string | null
  /** Not shown to anonymous visitors on the detail page; take it from `search`. */
  company: string | null
  location: string | null
  date: string | null
  deadline: string | null
  url: string
  description: string | null
  qualifications: string | null
  occupations: Occupation[]
  educationMin: string | null
  educationMax: string | null
  adType: string | null
  /** true when the page says some details need an e-Şube login (the description is still public). */
  loginNotice: boolean
}

/** Parse the anonymous AcikIsIlanDetay.aspx page. Null when it carries no posting. */
export function parseJobDetail(html: string, id: string): JobDetail | null {
  const textOf = (suffix: string, tag = "span"): string | null => {
    const inner = innerById(html, suffix, tag)
    return inner === null ? null : cleanMultiline(inner) || null
  }

  const descriptionParts = [
    textOf("_ctlIsIlanBilgileri_ctlGenelSartlar"),
    textOf("_ctlIsIlanBilgileri_ctlOzelSartlarText"),
    textOf("_ctlIsIlanBilgileri_ctlGenelSartlarManuel"),
  ].filter((p): p is string => !!p)
  const description = descriptionParts.length ? descriptionParts.join("\n\n") : null
  const qualifications = textOf("_ctlIsIlanBilgileri_ctlGenelSartlar2")

  const occupations: Occupation[] = []
  const rowRe = /_repeaterMeslek_(ctl\d+)_ctlMeslekLabel"/gi
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1]
    const name = textOf(`_repeaterMeslek_${row}_ctlMeslekLabel`)
    if (!name) continue
    const years = textOf(`_repeaterMeslek_${row}_ctlMeslekDeneyimSuresiLabel`)
    const months = textOf(`_repeaterMeslek_${row}_ctlMeslekDeneyimSuresiLabelAy`)
    const exp = [years ? `${years} Yıl` : "", months ? `${months} Ay` : ""].filter(Boolean).join(" ")
    occupations.push({ name, experience: exp || null })
  }

  if (!description && !qualifications && occupations.length === 0) return null

  const notice = textOf("_ctlLabelUyari")
  return {
    id,
    title: occupations[0]?.name ?? null,
    company: null,
    location: null,
    date: null,
    deadline: null,
    url: detailUrl(id),
    description,
    qualifications,
    occupations,
    educationMin: textOf("_ctlIsIlanBilgileri_ctlOgrenimAsgari"),
    educationMax: textOf("_ctlIsIlanBilgileri_ctlOgrenimAzami"),
    adType: textOf("_ctlIsIlanBilgileri_ctlKisiselDurum"),
    loginNotice: !!notice && /giri[şs]/i.test(notice),
  }
}

/**
 * Accept an İŞKUR ad number ("İlan No" / İşgücü İstemi No, e.g. 00009887102 or
 * 9887102) or an e-Şube detail URL carrying `uiID=`. URLs on any other host are
 * rejected (parsed with URL, so look-alike hosts and userinfo tricks fail too).
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{1,11}$/.test(trimmed)) return trimmed.padStart(11, "0")
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (!hasScheme && !/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (!/(^|\.)iskur\.gov\.tr$/i.test(parsed.hostname)) return null
  if (!/\/Istihdam\/AcikIsIlanDetay\.aspx$/i.test(parsed.pathname)) return null
  const uiId = parsed.searchParams.get("uiID") ?? parsed.searchParams.get("uiid")
  return uiId && /^\d{1,11}$/.test(uiId) ? uiId.padStart(11, "0") : null
}
