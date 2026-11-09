// Data source: Dribbble's public design job board (https://dribbble.com/jobs).
// No authentication required. Search returns a server-rendered HTML page with
// one <li class="job-list-item"> per posting; detail is the posting's own HTML
// page. Both are parsed with regex over per-result chunks - zero runtime
// dependencies, the same architecture as linkedin-search.
//
// Personal use only: Dribbble's Terms of Service (section 7) prohibit scraping
// and automated access faster than a person browsing. One CLI call makes one
// request; keep volume low and do not use it commercially or for bulk data
// collection. robots.txt allows /jobs and /jobs/<id> but disallows
// /jobs/*/apply_now - this CLI never requests an apply link, it only prints it.

export const BASE_URL = "https://dribbble.com"
export const SEARCH_URL = `${BASE_URL}/jobs`
export const DETAIL_URL = `${BASE_URL}/jobs`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; dribbble-cli/1.0)"

/** Fetch HTML with exponential backoff (plus jitter) on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
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
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

/**
 * Extract the inner HTML of a <div> identified by a CSS class name, correctly
 * handling nested <div> elements by tracking tag depth.
 */
export function extractDivContent(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const openRe = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, 'i')
  const open = openRe.exec(html)
  if (!open) return null

  let i = open.index + open[0].length
  let depth = 1

  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div>', i)

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
  return visibleHtml(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}



// ---------------------------------------------------------------------------
// Dribbble-specific parsing
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  /** The card carries Dribbble's "Remote" badge (remote-only or remote-friendly). */
  remote: boolean
  /** Approximate ISO date (YYYY-MM-DD), derived from the relative "Posted ..." text. */
  date: string | null
  /** The relative age exactly as the card shows it, e.g. "3 days ago". */
  posted: string | null
  /** A paid "featured listing" (boosted) card. */
  featured: boolean
  url: string
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  companyWebsite: string | null
  location: string | null
  remote: boolean
  /** "remote" | "onsite" | "onsite_or_remote", from the page's location type. */
  workplace: string | null
  employmentType: string | null
  /** Posting date (YYYY-MM-DD). */
  date: string | null
  /** Listing expiry date (YYYY-MM-DD) - Dribbble listings run 30 days. */
  validThrough: string | null
  /** false only when validThrough is in the past; true means "not known to be expired". */
  isActive: boolean
  description: string | null
  /** Printed for the user only - robots.txt disallows /jobs/<id>/apply_now, so the CLI never fetches it. */
  applyUrl: string | null
  url: string
}

const RELATIVE_UNITS: Record<string, number> = {
  second: 1 / 86400,
  minute: 1 / 1440,
  hour: 1 / 24,
  day: 1,
  week: 7,
  month: 30,
  year: 365,
}

/**
 * Convert the card's relative age ("3 days ago", "about 12 hours ago",
 * "less than a minute ago", "about 1 month ago" - Rails' time_ago_in_words)
 * to a fractional number of days. Returns null when the text is unrecognised.
 */
export function ageDaysFromPosted(posted: string | null): number | null {
  if (!posted) return null
  const t = posted.toLowerCase().replace(/^posted\s+/, "").trim()
  if (/^(just now|today)$/.test(t) || /^less than a minute/.test(t)) return 0
  if (t === "yesterday") return 1
  const m = t.match(/^(?:about|over|almost|less than)?\s*(an?|\d+)\s+(second|minute|hour|day|week|month|year)s?\b/)
  if (!m) return null
  const n = m[1] === "a" || m[1] === "an" ? 1 : parseInt(m[1], 10)
  return n * RELATIVE_UNITS[m[2]]
}

/** The calendar date `ageDays` before `now`, as YYYY-MM-DD (UTC). */
export function dateFromAge(ageDays: number | null, now: Date = new Date()): string | null {
  if (ageDays === null) return null
  return new Date(now.getTime() - ageDays * 86400000).toISOString().slice(0, 10)
}

/** `/jobs/311562-Staff-Product-Designer?source=index` -> { id, slug }. */
function jobPath(href: string): { id: string; slug: string } | null {
  const m = href.match(/^(?:https?:\/\/(?:www\.)?dribbble\.com)?\/jobs\/(\d+)(-[A-Za-z0-9-]*)?(?:[?#]|$)/)
  return m ? { id: m[1], slug: m[2] ?? "" } : null
}

/**
 * Parse the search page. Hidden markup (comments, scripts, hidden elements)
 * is removed first - detail pages, for instance, ship a commented-out
 * "Related Jobs" list of full cards. The rest is split on each
 * <li class="job-list-item"> and every chunk is parsed independently, so one
 * malformed card cannot break the rest.
 */
export function parseJobCards(html: string, now: Date = new Date()): JobCard[] {
  const results: JobCard[] = []
  const seen = new Set<string>()
  const chunks = visibleHtml(html).split(/<li\b(?=[^>]*\bclass="[^"]*\bjob-list-item\b)/i).slice(1)

  for (const raw of chunks) {
    const end = raw.indexOf("</li>")
    const chunk = end === -1 ? raw : raw.slice(0, end)
    const openTag = chunk.slice(0, chunk.indexOf(">") + 1)

    // The overlay link (class="job-link") and the "View job" button both carry the path.
    const hrefs = [...chunk.matchAll(/href="([^"]*\/jobs\/\d+[^"]*)"/gi)].map((m) => decodeHtmlEntities(m[1]))
    const path = hrefs.map(jobPath).find((p) => p !== null)
    if (!path || seen.has(path.id)) continue

    const titleHtml = chunk.match(/<h4[^>]*class="[^"]*\bjob-board-job-title\b[^"]*"[^>]*>([\s\S]*?)<\/h4>/i)?.[1]
    const title = titleHtml ? clean(titleHtml) : ""
    if (!title) continue

    // Company only from its own span: featured cards put a tooltip
    // ("Featured listing posted by ...") in the same container.
    const companyHtml = chunk.match(/class="[^"]*\bjob-board-job-company\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
    const company = companyHtml ? clean(companyHtml) || null : null

    let location: string | null = null
    const locHtml = chunk.match(/<span[^>]*class="location"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
    if (locHtml) location = clean(locHtml) || null

    // The mobile details block holds the location plus a separate "Remote"
    // badge on remote-only and remote-friendly postings.
    const mobile = extractDivContent(chunk, "job-details--mobile") ?? ""
    const badges = [...mobile.matchAll(/<div([^>]*)>([\s\S]*?)<\/div>/gi)]
      .filter((m) => !/location-container/.test(m[1]))
      .map((m) => clean(m[2]))
    if (!location) {
      const mobileLoc = mobile.match(/class="[^"]*location-container[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      if (mobileLoc) location = clean(mobileLoc) || null
    }
    const remote = badges.some((b) => /^remote$/i.test(b)) || /^remote$/i.test(location ?? "")

    const postedHtml = chunk.match(/class="[^"]*\bposted-on\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
    const posted = postedHtml ? clean(postedHtml).replace(/^posted\s+/i, "") || null : null

    seen.add(path.id)
    results.push({
      id: path.id,
      title,
      company,
      location,
      remote,
      date: dateFromAge(ageDaysFromPosted(posted), now),
      posted,
      featured: /\bjob-list-item--boosted\b/.test(openTag),
      url: `${BASE_URL}/jobs/${path.id}${path.slug}`,
    })
  }

  return results
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
}

/** "Nov 05, 2026" -> "2026-11-05". */
function isoFromSidebarDate(text: string | undefined): string | null {
  const m = text?.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  const mm = m ? MONTHS[m[1].toLowerCase()] : undefined
  return m && mm ? `${m[3]}-${mm}-${m[2].padStart(2, "0")}` : null
}

/** Accept only a leading ISO calendar date from structured data. */
function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

const LD_EMPLOYMENT: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACTOR: "Contract",
  TEMPORARY: "Temporary",
  INTERN: "Internship",
  OTHER: "Other",
}

const LOCATION_TYPES: Record<string, string> = {
  remote_only: "remote",
  onsite_only: "onsite",
  onsite_or_remote: "onsite_or_remote",
  remote_option: "onsite_or_remote",
}

/** The JobPosting ld+json object, if the page carries one. Read from the raw page, before scripts are dropped. */
function jobPostingLd(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1])
      if (data && typeof data === "object" && data["@type"] === "JobPosting") return data
    } catch {
      // A malformed block is skipped; the visible page is the primary source.
    }
  }
  return null
}

/**
 * Parse a posting page. Every text field comes from the visible page (run
 * through visibleHtml first); the page's scripts and ld+json are used only for
 * strictly validated values - ISO dates, the location-type enum and the
 * apply-link path - never for free text a reader of the page does not see.
 * Returns null when the page is not a job posting (unknown or delisted ID).
 */
export function parseJobDetail(html: string, id: string, now: Date = new Date()): JobDetail | null {
  const ld = jobPostingLd(html)
  const locationType = html.match(/\blocationType:\s*"([a-z_]+)"/)?.[1]
  const applyPath = html.match(/\bjob_apply_link:\s*"(\/jobs\/\d+[A-Za-z0-9-]*\/apply_now)"/)?.[1]

  const vis = visibleHtml(html)
  const titleHtml = vis.match(/<h1[^>]*class="[^"]*\bjob-details-title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const title = titleHtml ? clean(titleHtml) : ""
  if (!title) return null

  // Description: keep paragraph/line breaks as newlines.
  let description: string | null = null
  const descHtml = extractDivContent(vis, "job-details-description")
  if (descHtml) {
    // descHtml is already visible-only, so inline tags can be dropped without
    // a space ("<strong>Designer</strong>," must not become "Designer ,").
    const withBreaks = descHtml
      .replace(/\s+/g, " ")
      .replace(/<\/?(?:strong|b|em|i|u|a|span)\b[^>]*>/gi, "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/(p|ul|ol|div|h\d|blockquote)>/gi, "\n\n")
    // Clean each rendered line separately: stripTags collapses whitespace,
    // so applying it to the whole description would erase these boundaries.
    description =
      withBreaks
        .split("\n")
        // .trim() after clean(): a decoded &nbsp; paragraph is a lone space.
        .map((line) => (line.startsWith("- ") ? `- ${clean(line.slice(2)).trim()}` : clean(line).trim()))
        .filter((line) => line !== "- ")
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\n\n(?=- )/g, "\n")
        .trim() || null
  }

  // Sidebar: company, website, then labelled facts ("Job Type", "Location", "Date posted").
  const sidebar = extractDivContent(vis, "sidebar-content-container") ?? ""
  const orgHtml = extractDivContent(sidebar, "organization-name")
  const company = orgHtml ? clean(orgHtml) || null : null
  const site = sidebar.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>\s*Visit Website\s*<\/a>/i)?.[1]
  const companyWebsite = site ? decodeHtmlEntities(site) : null

  const facts: Record<string, string[]> = {}
  for (const piece of sidebar.split(/<div[^>]*class="font-sublabel"[^>]*>/i).slice(1)) {
    const label = clean(piece.slice(0, piece.indexOf("</div>"))).toLowerCase()
    facts[label] = [...piece.matchAll(/class="font-label[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)]
      .map((m) => clean(m[1]))
      .filter(Boolean)
  }
  const locLines = facts["location"] ?? []
  const remoteFriendly = locLines.some((l) => /^remote friendly$/i.test(l))
  const location = locLines.filter((l) => !/^remote friendly$/i.test(l)).join(" / ") || null

  const workplace = locationType ? LOCATION_TYPES[locationType] ?? null : null
  const remote =
    remoteFriendly || /^remote$/i.test(location ?? "") || workplace === "remote" || workplace === "onsite_or_remote"

  const ldType = typeof ld?.employmentType === "string" ? LD_EMPLOYMENT[ld.employmentType] : undefined
  const employmentType = facts["job type"]?.[0] ?? ldType ?? null

  const date = isoFromSidebarDate(facts["date posted"]?.[0]) ?? isoDate(ld?.datePosted)
  const validThrough = isoDate(ld?.validThrough)
  const today = now.toISOString().slice(0, 10)

  const slug = vis.match(new RegExp(`href="/jobs/${id}(-[A-Za-z0-9-]*)"`))?.[1] ?? ""

  return {
    id,
    title,
    company,
    companyWebsite,
    location,
    remote,
    workplace,
    employmentType,
    date,
    validThrough,
    isActive: validThrough === null || validThrough >= today,
    description,
    applyUrl: applyPath ? `${BASE_URL}${applyPath}` : null,
    url: `${BASE_URL}/jobs/${id}${slug}`,
  }
}

/** Specialty filter names -> Dribbble's specialty_ids[] values (from the filter form). */
export const SPECIALTIES: Record<string, string> = {
  animation: "1",
  brand: "2",
  graphic: "2",
  illustration: "3",
  leadership: "4",
  mobile: "5",
  ui: "6",
  visual: "6",
  product: "7",
  ux: "8",
  research: "8",
  web: "9",
}

/** Parse a comma-separated --specialty value into specialty IDs; null if any name is unknown. */
export function specialtyIds(value: string): string[] | null {
  const ids: string[] = []
  for (const name of value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const id = SPECIALTIES[name]
    if (!id) return null
    if (!ids.includes(id)) ids.push(id)
  }
  return ids.length ? ids : null
}

/** --type value -> the filter form's checkbox parameter. */
export function jobTypeParam(value: string): string | null {
  switch (value.trim().toLowerCase()) {
    case "fulltime":
    case "full-time":
      return "fulltime"
    case "freelance":
    case "contract":
      return "freelance_or_contract"
    default:
      return null
  }
}
