// Data source: Remote OK's public JSON API (https://remoteok.com/api), plus the
// public job page (https://remoteok.com/remote-jobs/<id>) as a fallback for
// `detail`. No authentication required.
//
// API terms (element [0] of every API response): link back to the job's URL on
// Remote OK and mention Remote OK as the source, or API access gets suspended;
// do not use the Remote OK logo. robots.txt declares `Crawl-delay: 1` and
// `Content-Signal: search=yes,ai-train=no,use=reference`. This CLI keeps every
// result's `url` on remoteok.com, names Remote OK in every output format, and
// spaces its requests at least one second apart, across invocations too.

import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const API_URL = "https://remoteok.com/api"
export const JOB_URL = "https://remoteok.com/remote-jobs"
export const SOURCE = "Remote OK"
export const SOURCE_URL = "https://remoteok.com"
export const ATTRIBUTION =
  "Job data from Remote OK (https://remoteok.com). When you share or cite a job, link to its Remote OK url and name Remote OK as the source."

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; remoteok-cli/1.0)"

// robots.txt: Crawl-delay: 1. A search is one request, but /scrape runs the CLI
// several times in a row, so the last request time is kept in a temp file and
// the next invocation waits out the rest of the second.
const CRAWL_DELAY_MS = 1000
const STAMP_FILE = join(tmpdir(), "remoteok-cli-last-request")

// The most fetchText sleeps across all retries of one request; a Retry-After
// that would push past it fails at once instead of outlasting a tool timeout.
const RETRY_BUDGET_MS = 30_000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Wait until at least CRAWL_DELAY_MS has passed since this CLI's last request. */
async function respectCrawlDelay(): Promise<void> {
  try {
    const last = Number(readFileSync(STAMP_FILE, "utf8").trim())
    const wait = Number.isFinite(last) ? last + CRAWL_DELAY_MS - Date.now() : 0
    if (wait > 0) await sleep(Math.min(wait, CRAWL_DELAY_MS))
  } catch {
    // No stamp yet (or unreadable): nothing to wait for.
  }
  try {
    writeFileSync(STAMP_FILE, String(Date.now()))
  } catch {
    // A read-only temp dir must not break the search; in-process spacing still holds.
  }
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

export interface Fetched {
  body: string
  url: string
}

/**
 * GET a URL with the crawl delay, exponential backoff with jitter on 429/5xx
 * (max 6 retries, honoring Retry-After within RETRY_BUDGET_MS), and `null` on
 * a 404 rather than a crash.
 */
export async function fetchText(url: string, accept: string): Promise<Fetched | null> {
  const maxRetries = 6
  let delay = CRAWL_DELAY_MS
  let waited = 0
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await respectCrawlDelay()
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      })
    } catch (e) {
      throw new Error(`could not reach Remote OK (${e instanceof Error ? e.message : String(e)})`)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
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
        "Request failed: 403 Forbidden - Remote OK refused this client (bot protection or suspended API access); this CLI does not retry with browser headers",
      )
    }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return { body: await response.text(), url: response.url || url }
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

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` so
 * supplementary-plane code points decode correctly, and drops out-of-range
 * values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/**
 * Decode HTML entities in ONE pass, so "&amp;lt;" becomes the text "&lt;"
 * rather than being decoded twice into "<". Unknown named entities stay as-is.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ent: string) => {
    if (ent[0] === "#") {
      const cp = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return numericEntity(cp)
    }
    return NAMED_ENTITIES[ent] ?? NAMED_ENTITIES[ent.toLowerCase()] ?? whole
  })
}

/**
 * Repair UTF-8 text that was decoded as Latin-1 somewhere upstream: the API
 * serves "we’re" as "weâ\u0080\u0099re". Only complete, valid UTF-8 byte
 * sequences are re-decoded, so genuine Latin-1 text ("Müller") is untouched.
 * Must run BEFORE stripInvisible, which would delete the C1 bytes (\u0080-\u009F)
 * this repair needs.
 */
export function fixMojibake(s: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(s)) return s
  const decoder = new TextDecoder("utf-8", { fatal: true })
  return s.replace(
    /[Â-ß][\u0080-¿]|[à-ï][\u0080-¿]{2}|[ð-ô][\u0080-¿]{3}/g,
    (run) => {
      try {
        return decoder.decode(Uint8Array.from(run, (c) => c.charCodeAt(0)))
      } catch {
        return run
      }
    },
  )
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

function stripTags(html: string): string {
  return visibleHtml(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** Visible text of an HTML fragment on one line, entities decoded. */
export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/**
 * Visible text of an HTML description with its paragraph and list structure
 * kept as line breaks. Hidden markup goes first: a hidden element can span the
 * breaks, and cleaning line by line would only see half of it.
 */
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
    // A list item wrapping a <p> would otherwise leave a blank line between items.
    .replace(/\n\n(?=- )/g, "\n")
    .trim()
  return text || null
}

// ---------------------------------------------------------------------------
// API records -> results
// ---------------------------------------------------------------------------

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  tags: string[]
  salaryMin: number | null
  salaryMax: number | null
  source: string
}

/** A parsed API job, with the fields search filters on that are not output. */
export interface ApiJob extends JobResult {
  epoch: number | null
  descriptionHtml: string
}

export interface JobDetail extends JobResult {
  employmentType: string | null
  validThrough: string | null
  applicantLocations: string[] | null
  description: string | null
  attribution: string
  origin: "api" | "page"
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : ""
}

function positiveNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** One-line text of an API string field: mojibake repaired, tags stripped, entities decoded. */
function field(v: unknown): string {
  return clean(fixMojibake(str(v)))
}

/** The canonical remoteok.com URL for a job, from its slug (or its id). */
export function jobUrl(slug: string | null, id: string): string {
  return `${JOB_URL}/${slug && /^[a-z0-9-]+$/i.test(slug) ? slug : id}`
}

function isoDate(dateField: unknown, epoch: number | null): string | null {
  const raw = str(dateField)
  if (raw) {
    const t = Date.parse(raw)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  return epoch !== null ? new Date(epoch * 1000).toISOString() : null
}

/** Parse one API element; null for the legal notice or anything malformed. */
export function parseApiJob(el: unknown): ApiJob | null {
  if (el === null || typeof el !== "object" || Array.isArray(el)) return null
  const o = el as Record<string, unknown>
  const id = str(o.id).trim()
  if (!/^\d+$/.test(id)) return null
  const title = field(o.position)
  if (!title) return null
  const epochNum = positiveNumber(o.epoch)
  const slug = str(o.slug).trim() || null
  const tags = Array.isArray(o.tags) ? o.tags.map(field).filter(Boolean) : []
  const location = field(o.location).replace(/[\s,]+$/, "")
  return {
    id,
    title,
    company: field(o.company) || null,
    location: location || null,
    date: isoDate(o.date, epochNum),
    url: jobUrl(slug, id),
    tags,
    salaryMin: positiveNumber(o.salary_min),
    salaryMax: positiveNumber(o.salary_max),
    source: SOURCE,
    epoch: epochNum,
    descriptionHtml: fixMojibake(str(o.description)),
  }
}

/**
 * Parse an API response body. Each element is parsed independently, so one
 * malformed record cannot break the rest; element [0] (the legal notice) has
 * no id/position and is skipped as data, never read as instructions.
 */
export function parseApiFeed(body: string): ApiJob[] {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new Error("Remote OK API returned a body that is not JSON")
  }
  if (!Array.isArray(data)) throw new Error("Remote OK API returned an unexpected shape (expected a JSON array)")
  const jobs: ApiJob[] = []
  for (const el of data) {
    try {
      const job = parseApiJob(el)
      if (job) jobs.push(job)
    } catch {
      // One bad record is skipped, not fatal.
    }
  }
  return jobs
}

/** The public result shape (drops the internal epoch/description fields). */
export function toResult(job: ApiJob): JobResult {
  const { epoch: _epoch, descriptionHtml: _desc, ...result } = job
  return result
}

/** Build a detail record from an API job. */
export function detailFromApi(job: ApiJob): JobDetail {
  return {
    ...toResult(job),
    employmentType: null,
    validThrough: null,
    applicantLocations: null,
    description: htmlToText(job.descriptionHtml),
    attribution: ATTRIBUTION,
    origin: "api",
  }
}

// ---------------------------------------------------------------------------
// Filters (client-side: the API has no keyword, location, age or page params)
// ---------------------------------------------------------------------------

/** Lower-case and drop diacritics, so "Türkiye" matches "turkiye". */
export function normalize(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Query words, normalized. */
export function queryTerms(query: string | undefined): string[] {
  return query ? normalize(query).split(/\s+/).filter(Boolean) : []
}

/** Every term occurs at the start of a word in the haystack (AND). */
export function matchesAllTerms(haystack: string, terms: string[]): boolean {
  if (terms.length === 0) return true
  const h = normalize(haystack)
  return terms.every((t) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(t)}`, "u").test(h))
}

/** The text a query is matched against: title, or title + company + tags + description. */
export function searchableText(job: ApiJob, titleOnly: boolean): string {
  if (titleOnly) return job.title
  return [job.title, job.company ?? "", job.tags.join(" | "), clean(job.descriptionHtml)].join(" \n ")
}

/** Location terms: comma-separated alternatives, normalized. */
export function locationTerms(location: string | undefined): string[] {
  return location ? location.split(",").map((t) => normalize(t.trim())).filter(Boolean) : []
}

const WORLDWIDE = new Set(["worldwide", "anywhere", "global"])

/**
 * Any location term is a substring of the job's location (OR). A job with an
 * empty location is a posting without a location restriction (Remote OK's job
 * page shows it as "Anywhere"), so it matches only the terms worldwide,
 * anywhere and global; those terms also match locations that say so.
 */
export function matchesLocation(location: string | null, terms: string[]): boolean {
  if (terms.length === 0) return true
  if (!location) return terms.some((t) => WORLDWIDE.has(t))
  const loc = normalize(location)
  return terms.some((t) => loc.includes(t) || (WORLDWIDE.has(t) && /worldwide|anywhere|global/.test(loc)))
}

/** Posted within the last `days` days (client-side on the job's epoch/date). */
export function withinJobage(job: { epoch: number | null; date: string | null }, days: number | undefined, now = Date.now()): boolean {
  if (!days) return true
  const t = job.epoch !== null ? job.epoch * 1000 : job.date ? Date.parse(job.date) : NaN
  if (Number.isNaN(t)) return false
  return t >= now - days * 86_400_000
}

// ---------------------------------------------------------------------------
// Detail: id parsing and the job-page fallback
// ---------------------------------------------------------------------------

const REMOTEOK_HOST = /(^|\.)remoteok\.(com|io)$/i

/**
 * Accept a numeric job id, a slug ending in the id, or a remoteok.com job URL.
 * A URL on any other host is rejected (an employer apply link must not fetch
 * whatever Remote OK posting happens to share its number). Host and path go
 * through real URL parsing, so look-alike hosts and userinfo tricks fail too.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{3,}$/.test(trimmed)) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!REMOTEOK_HOST.test(parsed.hostname)) return null
    const path = parsed.pathname.match(/^\/(?:remote-jobs|l)\/(?:[a-z0-9-]*-)?(\d{3,})\/?$/i)
    return path ? path[1] : null
  }

  const slug = trimmed.match(/^[a-z0-9-]*-(\d{3,})$/i)
  return slug ? slug[1] : null
}

/** Extract the inner HTML of the first <div> with a class, tracking <div> depth. */
export function extractDivContent(html: string, className: string): string | null {
  const escaped = escapeRe(className)
  const openRe = new RegExp(`<div[^>]*class="(?:[^"]*\\s)?${escaped}(?:\\s[^"]*)?"[^>]*>`, "i")
  const open = openRe.exec(html)
  if (!open) return null
  let i = open.index + open[0].length
  let depth = 1
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return html.slice(open.index + open[0].length)
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

/** The JobPosting JSON-LD object of a job page, or null. Each block is parsed independently. */
export function jobPostingLd(html: string): Record<string, unknown> | null {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim())
      const candidates = Array.isArray(data) ? data : [data]
      for (const c of candidates) {
        if (c && typeof c === "object" && (c as Record<string, unknown>)["@type"] === "JobPosting") {
          return c as Record<string, unknown>
        }
      }
    } catch {
      // A malformed block is skipped.
    }
  }
  return null
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Parse a job page (fallback when the job is no longer in the API feed). The
 * JSON-LD carries the structured fields but a truncated description; the
 * visible `div.markdown` carries the full description with its paragraph
 * markup already flattened by Remote OK, so line breaks are only approximate.
 */
export function parseJobPage(html: string, id: string, pageUrl: string): JobDetail | null {
  const ld = jobPostingLd(html)
  if (!ld) return null
  const title = clean(str(ld.title)) || null
  if (!title) return null
  const org = obj(ld.hiringOrganization)
  const salary = obj(obj(ld.baseSalary)?.value)
  const applicant = Array.isArray(ld.applicantLocationRequirements)
    ? ld.applicantLocationRequirements.map((r) => clean(str(obj(r)?.name))).filter(Boolean)
    : []

  // The body sits inside the description block as either `div.html` (markup
  // with <br> breaks kept) or `div.markdown` (paragraph tags already dropped).
  const block = extractDivContent(html, "description") ?? html
  const htmlBody = extractDivContent(block, "html")
  const markdownBody = htmlBody === null ? extractDivContent(block, "markdown") : null
  let description: string | null = null
  if (htmlBody !== null || markdownBody !== null) {
    // The page prints literal "\n" sequences where the salary footer starts.
    description = htmlToText((htmlBody ?? markdownBody ?? "").replace(/\\n/g, "<br>"))
    if (description) {
      description = description
        .split("\n")
        .filter((line) => !/^Upgrade to Premium to see salary/i.test(line))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    }
    // Sentences run together where Remote OK dropped the paragraph tags
    // ("...come.This is"); put a break back at those sentence joins.
    if (description && markdownBody !== null) description = description.replace(/([.!?])(?=[A-Z][a-z])/g, "$1\n")
  }
  if (!description) description = clean(str(ld.description)) || null

  const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1]
  const urlCandidate = canonical ? decodeHtmlEntities(canonical) : pageUrl
  let url = `${JOB_URL}/${id}`
  try {
    const parsed = new URL(urlCandidate)
    if (REMOTEOK_HOST.test(parsed.hostname) && /^\/remote-jobs\//.test(parsed.pathname)) {
      url = `https://remoteok.com${parsed.pathname}`
    }
  } catch {
    // keep the id URL
  }

  const date = str(ld.datePosted)
  const validThrough = str(ld.validThrough)
  return {
    id,
    title,
    company: clean(str(org?.name)) || null,
    location: applicant.length ? applicant.join(", ") : null,
    date: date && !Number.isNaN(Date.parse(date)) ? new Date(Date.parse(date)).toISOString() : null,
    url,
    tags: [],
    salaryMin: positiveNumber(salary?.minValue),
    salaryMax: positiveNumber(salary?.maxValue),
    source: SOURCE,
    employmentType: clean(str(ld.employmentType)) || null,
    validThrough: validThrough && !Number.isNaN(Date.parse(validThrough)) ? new Date(Date.parse(validThrough)).toISOString() : null,
    applicantLocations: applicant.length ? applicant : null,
    description,
    attribution: ATTRIBUTION,
    origin: "page",
  }
}

/** Salary range for display, or "—". Remote OK lists USD per year. */
export function salaryText(min: number | null, max: number | null): string {
  if (min === null && max === null) return "—"
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
  if (min !== null && max !== null && min !== max) return `$${k(min)}–${k(max)}`
  return `$${k((min ?? max) as number)}`
}
