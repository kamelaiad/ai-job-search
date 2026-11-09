// Data source: Youthall's public, server-rendered listing and posting pages
// (www.youthall.com). No authentication and no JSON API: search parses the
// HTML results list, detail parses one posting page (visible markup first,
// the page's schema.org JobPosting JSON-LD only for validated dates/enums).
// robots.txt allows the listing filters (?query, ?city, ?type, ?page) and the
// posting pages for User-agent: * (checked 2026-11-09).

export const BASE_URL = "https://www.youthall.com"
export const SEARCH_URL = `${BASE_URL}/tr/is-ilanlari/`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; youthall-cli/1.0)"

export interface FetchResult {
  /** Response body; "" on a 404. */
  html: string
  /** URL after redirects (Youthall redirects /tr/ to /en/ for English postings). */
  finalUrl: string
}

/** Fetch HTML with exponential backoff and jitter on 429/5xx. Returns html "" on a 404. */
export async function htmlFetch(url: string): Promise<FetchResult> {
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
    if (response.status === 404) return { html: "", finalUrl: response.url || url }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return { html: await response.text(), finalUrl: response.url || url }
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  /** "<companySlug>/<postingSlug>", e.g. "Youthall/grafik-tasarim-stajyeri_154". Pass to `detail`. */
  id: string
  title: string
  company: string | null
  /** First listed city; see multipleLocations. */
  location: string | null
  /** True when the card shows "+" after the city (the posting lists more cities). */
  multipleLocations: boolean
  /** Listing type label as shown, e.g. "Stajyer", "Tam Zamanlı", "Yeni Mezun". */
  type: string | null
  /** Posting date. Always null in search: result cards only show the deadline. Use `detail`. */
  date: string | null
  /** Application deadline (ISO YYYY-MM-DD), from the card's clock tag. */
  deadline: string | null
  /** Teaser text shown on the card. */
  snippet: string | null
  url: string
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  locations: string[]
  /** Posting date (ISO YYYY-MM-DD). */
  date: string | null
  deadline: string | null
  department: string | null
  type: string | null
  /** schema.org employmentType, e.g. INTERN, FULL_TIME. */
  employmentType: string | null
  salary: string | null
  hiringProcess: string[]
  description: string | null
  applyUrl: string | null
  /** false when the deadline has passed; null when no deadline was found. */
  isActive: boolean | null
  url: string
}

// ---------------------------------------------------------------------------
// Text hygiene (copied from linkedin-search/cli/src/helpers.ts)
// ---------------------------------------------------------------------------

/**
 * Extract the inner HTML of a <div> identified by a CSS class name, correctly
 * handling nested <div> elements by tracking tag depth. `from` is the offset
 * to start searching at.
 */
export function extractDivContent(html: string, className: string, from = 0): { inner: string; end: number } | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<div[^>]*class="(?:[^"]*\\s)?${escaped}(?:\\s[^"]*)?"[^>]*>`, "gi")
  openRe.lastIndex = from
  const open = openRe.exec(html)
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

  return { inner: html.slice(open.index + open[0].length, i - 6), end: i }
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", bull: "•",
  ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü",
  iacute: "í", eacute: "é", agrave: "à", acirc: "â", icirc: "î", ucirc: "û",
  reg: "®", copy: "©", trade: "™", euro: "€",
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
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

// Inline elements render without a gap, so they are removed outright; block
// tags become a space. Otherwise "<strong>voice</strong>," reads "voice ,".
const INLINE_TAG = /<\/?(?:a|abbr|b|code|em|font|i|mark|small|span|strong|sub|sup|u)\b[^>]*>/gi

function stripTags(html: string): string {
  return visibleHtml(html).replace(INLINE_TAG, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** Visible text of an HTML fragment: hidden markup dropped, tags stripped, entities decoded, whitespace collapsed. */
export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/** Visible text with paragraph and list structure kept as line breaks. */
export function richText(html: string): string | null {
  // Hidden markup goes before the line split: a hidden element can span the
  // breaks, and cleaning line by line would only see half of it.
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/li\s*>/gi, "")
    .replace(/<\/(p|ul|ol|div|h\d)>/gi, "\n")
  const text = withBreaks
    .split("\n")
    .map((line) => (line.trim().startsWith("•") ? "• " + clean(line.trim().slice(1)) : clean(line)))
    .filter((line) => line !== "•")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

// ---------------------------------------------------------------------------
// Youthall-specific parsing
// ---------------------------------------------------------------------------

/** "09.11.2026" -> "2026-11-09"; null when the text holds no such date. */
export function trDateToIso(text: string | null | undefined): string | null {
  const m = (text || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
}

/**
 * City name -> Youthall's city-page slug, e.g. "İstanbul" -> "istanbul",
 * "Eskişehir" -> "eskisehir". Turkish dotted/dotless i both fold to "i".
 */
export function citySlug(input: string): string {
  const folded = input
    .trim()
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
  return folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/** Listing types Youthall's filter accepts as `type[]=<value>`. */
export const LISTING_TYPES: Record<string, string> = {
  internship: "Stajyer",
  mt_internship: "Management Trainee",
  new_graduated: "Yeni Mezun",
  young_professional: "Genç Profesyonel",
  professional: "Profesyonel",
  full_time: "Tam Zamanlı",
  part_time: "Part Time",
  contract: "Sözleşmeli",
  periodic: "Dönemsel",
  project_based: "Proje Bazlı",
  freelance: "Freelance",
  volunteer: "Gönüllü",
  scholarship: "Burs",
}

const POSTING_HOST = /^(?:www\.)?youthall\.com$/i
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
// First path segments that are site sections, not company slugs.
const RESERVED = new Set([
  "is-ilanlari", "jobs", "internship", "youth", "company", "page", "sirketler", "companies",
  "yetenek-programlari", "talent-programs", "etkinlikler", "events", "rehber", "maaslar", "araclar",
  "oyunlar", "ayricaliklar", "okullar", "youth-awards", "crm", "crm-sales", "tryday", "update",
])

/**
 * Accept a posting id ("Company/slug_12"), a site path ("/tr/Company/slug_12/")
 * or a full Youthall posting URL (http(s), www optional, /tr/ or /en/), and
 * return the "Company/slug_12" id. Any other host is rejected, and so is a
 * path that names a site section rather than a company.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let path: string
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^(?:www\.)?youthall\.com(?:\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!POSTING_HOST.test(parsed.hostname) || parsed.username || parsed.password) return null
    path = parsed.pathname
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.includes("?") || trimmed.includes("#")) {
    return null
  } else {
    path = trimmed
  }
  const segments = path.split("/").filter(Boolean)
  if (segments.length === 3 && /^(tr|en)$/i.test(segments[0])) segments.shift()
  if (segments.length !== 2) return null
  const [company, slug] = segments
  if (!SEGMENT.test(company) || !SEGMENT.test(slug)) return null
  if (RESERVED.has(company.toLowerCase())) return null
  return `${company}/${slug}`
}

/** The card list region: the list view container up to the pagination/empty state. */
function resultsRegion(html: string): string {
  const start = html.search(/id="internshipsList"/)
  if (start === -1) return ""
  const rest = html.slice(start)
  const end = rest.search(/<ul class="pagination|class="c-jobs-empty|<\/form>/)
  return end === -1 ? rest : rest.slice(0, end)
}

/** Whether the listing page links a next page. */
export function hasNextPage(html: string): boolean {
  return /<a[^>]*class="page-link"[^>]*rel="next"|<a[^>]*rel="next"[^>]*class="page-link"/i.test(html)
}

/**
 * Parse the search results page. Youthall renders every result twice (a grid
 * card and a list row) plus a "featured" carousel that ignores the query; only
 * the list rows inside #internshipsList are used. The region is split into
 * one chunk per `jobs-row` and each chunk is parsed independently, so one
 * malformed card cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = resultsRegion(html).split(/class="jobs-row"/).slice(1)

  for (const chunk of chunks) {
    const linkTag = chunk.match(/<a\b[^>]*class="jobs-row__link"[^>]*>/i)?.[0]
    const href = linkTag?.match(/href="([^"]+)"/i)?.[1]
    if (!href) continue
    const url = new URL(decodeHtmlEntities(href), BASE_URL).toString()
    const id = normalizeId(url)
    if (!id) continue

    const titleBlock = chunk.match(/class="jobs-row__title"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""
    const titleHtml = titleBlock.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i)?.[1]
    const title = titleHtml ? clean(titleHtml) : ""
    if (!title) continue

    const companyHtml = chunk.match(/class="jobs-row__company"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
    const company = companyHtml ? clean(companyHtml) || null : null

    const descHtml = chunk.match(/class="jobs-row__desc"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
    const snippet = descHtml ? clean(descHtml) || null : null

    let type: string | null = null
    let deadline: string | null = null
    let location: string | null = null
    let multipleLocations = false
    for (const tag of chunk.split(/class="jobs-tag"/).slice(1)) {
      const body = tag.slice(0, tag.indexOf("</div>") === -1 ? undefined : tag.indexOf("</div>"))
      const text = clean(body.replace(/^[^>]*>/, ""))
      if (/fa-briefcase/.test(body)) type = text || null
      else if (/fa-clock/.test(body)) deadline = trDateToIso(text)
      else if (/fa-map-marker/.test(body)) {
        multipleLocations = /\+\s*$/.test(text)
        location = text.replace(/\s*\+\s*$/, "").trim() || null
      }
    }

    results.push({ id, title, company, location, multipleLocations, type, date: null, deadline, snippet, url })
  }

  return results
}

interface JsonLdJobPosting {
  title?: unknown
  datePosted?: unknown
  validThrough?: unknown
  employmentType?: unknown
  hiringOrganization?: { name?: unknown }
}

/** The page's schema.org JobPosting block, or null. */
export function findJobPosting(html: string): JsonLdJobPosting | null {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1])
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        if (item && typeof item === "object" && item["@type"] === "JobPosting") return item as JsonLdJobPosting
      }
    } catch {
      // not valid JSON; ignore this block
    }
  }
  return null
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

/** Sidebar "Detaylar"/"Details" list: <h6>label</h6> <small>value</small> pairs, keyed by lowercased label. */
function sidebarFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const re = /<h6[^>]*>([\s\S]*?)<\/h6>\s*(?:<[^>]+>\s*)*?<small[^>]*>([\s\S]*?)<\/small>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const label = clean(m[1]).toLocaleLowerCase("tr")
    if (label && !(label in fields)) fields[label] = clean(m[2])
  }
  return fields
}

function field(fields: Record<string, string>, ...labels: string[]): string | null {
  for (const l of labels) {
    const v = fields[l.toLocaleLowerCase("tr")]
    if (v) return v
  }
  return null
}

/** Parse a single posting page. Returns null when the page is not a posting. */
export function parseJobDetail(html: string, id: string, url: string, now: Date = new Date()): JobDetail | null {
  const ld = findJobPosting(html)
  const info = html.match(/class="c-job_info_title"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""
  const visibleTitle = info.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]
  const visibleCompany = info.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  if (!ld && !visibleTitle) return null

  const title =
    (visibleTitle ? clean(visibleTitle) : "") ||
    (typeof ld?.title === "string" ? clean(ld.title) : "") ||
    "(untitled)"
  const company =
    (visibleCompany ? clean(visibleCompany) : "") ||
    (typeof ld?.hiringOrganization?.name === "string" ? clean(ld.hiringOrganization.name) : "") ||
    null

  // Description and the optional hiring-process list share the
  // c-job_post_content class; the first block is the description.
  const blocks: string[] = []
  let from = 0
  for (;;) {
    const block = extractDivContent(html, "c-job_post_content", from)
    if (!block) break
    blocks.push(block.inner)
    from = block.end
  }
  const description = blocks.length > 0 ? richText(blocks[0]) : null
  const hiringProcess: string[] = []
  for (const block of blocks.slice(1)) {
    for (const li of block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const step = clean(visibleHtml(li[1]))
      if (step) hiringProcess.push(step)
    }
  }

  const fields = sidebarFields(html)
  const locationsText = field(fields, "çalışma lokasyonları", "working locations", "lokasyon", "location")
  const locations = (locationsText || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const location =
    locations.length === 0
      ? null
      : locations.length > 5
        ? `${locations.slice(0, 5).join(", ")} +${locations.length - 5} more`
        : locations.join(", ")

  const date = isoDate(ld?.datePosted) ?? trDateToIso(field(fields, "yayınlanma tarihi", "posted date"))
  const deadline = isoDate(ld?.validThrough) ?? trDateToIso(field(fields, "son başvuru", "application deadline"))
  const employmentType =
    typeof ld?.employmentType === "string" && /^[A-Z_]{2,20}$/.test(ld.employmentType) ? ld.employmentType : null

  const applyHref = html.match(/href="(\/(?:tr|en)\/internship\/\d+\/apply\/?)"/i)?.[1]
  const applyUrl = applyHref ? new URL(applyHref, BASE_URL).toString() : null

  let isActive: boolean | null = null
  if (deadline) {
    const today = now.toISOString().slice(0, 10)
    isActive = deadline >= today
  }

  return {
    id,
    title,
    company,
    location,
    locations,
    date,
    deadline,
    department: field(fields, "departman", "job function", "department"),
    type: field(fields, "ilan türü", "type"),
    employmentType,
    salary: field(fields, "maaş", "salary"),
    hiringProcess,
    description,
    applyUrl,
    isActive,
    url,
  }
}
