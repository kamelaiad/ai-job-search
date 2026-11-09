// Data source: elemanonline.com.tr public job pages. No authentication required.
// The site is a Next.js app: every server-rendered page embeds its data as JSON
// in <script id="__NEXT_DATA__">. The visible results list is rendered
// client-side (the static HTML only says "no records"), so the CLI reads that
// embedded JSON instead of the card markup, and parses each job entry
// independently so one malformed entry cannot break the rest.
//
// robots.txt (checked 2026-11-09): "User-agent: *" / "Allow: /" - nothing is
// disallowed. The site's terms forbid copying or redistributing its content
// without written permission, so this is for personal job searching only.

export const BASE_URL = "https://www.elemanonline.com.tr"
export const SEARCH_PATH = "/is-ilanlari"
export const DETAIL_PATH = "/is-ilani"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** An Error carrying a machine-readable code for the stderr JSON. */
export class CliError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

const UA = "Mozilla/5.0 (compatible; elemanonline-cli/1.0)"

export interface FetchOpts {
  /** Treat a 3xx redirect as "not found" instead of following it. */
  redirectIsNotFound?: boolean
}

/**
 * Fetch HTML with exponential backoff (plus jitter) on 429/5xx. Returns "" on
 * a 404, and on a redirect when `redirectIsNotFound` is set: an unknown job id
 * answers 301 -> /is-ilanlari, and following it would parse the listing page.
 */
export async function htmlFetch(url: string, opts: FetchOpts = {}): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      },
      redirect: opts.redirectIsNotFound ? "manual" : "follow",
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
    if (opts.redirectIsNotFound && response.status >= 300 && response.status < 400) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  url: string
  workType: string | null
  salary: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  workPreference: string | null
  department: string | null
  gender: string | null
  ageRange: string | null
  status: string | null
}

export interface SearchPage {
  cards: JobCard[]
  total: number | null
  totalPages: number | null
  /** The province the site resolved the location slug to; null = nationwide. */
  provinceId: string | null
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
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
  return visibleHtml(html).replace(/<[^>]+>/g, " ")
}

/** Whether a string carries markup (the site's JSON fields are usually plain text). */
function looksLikeHtml(text: string): boolean {
  return /<\/?[a-zA-Z][^>]*>|<!--/.test(text)
}

/** One-line text: hidden markup dropped, tags stripped, entities decoded, whitespace collapsed. */
export function cleanInline(raw: string): string {
  const text = looksLikeHtml(raw) ? stripTags(raw) : raw
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim()
}

/**
 * Multi-line text for a job description. Plain-text newlines are kept; when the
 * field carries markup, hidden elements go first (visibleHtml), then line-level
 * tags become newlines and the rest are stripped. Entities are decoded after
 * the tag strip so an encoded "&lt;tag&gt;" stays literal text.
 */
export function textFromHtml(raw: string): string | null {
  let src = raw.replace(/\r\n?/g, "\n")
  if (looksLikeHtml(src)) {
    src = visibleHtml(src)
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  }
  const text = decodeHtmlEntities(src)
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

type Obj = Record<string, unknown>

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null
}

/** A cleaned non-empty string, or null. Numbers are stringified (salary may be numeric). */
function str(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v !== "string") return null
  return cleanInline(v) || null
}

/** Keep a date only if it parses; the raw ISO string is emitted unchanged. */
function isoDate(v: unknown): string | null {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null
}

/**
 * Transliterate a Turkish place name to the site's URL slug:
 * "İstanbul" -> "istanbul", "İstanbul Avrupa" -> "istanbul-avrupa",
 * "Eskişehir" -> "eskisehir". Mapped before lowercasing because
 * "İ".toLowerCase() is "i" plus a combining dot.
 */
export function turkishSlug(input: string): string {
  const map: Record<string, string> = {
    ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", I: "i", İ: "i", ö: "o", Ö: "o",
    ş: "s", Ş: "s", ü: "u", Ü: "u", â: "a", Â: "a", î: "i", Î: "i", û: "u", Û: "u",
  }
  return input
    .trim()
    .replace(/[çÇğĞıIİöÖşŞüÜâÂîÎûÛ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Read the page's embedded Next.js data; a missing or broken block is a loud error, not 0 results. */
export function extractNextData(html: string): Obj {
  const m = html.match(/<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (!m) {
    throw new CliError(
      "page carries no __NEXT_DATA__ block - the site markup changed (see url-reference.md)",
      "PARSE_FAILED",
    )
  }
  let data: unknown
  try {
    data = JSON.parse(m[1])
  } catch {
    throw new CliError("__NEXT_DATA__ block is not valid JSON", "PARSE_FAILED")
  }
  const root = obj(data)
  if (!root) throw new CliError("__NEXT_DATA__ block is not an object", "PARSE_FAILED")
  return root
}

function pageProps(data: Obj): Obj | null {
  return obj(obj(data.props)?.pageProps)
}

/** "Town, Province" for each location entry, de-duplicated and joined with "; ". */
function formatLocations(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  const parts: string[] = []
  for (const entry of v) {
    const l = obj(entry)
    if (!l) continue
    const prov = str(l.provinceText)
    const town = str(l.townText)
    const label = prov && town && prov !== town ? `${town}, ${prov}` : prov ?? town
    if (label && !parts.includes(label)) parts.push(label)
  }
  return parts.length ? parts.join("; ") : null
}

const JOB_ID = /^[a-f0-9]{24}$/i
const JOB_SLUG = /^\/is-ilani\/[a-z0-9-]+\/[a-f0-9]{24}$/i
const COMPANY_SLUG = /^\/firma\/[a-z0-9-]+\/[a-z0-9]+$/i

/** Map one job entry to a card. Returns null for an entry without an id or title. */
function parseJobEntry(entry: unknown): JobCard | null {
  const e = obj(entry)
  if (!e) return null
  const id = typeof e._id === "string" && JOB_ID.test(e._id) ? e._id : null
  const title = str(e.position)
  if (!id || !title) return null
  const slug = typeof e.slug === "string" && JOB_SLUG.test(e.slug) ? e.slug : null
  const company = obj(e.company)
  const companySlug = company && typeof company.slug === "string" && COMPANY_SLUG.test(company.slug)
    ? company.slug
    : null
  return {
    id,
    title,
    company: company ? str(company.title) : null,
    companyUrl: companySlug ? `${BASE_URL}${companySlug}` : null,
    location: formatLocations(e.location),
    date: isoDate(e.publishDate),
    url: `${BASE_URL}${slug ?? `${DETAIL_PATH}/ilan/${id}`}`,
    workType: str(e.workingTypeText),
    salary: str(e.salary),
  }
}

/**
 * Parse a search-results page. Each job entry is mapped independently inside
 * its own try, so one malformed entry is skipped instead of failing the page.
 * Sponsored "showcase" entries (jobs.jobsShowcase) are not search matches and
 * are left out.
 */
export function parseSearchPage(html: string): SearchPage {
  const pp = pageProps(extractNextData(html))
  const jobs = obj(pp?.jobs)
  if (!pp || !jobs || !Array.isArray(jobs.jobs)) {
    throw new CliError(
      "search page has no jobs list in __NEXT_DATA__ - the site markup changed (see url-reference.md)",
      "PARSE_FAILED",
    )
  }
  const cards: JobCard[] = []
  for (const entry of jobs.jobs) {
    try {
      const card = parseJobEntry(entry)
      if (card) cards.push(card)
    } catch {
      // One bad entry must not break the rest.
    }
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
  const query = obj(pp.query) ?? obj(jobs.filters)
  const province = query?.provinceId
  return {
    cards,
    total: num(jobs.totalItems),
    totalPages: num(jobs.totalPages),
    provinceId: typeof province === "string" || typeof province === "number" ? String(province) : null,
  }
}

/** Parse a job page. Returns null when the page carries no job (unknown or removed posting). */
export function parseDetailPage(html: string, id: string): JobDetail | null {
  const job = obj(pageProps(extractNextData(html))?.job)
  if (!job) return null
  const card = parseJobEntry(job)
  if (!card) return null
  const departments = Array.isArray(job.sdp)
    ? [...new Set(job.sdp.map((s) => str(obj(s)?.departmentText)).filter((s): s is string => !!s))]
    : []
  const minAge = typeof job.minAge === "number" ? job.minAge : null
  const maxAge = typeof job.maxAge === "number" ? job.maxAge : null
  const ageRange =
    minAge !== null && maxAge !== null ? `${minAge}-${maxAge}`
      : minAge !== null ? `${minAge}+`
        : maxAge !== null ? `<=${maxAge}`
          : null
  return {
    ...card,
    id: card.id || id,
    description: typeof job.content === "string" ? textFromHtml(job.content) : null,
    workPreference: str(job.workingPreferenceText),
    department: departments.length ? departments.join(", ") : null,
    gender: str(job.genderText),
    ageRange,
    status: str(job.status),
  }
}
