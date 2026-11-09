// Data source: secretcv.com public HTML pages. No authentication required.
//
// Search reads the portal's SEO listing pages (the URLs its own sitemaps list):
//   /is-ilanlari/<keyword>-is-ilanlari          keyword or position
//   /is-ilanlari/<city>-is-ilanlari             city
//   /is-ilanlari/<city>/<position>-is-ilanlari  city + position
// It never uses the search form or the query parameters robots.txt disallows
// (/is-ilanlari/ara, ?k=, ?sf= pagination, ?wtime=, ?parameters=, ...).
// Detail reads the public posting page /<company-slug>/<job-slug>-is-ilanlari-<id>.
// Both are parsed with regex over per-card chunks; zero runtime dependencies.

export const BASE_URL = "https://www.secretcv.com"
const HOST = /^(?:www\.)?secretcv\.com$/i

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; secretcv-cli/1.0)"

// ---------------------------------------------------------------------------
// robots.txt guard
// ---------------------------------------------------------------------------

/**
 * Disallow rules from https://www.secretcv.com/robots.txt (User-agent: *),
 * snapshot taken 2026-11-09. The file starts with `Allow: /`, so a URL is
 * allowed unless one of these (longer, hence more specific) rules matches.
 * Every URL the CLI builds or is handed is checked against this list before
 * it is fetched, so a keyword like "araştırma" (slug /is-ilanlari/arastirma...,
 * which the prefix rule /is-ilanlari/ara covers) is refused, not fetched.
 */
export const ROBOTS_DISALLOW: readonly string[] = [
  "/banner/redirect/*",
  "/ilan-begen-iptal/*",
  "*hesabim*",
  "/is-ilanlari/ara",
  "/cikis-yap",
  "*kvkk-modal?ilanId=*",
  "*ara?k=*",
  "*/?ilanId=*",
  "*/?sf=*",
  "*/?redirect=*",
  "*/?k=*",
  "*/?s=*",
  "*/?b=*",
  "*/?p=*",
  "*/?o=*",
  "*/?wtime=*",
  "*/?parameters=*",
  "/qr-basvuru",
  "/yeniden-biz",
]

/** Compile a robots.txt path pattern (`*` wildcard, optional `$` end anchor). */
function robotsRuleToRegExp(rule: string): RegExp {
  const anchored = rule.endsWith("$")
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp("^" + body + (anchored ? "$" : ""))
}

const ROBOTS_RES = ROBOTS_DISALLOW.map(robotsRuleToRegExp)

/** Whether robots.txt lets a generic crawler fetch this URL (path + query). */
export function robotsAllows(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url, BASE_URL)
  } catch {
    return false
  }
  const target = parsed.pathname + parsed.search
  return !ROBOTS_RES.some((re) => re.test(target))
}

export class RobotsDisallowedError extends Error {}

/**
 * Fetch HTML with exponential backoff and jitter on 429/5xx. Returns "" on a
 * 404. Refuses (before any request) a URL that robots.txt disallows, and
 * discards a response whose redirect landed on one.
 */
export async function htmlFetch(url: string): Promise<string> {
  if (!robotsAllows(url)) {
    throw new RobotsDisallowedError(`refusing to fetch ${url}: secretcv.com robots.txt disallows this path`)
  }
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
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    if (response.url && !robotsAllows(response.url)) {
      throw new RobotsDisallowedError(`${url} redirected to ${response.url}, which secretcv.com robots.txt disallows`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Turkish-aware slug, the form secretcv uses in its URLs:
 * "Web Tasarım" -> "web-tasarim", "İstanbul Avrupa" -> "istanbul-avrupa".
 */
export function slugify(text: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" }
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîû]/g, (c) => map[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// secretcv's rich-text descriptions use named entities for Turkish letters
// (&ouml; &uuml; &ccedil; ...), so the table is wider than LinkedIn's.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü", ccedil: "ç", Ccedil: "Ç",
  scedil: "ş", Scedil: "Ş", gbreve: "ğ", Gbreve: "Ğ", imath: "ı", inodot: "ı", Idot: "İ",
  acirc: "â", Acirc: "Â", icirc: "î", Icirc: "Î", ucirc: "û", Ucirc: "Û",
  aacute: "á", eacute: "é", Eacute: "É", iacute: "í", oacute: "ó", uacute: "ú",
  agrave: "à", egrave: "è", auml: "ä", Auml: "Ä",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", sbquo: "‚", bdquo: "„",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·",
  laquo: "«", raquo: "»", deg: "°", copy: "©", reg: "®", trade: "™",
  euro: "€", times: "×", shy: "",
}

/** Decode entities in a single pass, so "&amp;lt;" stays the text "&lt;". */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return numericEntity(cp)
    }
    return NAMED_ENTITIES[ref] ?? whole
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

/** Visible text of an HTML fragment, tags stripped and entities decoded, on one line. */
export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/** Visible text of a rich-text fragment with paragraph, list and line breaks kept as newlines. */
export function cleanMultiline(html: string): string | null {
  // Hidden markup goes before the line split: a hidden element can span the
  // breaks, and cleaning line by line would only see half of it.
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|ul|ol|div|h\d|tr)>/gi, "\n")
  const text = withBreaks
    .split("\n")
    .map(clean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

/** Inner HTML of the <div> whose opening tag starts at `start`, nesting-aware. */
export function extractDivAt(html: string, start: number): string | null {
  const openEnd = html.indexOf(">", start)
  if (openEnd === -1) return null
  let i = openEnd + 1
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
  return html.slice(openEnd + 1, i - 6)
}

const TR_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" })

/**
 * Age in days of a card's relative date ("Bugün", "Dün", "6 gün önce",
 * "1 ay 11 gün önce", "3 saat önce"). Months count as 30 days and years as
 * 365, so dates older than a few weeks are approximate. null = unrecognised.
 */
export function relativeAgeDays(text: string): number | null {
  const t = text.toLocaleLowerCase("tr-TR").trim()
  if (!t) return null
  if (/^(bugün|az önce|şimdi)/.test(t)) return 0
  if (/^dün/.test(t)) return 1
  let days = 0
  let matched = false
  const units: [RegExp, number][] = [
    [/(\d+)\s*yıl/, 365],
    [/(\d+)\s*ay\b/, 30],
    [/(\d+)\s*hafta/, 7],
    [/(\d+)\s*gün/, 1],
    [/(\d+)\s*(saat|dakika|dk|sn|saniye)/, 0],
  ]
  for (const [re, mult] of units) {
    const m = t.match(re)
    if (m) {
      days += parseInt(m[1], 10) * mult
      matched = true
    }
  }
  return matched ? days : null
}

/** ISO date (YYYY-MM-DD, Istanbul time) `days` before `now`. */
export function isoDateDaysAgo(days: number, now: Date = new Date()): string {
  return TR_DATE.format(new Date(now.getTime() - days * 86400000))
}

// ---------------------------------------------------------------------------
// Search parsing
// ---------------------------------------------------------------------------

export interface JobCard {
  /** Pass this to `detail`: "<company-slug>/<job-slug>-is-ilanlari-<jobId>". */
  id: string
  /** secretcv's numeric posting number. */
  jobId: string
  title: string
  company: string | null
  location: string | null
  /** Approximate ISO posting date, derived from the card's relative date. */
  date: string | null
  /** The card's own relative date text, e.g. "6 gün önce". */
  dateText: string | null
  /** Age in days derived from dateText (months = 30 days). */
  ageDays: number | null
  url: string
}

const POSTING_PATH = /^\/([a-z0-9-]+)\/([a-z0-9-]+-is-ilanlari-(\d+))\/?$/

/** Split a secretcv posting URL into its detail key and numeric ID, or null if it is not one. */
export function postingKey(href: string): { id: string; jobId: string; url: string } | null {
  let u: URL
  try {
    u = new URL(href, BASE_URL)
  } catch {
    return null
  }
  if (!HOST.test(u.hostname)) return null
  const m = u.pathname.match(POSTING_PATH)
  if (!m) return null
  return { id: `${m[1]}/${m[2]}`, jobId: m[3], url: `${BASE_URL}/${m[1]}/${m[2]}` }
}

/**
 * Parse the listing page: one `cv-job-box job-list` card per posting (ad
 * slots are `cv-job-box cv-ads` and are skipped). Each card is parsed on its
 * own, so one malformed card cannot break the rest.
 */
export function parseJobCards(html: string, now: Date = new Date()): JobCard[] {
  const results: JobCard[] = []
  const seen = new Set<string>()
  const chunks = html.split(/<div class="cv-job-box job-list\b/).slice(1)

  for (const raw of chunks) {
    // Bound each chunk at the next card-sized box so the last card cannot pick
    // up fields from the pagination or footer that follow it.
    const stop = raw.search(/<div class="cv-job-box\b|<nav\b/)
    const chunk = stop === -1 ? raw : raw.slice(0, stop)

    const a = chunk.match(/<a\s+([^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i)
    if (!a) continue
    const href = a[1].match(/href="([^"]+)"/i)?.[1]
    const key = href ? postingKey(decodeHtmlEntities(href)) : null
    if (!key || seen.has(key.jobId)) continue

    const titleAttr = a[1].match(/title="([^"]*)"/i)?.[1] ?? ""
    const title = clean(a[2]) || clean(titleAttr)
    if (!title) continue

    const comp = chunk.match(/class="company\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span)>/i)
    const company = comp ? clean(comp[1]) || null : null

    const loc = chunk.match(/class="city\b[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i)
    const location = loc ? clean(loc[1]) || null : null

    const dt = chunk.match(/İlan Tarihi:\s*([^<]*)</i)
    const dateText = dt ? clean(dt[1]) || null : null
    const ageDays = dateText ? relativeAgeDays(dateText) : null

    seen.add(key.jobId)
    results.push({
      id: key.id,
      jobId: key.jobId,
      title,
      company,
      location,
      date: ageDays === null ? null : isoDateDaysAgo(ageDays, now),
      dateText,
      ageDays,
      url: key.url,
    })
  }
  return results
}

/** The filters secretcv says it applied, from the page's hidden `searchParameters` input. */
export interface AppliedFilters {
  /** City IDs. */
  sh: number[]
  /** District IDs. */
  ilc: number[]
  /** Free-text keyword, when the slug was read as one. */
  k: string | null
  /** Position IDs, when the slug matched a known position. */
  p: number[]
  /** Sector IDs. */
  s: number[]
}

/**
 * Read the hidden `<input class="searchParameters" value='{...}'>`. It is the
 * only reliable signal of what a slug URL actually filtered on: an
 * unrecognised keyword under a city (/is-ilanlari/bursa/<kw>-is-ilanlari) is
 * silently dropped and the page lists every job in the city.
 */
export function parseAppliedFilters(html: string): AppliedFilters | null {
  const tag = html.match(/<input\b[^>]*\bclass="searchParameters"[^>]*>/i)?.[0]
  if (!tag) return null
  const raw = tag.match(/\bvalue='([^']*)'/)?.[1] ?? tag.match(/\bvalue="([^"]*)"/)?.[1]
  if (raw === undefined) return null
  let obj: Record<string, unknown> | null = null
  for (const candidate of [raw, decodeHtmlEntities(raw)]) {
    try {
      obj = JSON.parse(candidate)
      break
    } catch {
      /* try the next form */
    }
  }
  if (!obj || typeof obj !== "object") return null
  const nums = (v: unknown): number[] =>
    Array.isArray(v) ? v.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : []
  const k = typeof obj.k === "string" && obj.k.trim() ? obj.k.trim() : null
  return { sh: nums(obj.sh), ilc: nums(obj.ilc), k, p: nums(obj.p), s: nums(obj.s) }
}

/** Number of the last results page the portal links to (1 when it shows no pager). */
export function parseLastPage(html: string): number {
  const m = html.match(/href="[^"]*?[?&]sf=(\d+)"[^>]*title="Son Sayfa"/i)
  return m ? parseInt(m[1], 10) : 1
}

// ---------------------------------------------------------------------------
// Detail parsing
// ---------------------------------------------------------------------------

export interface JobDetail {
  id: string
  jobId: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  deadline: string | null
  url: string
  employmentType: string | null
  sector: string | null
  education: string | null
  openings: string | null
  districts: string | null
  description: string | null
}

/** The schema.org JobPosting the page embeds as JSON-LD, or null. */
export function findJobPostingLd(html: string): Record<string, unknown> | null {
  const re = /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    let data: unknown
    try {
      data = JSON.parse(m[1])
    } catch {
      continue
    }
    const items = Array.isArray(data) ? data : [data]
    for (const item of items) {
      if (item && typeof item === "object" && (item as Record<string, unknown>)["@type"] === "JobPosting") {
        return item as Record<string, unknown>
      }
    }
  }
  return null
}

function ldString(v: unknown): string | null {
  return typeof v === "string" && v.trim() && v.trim() !== "-" ? clean(v) || null : null
}

/** Parse a posting page. `key` is the detail key ("<company>/<slug>-is-ilanlari-<id>"). */
export function parseJobDetail(html: string, key: { id: string; jobId: string; url: string }): JobDetail {
  const ld = findJobPostingLd(html) ?? {}
  const org = (ld.hiringOrganization ?? {}) as Record<string, unknown>
  const place = (ld.jobLocation ?? {}) as Record<string, unknown>
  const addr = (Array.isArray(place.address) ? place.address[0] : place.address ?? {}) as Record<string, unknown>

  // Top card: <span class="text-dark fs-16">title</span> <span class="company">...
  const box = html.match(/class="cv-job-box cv-job-box-xs"[\s\S]*?<div class="body">([\s\S]*?)<div class="right">/i)?.[1] ?? ""
  const boxTitle = box.match(/<span class="text-dark fs-16">([\s\S]*?)<\/span>/i)?.[1]
  const boxCompany = box.match(/<span class="company">([\s\S]*?)<\/span>/i)?.[1]
  const boxCity = box.match(/class="city\b[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]

  const title = ldString(ld.title) ?? (boxTitle ? clean(boxTitle) : "") ?? ""
  const company = ldString(org.name) ?? (boxCompany ? clean(boxCompany) || null : null)
  const location = (boxCity ? clean(boxCity) || null : null) ?? ldString(addr.addressLocality)

  // Description: the first `cv-card content-job` block, up to its buttons row.
  let description: string | null = null
  const start = html.indexOf('<div class="cv-card content-job">')
  if (start !== -1) {
    let body = extractDivAt(html, start) ?? ""
    const cut = body.search(/<div class="buttons\b/)
    if (cut !== -1) body = body.slice(0, cut)
    body = body
      .replace(/<h2\b[^>]*class="cj-title"[^>]*>[\s\S]*?<\/h2>/i, "")
      .replace(/<span\b[^>]*class="cj-title[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "<p>$1</p>")
    description = cleanMultiline(body)
  }
  if (!description) description = ldString(ld.description)

  // Fact table: <span class="title">Label</span> ... <span class="desc">Value</span>
  const facts: Record<string, string> = {}
  const tableStart = html.indexOf('class="cv-card content-job-table"')
  if (tableStart !== -1) {
    const table = html.slice(tableStart, tableStart + 20000)
    const re = /<span class="title">([\s\S]*?)<\/span>[\s\S]*?<span class="desc">([\s\S]*?)<\/span>/gi
    let f: RegExpExecArray | null
    while ((f = re.exec(table)) !== null) {
      const label = clean(f[1]).toLocaleLowerCase("tr-TR")
      const value = clean(f[2]).replace(/\s*,\s*$/, "").replace(/\s+,/g, ",")
      if (label && value && !(label in facts)) facts[label] = value
    }
  }
  const fact = (label: string): string | null => facts[label.toLocaleLowerCase("tr-TR")] ?? null

  const datePosted = ldString(ld.datePosted)
  const validThrough = ldString(ld.validThrough)

  return {
    id: key.id,
    jobId: key.jobId,
    title: title || "(untitled)",
    company,
    location,
    date: datePosted ? datePosted.slice(0, 10) : null,
    deadline: validThrough ? validThrough.slice(0, 10) : null,
    url: key.url,
    employmentType: ldString(ld.employmentType) ?? fact("İstihdam Türü"),
    sector: fact("Sektör"),
    education: fact("Eğitim Seviyesi"),
    openings: fact("Eleman Sayısı"),
    districts: fact("İlçeler"),
    description,
  }
}
