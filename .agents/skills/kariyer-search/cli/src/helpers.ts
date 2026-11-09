// Data source: kariyer.net's public, server-rendered HTML pages. No
// authentication required. The search page (/is-ilanlari) renders one
// `data-test="ad-card"` element per result; the posting page (/is-ilani/<slug>-<id>)
// renders the full ad. Both are parsed with regex: the markup is a flat Vue SSR
// render with stable `data-test` anchors, so a DOM parser is unnecessary.
//
// The site's JSON endpoints are deliberately NOT used: robots.txt disallows
// /servisler/ and /Services/, and the in-page Nuxt payload is a minified
// function, not data. The rendered HTML carries everything the CLI outputs.

export const BASE_URL = "https://www.kariyer.net"
export const SEARCH_URL = `${BASE_URL}/is-ilanlari`
export const DETAIL_URL = `${BASE_URL}/is-ilani`

/** Results the portal renders per search page (the `cp` parameter pages through them). */
export const PAGE_SIZE = 50

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** An error that carries its own stderr `code`, so a block page is not reported as a generic failure. */
export class PortalError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

const UA = "Mozilla/5.0 (compatible; kariyer-cli/1.0)"

export interface FetchedPage {
  html: string
  /** URL after redirects (kariyer.net 301s a city filter to its SEO path and an ID to its slug). */
  url: string
}

/**
 * The site runs a bot-protection challenge ("press and hold"). An honest
 * client that meets it stops here: the CLI never retries with browser headers.
 */
function isChallengePage(html: string): boolean {
  return /id="px-captcha"|Access to this page has been denied/i.test(html)
}

/**
 * Fetch a page with exponential backoff and jitter on 429/5xx (max 6 retries).
 * Returns null on a 404. A 403 or a challenge page is a BLOCKED error.
 */
export async function pageFetch(url: string): Promise<FetchedPage | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (response.status === 403) {
      throw new PortalError(
        "kariyer.net refused the request (HTTP 403, likely bot protection). The CLI does not retry with browser headers; wait and try again later, with fewer requests",
        "BLOCKED",
      )
    }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    const html = await response.text()
    if (isChallengePage(html)) {
      throw new PortalError(
        "kariyer.net answered with a bot-protection challenge page. The CLI does not try to get past it; wait and try again later, with fewer requests",
        "BLOCKED",
      )
    }
    const finalUrl = response.url || url
    if (/^\/aday\/giris/i.test(new URL(finalUrl).pathname)) {
      throw new PortalError("kariyer.net redirected to its login page; this CLI only reads public pages", "LOGIN_REQUIRED")
    }
    return { html, url: finalUrl }
  }
  throw new Error("Request failed after max retries")
}

/** Fetch HTML with backoff. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const page = await pageFetch(url)
  return page ? page.html : ""
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  /** Approximate posting/update date (YYYY-MM-DD, Türkiye time), derived from `age`. */
  date: string | null
  /** The portal's relative age label as shown on the card, e.g. "4 gün", "3 saat". */
  age: string | null
  workModel: string | null
  employmentType: string | null
  /** A paid "Sponsorlu İlan" card. These repeat on every results page; dedupe by id. */
  sponsored: boolean
  url: string
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  /** Last publish date (YYYY-MM-DD). */
  date: string | null
  /** Application closing date (YYYY-MM-DD). */
  deadline: string | null
  url: string
  description: string | null
  employmentType: string | null
  workModel: string | null
  positionLevel: string | null
  experience: string | null
  department: string | null
  /** "Aday Kriterleri" pairs, e.g. { "Tecrübe": "2 - 5 yıl arası" }. */
  criteria: Record<string, string>
  /** The page's own isActive flag; null when the page does not carry it. */
  isActive: boolean | null
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// Named entities that appear in Turkish postings pasted from Word. Unknown
// names are left as written rather than guessed.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü",
  acirc: "â", Acirc: "Â", icirc: "î", Icirc: "Î", ucirc: "û", Ucirc: "Û",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·",
  euro: "€", deg: "°", copy: "©", reg: "®", trade: "™",
}

/** Decode HTML entities in a single pass, so "&amp;lt;" stays the literal text "&lt;". */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X"
      return numericEntity(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10))
    }
    return NAMED_ENTITIES[body] ?? whole
  })
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

/** Visible text of an HTML fragment: hidden markup dropped, tags stripped, entities decoded. */
export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

function cleanOrNull(html: string | undefined): string | null {
  return html === undefined ? null : clean(html) || null
}

/** Read one attribute from an opening tag's attribute string (case-sensitive: Vue SSR keeps camelCase names). */
function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))
  return m ? decodeHtmlEntities(m[1]).trim() : null
}

/** Inner HTML of the first <span ... data-test="<name>"> in a chunk. */
function spanByTest(html: string, name: string): string | undefined {
  return html.match(new RegExp(`<span\\b[^>]*data-test="${name}"[^>]*>([\\s\\S]*?)</span>`, "i"))?.[1]
}

/**
 * Inner HTML of the first <div> whose opening tag matches `openPattern`,
 * tracking nested <div> depth so the content is not cut at the first </div>.
 */
export function extractDiv(html: string, openPattern: RegExp): string | null {
  const open = openPattern.exec(html)
  if (!open) return null

  let i = open.index + open[0].length
  let depth = 1

  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)

    if (nextClose === -1) return null

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }

  return html.slice(open.index + open[0].length, i - 6)
}

// ---------------------------------------------------------------------------
// Dates. The search page shows only a relative age ("4 gün", "3 saat"); the
// posting page carries absolute dd.mm.yyyy dates. Türkiye is fixed at UTC+3.
// ---------------------------------------------------------------------------

const TR_OFFSET_MS = 3 * 3600 * 1000
const DAY_MS = 86400 * 1000

/** Age in milliseconds for a kariyer.net relative label, or null if it is not an age. */
export function ageToMs(label: string | null): number | null {
  if (!label) return null
  const l = label.toLocaleLowerCase("tr")
  const n = l.match(/(\d+)\s*(dk|dakika|saat|gün|hafta|ay|yıl)(?![a-zçğıöşü])/)
  if (n) {
    const v = parseInt(n[1], 10)
    const unit: Record<string, number> = {
      dk: 60 * 1000, dakika: 60 * 1000, saat: 3600 * 1000, "gün": DAY_MS,
      hafta: 7 * DAY_MS, ay: 30 * DAY_MS, "yıl": 365 * DAY_MS,
    }
    return v * unit[n[2]]
  }
  if (/\b(bugün|yeni|şimdi)\b|^(bugün|yeni|şimdi)/.test(l)) return 0
  if (/(^|\s)dün(\s|$)/.test(l)) return DAY_MS
  return null
}

/** Whole days of age for a relative label (0 for hours/minutes), or null. */
export function ageDays(label: string | null): number | null {
  const ms = ageToMs(label)
  return ms === null ? null : Math.floor(ms / DAY_MS)
}

/** Approximate calendar date (YYYY-MM-DD, Türkiye time) for a relative label. */
export function ageToDate(label: string | null, now: Date = new Date()): string | null {
  const ms = ageToMs(label)
  if (ms === null) return null
  return new Date(now.getTime() - ms + TR_OFFSET_MS).toISOString().slice(0, 10)
}

/** "20.11.2026" -> "2026-11-20"; null for anything else. */
export function trDateToIso(value: string | null): string | null {
  const m = value?.match(/^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Search filters.
// ---------------------------------------------------------------------------

/**
 * The portal's posting-date filter (`date=`) has fixed windows: today, 3, 7
 * and 15 days (plus 3/8 hours). Map --jobage N to the smallest window that
 * covers N days; the search command then drops cards older than N days, so the
 * window the user asked for is exact. Above 15 days there is no portal filter
 * and only the client-side cut applies.
 */
export function jobageToParam(days: number): string | null {
  if (!days || days <= 0) return null
  if (days <= 1) return "1g"
  if (days <= 3) return "3g"
  if (days <= 7) return "7g"
  if (days <= 15) return "15g"
  return null
}

/** Work-model filter (`wm=`): kariyer.net's enum is OnSite=0, Remote=1, Hybrid=2. */
export function workModelParam(mode: string | undefined): string | null {
  switch ((mode || "").toLowerCase()) {
    case "remote":
      return "1"
    case "hybrid":
      return "2"
    case "onsite":
    case "on-site":
      return "0"
    default:
      return null
  }
}

/**
 * kariyer.net city IDs (`ct=`). They are Türkiye's licence-plate province
 * codes, except İstanbul: 998 = all of İstanbul, 34 = European side (Avr.),
 * 82 = Asian side (Asya/Anadolu). Verified against the site's own city filter.
 */
const CITY_IDS: Record<string, string> = {
  istanbul: "998", "istanbul avrupa": "34", "istanbul avr": "34", "istanbul anadolu": "82", "istanbul asya": "82",
  adana: "1", adiyaman: "2", afyon: "3", afyonkarahisar: "3", agri: "4", amasya: "5", ankara: "6",
  antalya: "7", artvin: "8", aydin: "9", balikesir: "10", bilecik: "11", bingol: "12", bitlis: "13",
  bolu: "14", burdur: "15", bursa: "16", canakkale: "17", cankiri: "18", corum: "19", denizli: "20",
  diyarbakir: "21", edirne: "22", elazig: "23", erzincan: "24", erzurum: "25", eskisehir: "26",
  gaziantep: "27", giresun: "28", gumushane: "29", hakkari: "30", hatay: "31", isparta: "32",
  mersin: "33", icel: "33", izmir: "35", kars: "36", kastamonu: "37", kayseri: "38", kirklareli: "39",
  kirsehir: "40", kocaeli: "41", konya: "42", kutahya: "43", malatya: "44", manisa: "45",
  kahramanmaras: "46", mardin: "47", mugla: "48", mus: "49", nevsehir: "50", nigde: "51", ordu: "52",
  rize: "53", sakarya: "54", samsun: "55", siirt: "56", sinop: "57", sivas: "58", tekirdag: "59",
  tokat: "60", trabzon: "61", tunceli: "62", sanliurfa: "63", usak: "64", van: "65", yozgat: "66",
  zonguldak: "67", aksaray: "68", bayburt: "69", karaman: "70", kirikkale: "71", batman: "72",
  sirnak: "73", bartin: "74", ardahan: "75", igdir: "76", yalova: "77", karabuk: "78", kilis: "79",
  osmaniye: "80", duzce: "81",
}

const KNOWN_IDS = new Set(Object.values(CITY_IDS))

/** Fold Turkish letters to ASCII lowercase: "İstanbul", "ISTANBUL", "istanbul" all become "istanbul". */
export function foldTurkish(text: string): string {
  return text
    .replace(/[İIı]/g, "i")
    .toLowerCase()
    .replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g").replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s").replace(/[üÜ]/g, "u").replace(/[âÂ]/g, "a").replace(/[îÎ]/g, "i").replace(/[ûÛ]/g, "u")
    .replace(/[()\-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Resolve --location ("Bursa", "İstanbul Anadolu", "Bursa,Kocaeli", "16") to
 * the `ct` value. Returns null when any part is unknown, so the caller can
 * fail instead of silently searching all of Türkiye.
 */
export function resolveLocation(input: string): string | null {
  const ids: string[] = []
  for (const part of input.split(",")) {
    const key = foldTurkish(part)
    if (!key) return null
    const id = /^\d+$/.test(key) ? (KNOWN_IDS.has(key) ? key : null) : CITY_IDS[key] ?? null
    if (!id) return null
    if (!ids.includes(id)) ids.push(id)
  }
  return ids.length ? ids.join(",") : null
}

// ---------------------------------------------------------------------------
// Parsers.
// ---------------------------------------------------------------------------

/** Parse the numeric job ID from a kariyer.net posting path such as /is-ilani/acme-web-developer-4520391. */
export function idFromPath(path: string): string | null {
  const m = path.match(/^\/is-ilani\/(?:[^/?#]*-)?(\d{5,})\/?$/)
  return m ? m[1] : null
}

/**
 * Parse the search page. Each result is a `<div data-test="ad-card" ...>`
 * whose attributes carry the portal's own metadata (time, cityName,
 * workModelText, workTypeText) and whose body renders title, company and
 * location. We split on that anchor and parse each chunk independently, so
 * one malformed card cannot break the rest.
 */
export function parseJobCards(html: string, now: Date = new Date()): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split(/<div\b(?=[^>]*\bdata-test="ad-card")/).slice(1)

  for (const chunk of chunks) {
    const tagEnd = chunk.indexOf(">")
    if (tagEnd === -1) continue
    const attrs = chunk.slice(0, tagEnd)
    if (!/\bdata-test="ad-card"/.test(attrs)) continue
    // A card the page itself hides is not a result its reader sees.
    if (isHiddenTag(attrs)) continue

    const href = chunk.match(/href="((?:https:\/\/www\.kariyer\.net)?\/is-ilani\/[^"?#]+)/)
    const path = href ? href[1].replace(/^https:\/\/www\.kariyer\.net/, "") : null
    const id = path ? idFromPath(path) : null
    if (!id || !path) continue

    const title = cleanOrNull(spanByTest(chunk, "ad-card-title"))
    if (!title) continue

    const company = cleanOrNull(spanByTest(chunk, "subtitle"))

    // Remote cards render no location span; fall back to the card's own
    // city attribute plus the number of extra cities ("+N il daha", as the site writes it).
    let location = cleanOrNull(spanByTest(chunk, "location"))
    if (!location) {
      const city = attr(attrs, "cityName")
      const count = (attr(attrs, "locations")?.match(/\[object Object\]/g) ?? []).length
      if (city) location = count > 1 ? `${city} +${count - 1} il daha` : city
    }

    const workModel = cleanOrNull(spanByTest(chunk, "work-model")) ?? (attr(attrs, "workModelText") || null)
    const employmentType = attr(attrs, "workTypeText") || null
    const sponsored = attr(attrs, "sponsor") === "true" || attr(attrs, "isRealSponsored") === "true"

    let age = attr(attrs, "time") || null
    if (!age) {
      const dateHtml = chunk.match(/data-test="ad-date[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1]
      // Drop the icon ligature (<i>update</i>) before reading the label.
      age = dateHtml ? clean(dateHtml.replace(/<i\b[^>]*>[\s\S]*?<\/i>/gi, "")) || null : null
    }

    results.push({
      id,
      title,
      company,
      location,
      date: ageToDate(age, now),
      age,
      workModel,
      employmentType,
      sponsored,
      url: `${BASE_URL}${path}`,
    })
  }

  return results
}

/** Whether the page links to the next results page (`cp=<page+1>`). */
export function hasNextPage(html: string, page: number): boolean {
  return new RegExp(`href="[^"]*[?&](?:amp;)?cp=${page + 1}(?:[&"])`).test(html)
}

/** Convert a description's HTML into readable text with paragraph and list breaks. */
function descriptionText(descHtml: string): string | null {
  // Hidden markup goes before the line split: a hidden element can span the
  // breaks, and cleaning line by line would only see half of it.
  const withBreaks = visibleHtml(descHtml)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n")
  // Clean each rendered line separately: clean() collapses whitespace,
  // so applying it to the whole description would erase these boundaries.
  return (
    withBreaks
      .split("\n")
      .map(clean)
      .filter((line) => line !== "•")
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      // Keep a list tight: employers wrap each bullet in its own <p>/<li>.
      .replace(/^([•\-*·] [^\n]*)\n\n(?=[•\-*·] )/gm, "$1\n")
      .trim() || null
  )
}

/** Parse a posting page. Returns null when the page is not a posting (removed ad, redirect to a list). */
export function parseJobDetail(html: string, id: string, url?: string): JobDetail | null {
  const titleHtml = extractDiv(html, /<div\b[^>]*data-test="job-title"[^>]*>/i)
  const title = titleHtml !== null ? clean(titleHtml) : ""
  if (!title) return null

  const companyMatch = html.match(/<a\b([^>]*\bdata-test="company-name"[^>]*)>([\s\S]*?)<\/a>/i)
  const company = companyMatch ? clean(companyMatch[2]) || null : null
  const companyHref = companyMatch ? attr(companyMatch[1], "href") : null
  const companyUrl = companyHref && /^https:\/\/www\.kariyer\.net\//.test(companyHref) ? companyHref : null

  const location = cleanOrNull(spanByTest(html, "company-location"))

  const headline = html.match(/<div\b([^>]*\bclass="headline-top-box[^"]*"[^>]*)>/i)?.[1] ?? ""
  const container = html.match(/<div\b([^>]*\bclass="job-container[^"]*"[^>]*)>/i)?.[1] ?? ""

  let date = trDateToIso(attr(container, "lastPublishDate"))
  if (!date) {
    const updated = spanByTest(html, "updated-date")
    date = updated ? ageToDate(clean(updated)) : null
  }

  const descHtml = extractDiv(html, /<div\b[^>]*data-test="qualifications-and-job-description"[^>]*>/i)
  const description = descHtml !== null ? descriptionText(descHtml) : null

  // "Aday Kriterleri": alternating title/value divs.
  const criteria: Record<string, string> = {}
  const itemRe =
    /data-test="alignment-list-title"[^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*data-test="alignment-list-value"[^>]*>([\s\S]*?)<\/div>/gi
  let cm: RegExpExecArray | null
  while ((cm = itemRe.exec(html)) !== null) {
    const key = clean(cm[1].replace(/<span\b[^>]*class="bullet"[^>]*>[\s\S]*?<\/span>/gi, ""))
    const value = clean(cm[2])
    if (key && value) criteria[key] = value
  }

  const active = attr(container, "isActive")
  const finalPath = url ? new URL(url).pathname : ""

  return {
    id,
    title,
    company,
    companyUrl,
    location,
    date,
    deadline: trDateToIso(attr(container, "closingDate")),
    url: idFromPath(finalPath) === id ? `${BASE_URL}${finalPath}` : `${DETAIL_URL}/${id}`,
    description,
    employmentType: attr(headline, "workType") || null,
    workModel: attr(headline, "workModelText") || null,
    positionLevel: attr(headline, "positionLevel") || null,
    experience: attr(headline, "experienceLevel") || null,
    department: attr(headline, "departmentName") || null,
    criteria,
    isActive: active === "true" ? true : active === "false" ? false : null,
  }
}
