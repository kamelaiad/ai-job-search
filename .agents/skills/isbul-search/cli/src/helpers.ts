// Data source: isbul.net's official, documented Agent API
// (https://www.isbul.net/api/agent, spec at /api/agent/openapi.json, docs at
// /llms-full.txt). Public, no authentication, JSON in and out.
//
// robots.txt (checked 2026-11-09) disallows /api/ in general but explicitly
// allows /api/agent and /api/agent/* for every user agent; it also disallows
// any URL carrying a `query=` parameter, so this CLI only ever sends `q=`.
// The API's fair-use notes ask for per_page <= 25 and no parallel bulk
// scraping. The site's terms forbid copying or redistributing its content
// without written permission, so this is for personal job searching only.

export const API_BASE = "https://www.isbul.net/api/agent"
export const SITE_BASE = "https://www.isbul.net"
/** Fixed page size: the API maximum, so a search costs as few requests as possible. */
export const PER_PAGE = 25

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

const UA = "Mozilla/5.0 (compatible; isbul-cli/1.0)"

/**
 * Fetch JSON with exponential backoff (plus jitter) on 429/5xx. Returns null
 * on a 404. A 400 is the API's "unknown filter value" answer (e.g. a city slug
 * it does not know) and becomes a CliError instead of a crash.
 */
export async function jsonFetch(url: string): Promise<unknown> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
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
    if (response.status === 400) throw badFilterError(await response.text())
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    try {
      return await response.json()
    } catch {
      throw new CliError("API response is not valid JSON", "PARSE_FAILED")
    }
  }
  throw new Error("Request failed after max retries")
}

/**
 * Build our own message from the 400 body's `parameter`/`value` fields rather
 * than relaying the API's free-text message (third-party text).
 */
function badFilterError(body: string): CliError {
  let parameter = ""
  let value = ""
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    if (typeof parsed.parameter === "string") parameter = parsed.parameter
    if (typeof parsed.value === "string") value = parsed.value
  } catch {
    // Not JSON: fall through to the generic message.
  }
  parameter = stripInvisible(parameter).replace(/[^a-z_]/gi, "").slice(0, 20)
  value = stripInvisible(value).slice(0, 80)
  if (parameter === "city") {
    return new CliError(
      `unknown location "${value}" - use a Turkish city such as "İstanbul", "Bursa", "Ankara", "İzmir", "Antalya", "Kocaeli"`,
      "UNKNOWN_LOCATION",
    )
  }
  return new CliError(
    parameter ? `the API rejected ${parameter}="${value}"` : "the API rejected the request (HTTP 400)",
    "BAD_REQUEST",
  )
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  slug: string | null
  workType: string | null
  position: string | null
  sector: string | null
  salary: string | null
  expiresAt: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  educationLevel: string | null
  experienceLevel: string | null
  vacancyCount: number | null
  status: string | null
  isOpen: boolean | null
}

export interface SearchPage {
  cards: JobCard[]
  total: number | null
  lastPage: number | null
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


/** Whether a string carries markup (the API documents plain text, but check anyway). */
function looksLikeHtml(text: string): boolean {
  return /<\/?[a-zA-Z][^>]*>|<!--/.test(text)
}

/** One-line text: hidden markup dropped, tags stripped, entities decoded, whitespace collapsed. */
export function cleanInline(raw: string): string {
  const text = looksLikeHtml(raw) ? visibleHtml(raw).replace(/<[^>]+>/g, " ") : raw
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim()
}

/**
 * Multi-line description text. Plain-text newlines are kept; if the field
 * carries markup, hidden elements go first (visibleHtml), line-level tags
 * become newlines and the rest are stripped. Entities are decoded after the
 * tag strip so an encoded "&lt;tag&gt;" stays literal text.
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
 * Transliterate a Turkish place name to the API's city slug:
 * "İstanbul" -> "istanbul", "Eskişehir" -> "eskisehir". Mapped before
 * lowercasing because "İ".toLowerCase() is "i" plus a combining dot.
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

/** Listing ids are UUIDs and slugs are kebab-case; both are path-safe with this check. */
export const ID_OR_SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i

/** The API's url when it points at isbul.net, else one built from the slug. */
function jobUrl(rawUrl: unknown, slug: string | null, id: string): string {
  if (typeof rawUrl === "string") {
    try {
      const u = new URL(rawUrl)
      if (u.protocol === "https:" && /^(www\.)?isbul\.net$/i.test(u.hostname) && !u.username && !u.password) {
        return u.toString()
      }
    } catch {
      // fall through
    }
  }
  return `${SITE_BASE}/is-ilani/${slug ?? id}`
}

/** "District, City" or whichever part exists. */
function formatLocation(city: string | null, district: string | null): string | null {
  if (city && district && city !== district) return `${district}, ${city}`
  return city ?? district
}

/** Map one API listing to a card. Returns null for an entry without a usable id or title. */
function parseListing(entry: unknown): JobCard | null {
  const e = obj(entry)
  if (!e) return null
  const id = typeof e.id === "string" && ID_OR_SLUG.test(e.id) ? e.id : null
  const title = str(e.title)
  if (!id || !title) return null
  const slug = typeof e.slug === "string" && ID_OR_SLUG.test(e.slug) ? e.slug : null
  return {
    id,
    title,
    company: str(e.company),
    location: formatLocation(str(e.city), str(e.district)),
    date: isoDate(e.published_at),
    url: jobUrl(e.url, slug, id),
    slug,
    workType: str(e.work_type),
    position: str(e.position),
    sector: str(e.sector),
    salary: str(e.salary),
    expiresAt: isoDate(e.expires_at),
  }
}

/**
 * Parse a /jobs response. Each listing is mapped independently inside its own
 * try, so one malformed entry is skipped instead of failing the page.
 */
export function parseSearchResponse(json: unknown): SearchPage {
  const root = obj(json)
  if (!root || !Array.isArray(root.data)) {
    throw new CliError("API response has no data array - the API changed (see url-reference.md)", "PARSE_FAILED")
  }
  const cards: JobCard[] = []
  for (const entry of root.data) {
    try {
      const card = parseListing(entry)
      if (card) cards.push(card)
    } catch {
      // One bad entry must not break the rest.
    }
  }
  const meta = obj(root.meta)
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
  return { cards, total: num(meta?.total), lastPage: num(meta?.last_page) }
}

/** Parse a /jobs/{id} response. Returns null when it carries no usable listing. */
export function parseDetailResponse(json: unknown): JobDetail | null {
  const data = obj(obj(json)?.data)
  if (!data) return null
  const card = parseListing(data)
  if (!card) return null
  return {
    ...card,
    description: typeof data.description === "string" ? textFromHtml(data.description) : null,
    educationLevel: str(data.education_level),
    experienceLevel: str(data.experience_level),
    vacancyCount: typeof data.vacancy_count === "number" && Number.isFinite(data.vacancy_count) ? data.vacancy_count : null,
    status: str(data.status),
    isOpen: typeof data.is_open === "boolean" ? data.is_open : null,
  }
}

/** Client-side --jobage: keep cards published within the last `days` days. */
export function withinDays(cards: JobCard[], days: number, now = Date.now()): JobCard[] {
  const cutoff = now - days * 86_400_000
  return cards.filter((c) => c.date !== null && Date.parse(c.date) >= cutoff)
}
