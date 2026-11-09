// Data source: We Work Remotely's public RSS feeds - the all-jobs feed
// (https://weworkremotely.com/remote-jobs.rss) and one feed per category
// (https://weworkremotely.com/categories/<slug>.rss). No authentication.
//
// Only the RSS feeds are used. The site's HTML pages (search, job pages,
// sitemap, terms) answer this CLI's honest User-Agent with a Cloudflare
// challenge (HTTP 403), and this CLI never retries with browser headers. Each
// RSS item already carries the full HTML description, so `detail` reads the
// item instead of the job page.

export const BASE_URL = "https://weworkremotely.com"
export const ALL_FEED_URL = `${BASE_URL}/remote-jobs.rss`
export const SOURCE = "We Work Remotely"

/** Category aliases -> feed slugs (https://weworkremotely.com/categories/<slug>.rss). */
export const CATEGORIES: Record<string, string> = {
  design: "remote-design-jobs",
  "full-stack": "remote-full-stack-programming-jobs",
  "front-end": "remote-front-end-programming-jobs",
  "back-end": "remote-back-end-programming-jobs",
  programming: "remote-programming-jobs",
  devops: "remote-devops-sysadmin-jobs",
  product: "remote-product-jobs",
  "customer-support": "remote-customer-support-jobs",
  "sales-marketing": "remote-sales-and-marketing-jobs",
  "management-finance": "remote-management-and-finance-jobs",
  other: "all-other-remote-jobs",
}

export function categoryFeedUrl(alias: string): string {
  return `${BASE_URL}/categories/${CATEGORIES[alias]}.rss`
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; weworkremotely-cli/1.0)"

// robots.txt declares no crawl delay; feeds are large (0.1-2 MB) and change
// hourly (<ttl>60</ttl>), so requests within one run are still spaced a second apart.
const REQUEST_SPACING_MS = 1000
const RETRY_BUDGET_MS = 30_000
let lastRequestAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** The wait a 429/503 asks for via `Retry-After`, in ms, or null when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(date - now, 0)
}

/**
 * GET a feed with exponential backoff and jitter on 429/5xx (max 6 retries,
 * honoring Retry-After within RETRY_BUDGET_MS); `null` on a 404 rather than a
 * crash. A 403 is the Cloudflare challenge: fail plainly, never escalate.
 */
export async function fetchText(url: string): Promise<string | null> {
  const maxRetries = 6
  let delay = 1000
  let waited = 0
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const gap = lastRequestAt + REQUEST_SPACING_MS - Date.now()
    if (gap > 0) await sleep(gap)
    lastRequestAt = Date.now()
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      })
    } catch (e) {
      throw new Error(`could not reach We Work Remotely (${e instanceof Error ? e.message : String(e)})`)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      const backoff = delay + Math.floor(Math.random() * 500)
      const wait = Math.max(backoff, retryAfterMs(response.headers.get("Retry-After")) ?? 0)
      if (waited + wait > RETRY_BUDGET_MS) {
        throw new Error(
          `Request failed: ${response.status} ${response.statusText}; retry would exceed the ${RETRY_BUDGET_MS / 1000}s budget`,
        )
      }
      await sleep(wait)
      waited += wait
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (response.status === 403) {
      throw new Error(
        "Request failed: 403 Forbidden - We Work Remotely's bot protection refused this client; this CLI does not retry with browser headers",
      )
    }
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Text hygiene
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", deg: "°",
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/**
 * Decode entities in ONE pass. The feed escapes its HTML descriptions once at
 * the XML level, so the XML decode and the later HTML decode must each run
 * exactly once: a chained decoder would turn "&amp;lt;" straight into "<".
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ent: string) => {
    if (ent[0] === "#") {
      const cp = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return numericEntity(cp)
    }
    return NAMED_ENTITIES[ent] ?? NAMED_ENTITIES[ent.toLowerCase()] ?? whole
  })
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a portal's feed or
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
 * (Copied from linkedin-search/cli/src/helpers.ts.)
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
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

/** Visible text of an HTML fragment on one line, entities decoded once. */
export function clean(html: string): string {
  return decodeEntities(visibleHtml(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

/** Visible text of an HTML description with paragraph and list structure kept as line breaks. */
export function htmlToText(html: string): string | null {
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*hr\b[^>]*>/gi, "\n\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(li|ul|ol|tr)\s*>/gi, "\n")
    .replace(/<\/(p|div|h\d|blockquote|section|table)\s*>/gi, "\n\n")
  const text = withBreaks
    .split("\n")
    .map(clean)
    .filter((line) => line !== "-")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=- )/g, "\n")
    .trim()
  return text || null
}

// ---------------------------------------------------------------------------
// RSS items -> results
// ---------------------------------------------------------------------------

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  category: string | null
  employmentType: string | null
  region: string | null
  skills: string[]
  expiresAt: string | null
  source: string
}

/** A parsed RSS item, with the description HTML search filters on. */
export interface FeedJob extends JobResult {
  country: string | null
  state: string | null
  descriptionHtml: string
}

export interface JobDetail extends JobResult {
  country: string | null
  state: string | null
  headquarters: string | null
  description: string | null
}

/**
 * The XML-decoded content of the first <tag> element in an item chunk, or "".
 * CDATA content is taken verbatim; anything else is entity-decoded once.
 */
export function xmlField(chunk: string, tag: string): string {
  const m = chunk.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"))
  if (!m) return ""
  const raw = m[1].trim()
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  return cdata ? cdata[1] : decodeEntities(raw)
}

/** One-line plain text (feed text fields are text, not markup, once XML-decoded). */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

function isoDate(s: string): string | null {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

const WWR_HOST = /^(www\.)?weworkremotely\.com$/i

/** The job slug from a weworkremotely.com/remote-jobs/<slug> URL, or null. */
export function slugFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!WWR_HOST.test(parsed.hostname)) return null
  const m = parsed.pathname.match(/^\/remote-jobs\/([a-z0-9-]+)\/?$/i)
  return m ? m[1].toLowerCase() : null
}

/** Split "Company: Job title" on the first ": ". */
export function splitTitle(raw: string): { company: string | null; title: string } {
  const i = raw.indexOf(": ")
  if (i <= 0) return { company: null, title: raw }
  const company = oneLine(raw.slice(0, i))
  const title = oneLine(raw.slice(i + 2))
  return title ? { company: company || null, title } : { company: null, title: raw }
}

/** Skills are one comma list ("A, B, and C"). */
export function splitSkills(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => oneLine(s).replace(/^and\s+/i, ""))
    .filter(Boolean)
}

/** Parse one <item> chunk; null when it has no usable title or job link. */
export function parseItem(chunk: string): FeedJob | null {
  const link = oneLine(xmlField(chunk, "link")) || oneLine(xmlField(chunk, "guid"))
  const id = slugFromUrl(link)
  if (!id) return null
  const rawTitle = oneLine(xmlField(chunk, "title"))
  if (!rawTitle) return null
  const { company, title } = splitTitle(rawTitle)
  const region = oneLine(xmlField(chunk, "region")) || null
  const country = oneLine(xmlField(chunk, "country")) || null
  const state = oneLine(xmlField(chunk, "state")) || null
  const location = [region, country, state].filter(Boolean).join(" · ") || null
  return {
    id,
    title,
    company,
    location,
    date: isoDate(oneLine(xmlField(chunk, "pubDate"))),
    url: `${BASE_URL}/remote-jobs/${id}`,
    category: oneLine(xmlField(chunk, "category")) || null,
    employmentType: oneLine(xmlField(chunk, "type")) || null,
    region,
    skills: splitSkills(xmlField(chunk, "skills")),
    expiresAt: isoDate(oneLine(xmlField(chunk, "expires_at"))),
    source: SOURCE,
    country,
    state,
    descriptionHtml: xmlField(chunk, "description"),
  }
}

/**
 * Parse an RSS feed: split into <item> chunks and parse each independently, so
 * one malformed item cannot break the rest.
 */
export function parseFeed(xml: string): FeedJob[] {
  if (!/<rss[\s>]/i.test(xml) && !/<channel[\s>]/i.test(xml)) {
    throw new Error("We Work Remotely returned something that is not an RSS feed (bot protection or a changed URL)")
  }
  const jobs: FeedJob[] = []
  for (const chunk of xml.split(/<item(?:\s[^>]*)?>/i).slice(1)) {
    try {
      const job = parseItem(chunk.split(/<\/item>/i)[0])
      if (job) jobs.push(job)
    } catch {
      // One bad item is skipped, not fatal.
    }
  }
  return jobs
}

/** The public result shape (drops the fields only filters and detail use). */
export function toResult(job: FeedJob): JobResult {
  const { country: _c, state: _s, descriptionHtml: _d, ...result } = job
  return result
}

/** Build a detail record from a feed item. */
export function toDetail(job: FeedJob): JobDetail {
  const hq = job.descriptionHtml.match(/<strong>\s*Headquarters:?\s*<\/strong>([\s\S]*?)(?:<br|<\/p>)/i)
  const { descriptionHtml: _d, ...rest } = job
  return {
    ...rest,
    headquarters: hq ? clean(hq[1]) || null : null,
    description: htmlToText(job.descriptionHtml),
  }
}

// ---------------------------------------------------------------------------
// Filters (client-side: the feeds have no keyword, location, age or page params)
// ---------------------------------------------------------------------------

/** Lower-case and drop diacritics, so "Türkiye" matches "turkiye". */
export function normalize(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function queryTerms(query: string | undefined): string[] {
  return query ? normalize(query).split(/\s+/).filter(Boolean) : []
}

/** Every term occurs at the start of a word in the haystack (AND). */
export function matchesAllTerms(haystack: string, terms: string[]): boolean {
  if (terms.length === 0) return true
  const h = normalize(haystack)
  return terms.every((t) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(t)}`, "u").test(h))
}

/** The text a query is matched against: title, or title + company + skills + category + description. */
export function searchableText(job: FeedJob, titleOnly: boolean): string {
  if (titleOnly) return job.title
  return [job.title, job.company ?? "", job.skills.join(" | "), job.category ?? "", clean(job.descriptionHtml)].join(" \n ")
}

export function locationTerms(location: string | undefined): string[] {
  return location ? location.split(",").map((t) => normalize(t.trim())).filter(Boolean) : []
}

const WORLDWIDE = new Set(["worldwide", "anywhere", "global"])

/** Any term is a substring of the region/country/state text (OR); worldwide also matches "Anywhere in the World". */
export function matchesLocation(location: string | null, terms: string[]): boolean {
  if (terms.length === 0) return true
  if (!location) return false
  const loc = normalize(location)
  return terms.some((t) => loc.includes(t) || (WORLDWIDE.has(t) && /anywhere|worldwide|global/.test(loc)))
}

export function withinJobage(date: string | null, days: number | undefined, now = Date.now()): boolean {
  if (!days) return true
  const t = date ? Date.parse(date) : NaN
  if (Number.isNaN(t)) return false
  return t >= now - days * 86_400_000
}

// ---------------------------------------------------------------------------
// Detail id parsing
// ---------------------------------------------------------------------------

/**
 * Accept a job slug or a weworkremotely.com/remote-jobs/<slug> URL (with or
 * without scheme). A URL on any other host is rejected: an employer apply
 * link must not be turned into a lookup. Real URL parsing keeps look-alike
 * hosts and userinfo tricks on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    return slugFromUrl(hasScheme ? trimmed : `https://${trimmed}`)
  }
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(trimmed) ? trimmed.toLowerCase() : null
}
