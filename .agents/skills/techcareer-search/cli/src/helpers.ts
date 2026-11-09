// Data source: Techcareer.net's public job pages (www.techcareer.net/jobs and
// /jobs/detail/<slug>). No authentication required. The site is a Next.js app
// that server-renders every page with a `<script id="__NEXT_DATA__">` JSON
// payload; the job list and the job detail live in that payload (the rendered
// cards carry no links or dates of their own), so the CLI reads the payload
// and parses each job item independently. Description HTML inside it is run
// through visibleHtml before tags are stripped.

export const BASE_URL = "https://www.techcareer.net"
export const SEARCH_URL = `${BASE_URL}/jobs`
export const DETAIL_URL = `${BASE_URL}/jobs/detail`
/** Techcareer serves a fixed 20 jobs per page; there is no page-size parameter. */
export const PAGE_SIZE = 20

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; techcareer-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
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
      signal: AbortSignal.timeout(20000),
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
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  /** The posting's URL slug, e.g. "back-end-developer-4491449" - pass it to `detail`. */
  id: string
  title: string
  company: string | null
  location: string | null
  /** Search results carry no posting date on Techcareer; always null here (see `detail`). */
  date: string | null
  url: string
  /** Workplace type(s) as the portal labels them: "İş Yerinde", "Hibrit", "Uzaktan". */
  workplace: string | null
  /** The portal's normalised position name for the posting (Turkish). */
  position: string | null
  /** How many further cities the posting lists beyond `location`. */
  otherLocations: number
  /** External apply link when the employer set one; null means apply on Techcareer/Kariyer.net. */
  applyUrl: string | null
}

export interface JobDetail extends Omit<JobCard, "otherLocations"> {
  otherLocations: string[]
  /** Application deadline (the posting's end date), YYYY-MM-DD. */
  deadline: string | null
  employmentType: string | null
  experience: string | null
  positionLevel: string | null
  skills: string[]
  languages: string[]
  educationLevels: string[]
  description: string | null
  isActive: boolean
}

export interface SearchPage {
  cards: JobCard[]
  /** Total matching postings across all pages, as reported by the portal. */
  total: number
  totalPages: number
}

/** Convert a Unicode code point to a string, dropping out-of-range values instead of throwing. */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// Named entities that turn up in Turkish posting HTML (pasted from Word or a
// rich-text editor). Anything not listed is left as written.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", laquo: "«", raquo: "»",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·",
  euro: "€", trade: "™", reg: "®", copy: "©", deg: "°", times: "×",
}

/** Decode entities in one pass, so "&amp;lt;" becomes the literal text "&lt;", not "<". */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const hex = ref[1] === "x" || ref[1] === "X"
      return numericEntity(parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10))
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

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/**
 * Render a rich-text HTML fragment (a posting description) as readable text:
 * hidden markup dropped first, then line breaks kept at <br>, block ends and
 * list items, then every line cleaned on its own.
 */
export function htmlToText(html: string): string | null {
  // Hidden markup goes before the line split: a hidden element can span the
  // breaks, and cleaning line by line would only see half of it.
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr|table)>/gi, "\n")
  return (
    withBreaks
      .split("\n")
      .map(clean)
      .filter((line) => line !== "•")
      .join("\n")
      // A <p> inside an <li> closes twice; keep a list's items on adjacent lines.
      .replace(/\n+(?=• )/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || null
  )
}

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null
}

/** A plain-text JSON field (React renders these as text, so no tag stripping): whitespace-normalised or null. */
function text(value: unknown): string | null {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() || null : null
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => text(v) ?? text(asObject(v)?.name) ?? text(asObject(v)?.skill)).filter((v): v is string => v !== null)
}

function joined(value: unknown): string | null {
  const items = textList(value)
  return items.length ? items.join(", ") : null
}

/** An ISO timestamp from the payload as YYYY-MM-DD, or null. */
function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

function httpUrl(value: unknown): string | null {
  const s = text(value)
  return s && /^https?:\/\//i.test(s) ? s : null
}

/**
 * Techcareer job slugs are lower-case words joined by hyphens and end in the
 * Kariyer.net posting number ("mid.-software-engineer-4577524"). The bare
 * number is not addressable: /jobs/detail/<number> redirects to the job list.
 */
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]*-\d{4,}$/

export function jobUrl(slug: string): string {
  return `${DETAIL_URL}/${slug}`
}

/** Parse the `__NEXT_DATA__` JSON payload out of a server-rendered page, or null. */
export function extractNextData(html: string): Json | null {
  const m = html.match(/<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (!m) return null
  try {
    return asObject(JSON.parse(m[1]))
  } catch {
    return null
  }
}

function pageProps(data: Json): Json | null {
  return asObject(asObject(data.props)?.pageProps)
}

/** Company name, honouring the portal's "company hidden" flag (then only the employer's own blurb is shown). */
function companyName(item: Json, owner: Json | null): string | null {
  if (item.isCompanyHidden === true || owner?.isCompanyHidden === true) return text(item.hiddenCompanyInfo)
  return text(owner?.name)
}

/** Parse one job-list item. Returns null when the item lacks a usable slug or title. */
export function parseListItem(value: unknown): JobCard | null {
  const item = asObject(value)
  if (!item) return null
  const slug = text(item.slug)
  const title = text(item.title)
  if (!slug || !SLUG_RE.test(slug) || !title) return null
  const other = typeof item.otherLocations === "number" && item.otherLocations > 0 ? item.otherLocations : 0
  return {
    id: slug,
    title,
    company: companyName(item, asObject(item.owner)),
    location: text(item.location),
    date: null,
    url: jobUrl(slug),
    workplace: joined(item.workPlaces),
    position: text(item.jobTitle),
    otherLocations: other,
    applyUrl: httpUrl(item.applyLink),
  }
}

/**
 * Parse a /jobs search page. Each item in the payload's job list is parsed on
 * its own, so one malformed item cannot break the rest. A page with no
 * payload at all is a markup change, not an empty result, and throws.
 */
export function parseSearchPage(html: string): SearchPage {
  const data = extractNextData(html)
  const props = data ? pageProps(data) : null
  if (!props) {
    throw new Error("Techcareer page carried no __NEXT_DATA__ job payload - the site markup may have changed")
  }
  // A search with no matches renders initialJobList: null.
  const list = asObject(props.initialJobList)
  const items = Array.isArray(list?.jobListItems) ? (list.jobListItems as unknown[]) : []
  const cards: JobCard[] = []
  for (const item of items) {
    try {
      const card = parseListItem(item)
      if (card) cards.push(card)
    } catch {
      // Skip a malformed item; the rest of the page still parses.
    }
  }
  const pagination = asObject(list?.pagination)
  const total = typeof pagination?.total === "number" ? pagination.total : cards.length
  const totalPages = typeof pagination?.pageCount === "number" ? pagination.pageCount : cards.length ? 1 : 0
  return { cards, total, totalPages }
}

/**
 * Parse a /jobs/detail/<slug> page. Returns null when the response is not a
 * job-detail page: an unknown or expired slug redirects to the job list,
 * which must not be read as a posting.
 */
export function parseJobDetail(html: string, slug: string): JobDetail | null {
  const data = extractNextData(html)
  if (!data || data.page !== "/jobs/detail/[jobSlug]") return null
  const detail = asObject(pageProps(data)?.jobDetail)
  const head = asObject(detail?.head)
  if (!detail || !head) return null
  const content = asObject(detail.content) ?? {}
  const owner = asObject(detail.owner)
  const title = text(head.title)
  if (!title) return null

  const deadline = isoDate(head.endDate)
  // Absence of the closed markers is not proof the posting is open, so
  // isActive: true means only "not completed, not disabled, deadline not past".
  const today = new Date().toISOString().slice(0, 10)
  const isActive = head.isCompleted !== true && head.isDisabledJob !== true && !(deadline && deadline < today)
  const id = text(head.slug) ?? slug

  return {
    id,
    title,
    company: companyName(head, asObject(head.company) ?? owner),
    location: text(head.location),
    otherLocations: textList(head.otherLocations),
    date: isoDate(head.startDate),
    deadline,
    url: jobUrl(id),
    workplace: joined(head.workPlaces),
    employmentType: joined(head.typeOfWorks),
    experience: joined(head.yearsOfExperiences),
    positionLevel: joined(head.positionLevels),
    position: text(head.jobTitle),
    skills: textList(content.skills),
    languages: textList(content.languages),
    educationLevels: textList(content.educationLevels),
    applyUrl: httpUrl(head.applyLink),
    description: typeof content.description === "string" ? htmlToText(content.description) : null,
    isActive,
  }
}

/** Build the /jobs search URL. Techcareer encodes its search state as qs-style bracketed params. */
export function buildSearchUrl(opts: { query?: string; location?: string; page: number }): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("jobs[search][keyword]", opts.query)
  if (opts.location) params.set("jobs[search][location]", opts.location)
  params.set("jobs[page]", String(opts.page))
  return `${SEARCH_URL}?${params.toString()}`
}
