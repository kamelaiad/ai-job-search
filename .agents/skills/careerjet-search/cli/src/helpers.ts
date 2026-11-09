// Data source: Careerjet's official v4 job-search API (search.api.careerjet.net),
// queried with the Türkiye locale (tr_TR) so results match careerjet.com.tr.
//
// Why the API and not the website: careerjet.com.tr serves a Cloudflare
// Turnstile "Doğrulama gerekli" (verification required) page instead of search
// results to a non-browser client, and its robots.txt disallows the job pages
// (/job/, /jobview/, /clk/, ...). The API is the channel Careerjet documents for
// programmatic access; it needs a free publisher API key (Basic auth username,
// empty password), read only from the CAREERJET_API_TOKEN environment variable.
//
// The API returns JSON, so "parsing" is mapping each job object independently -
// one malformed job is skipped without breaking the rest. Text fields can carry
// markup (keyword highlighting, entities) and are cleaned through visibleHtml,
// entity decoding and stripInvisible before any output format sees them.

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export const API_URL = "https://search.api.careerjet.net/v4/query"
export const LOCALE = "tr_TR"
export const TOKEN_ENV = "CAREERJET_API_TOKEN"
export const UA = "Mozilla/5.0 (compatible; careerjet-cli/1.0)"
/** Results per API page. The API allows 1-100; fixed here so --page is stable. */
export const PAGE_SIZE = 20
/** The API serves pages 1-10 only. */
export const MAX_PAGE = 10
/**
 * Excerpt length requested from the API. The default is 120 characters; a
 * longer excerpt is what `detail` returns, because the API has no
 * single-posting endpoint and careerjet's own job pages are robots-disallowed.
 */
export const FRAGMENT_SIZE = 1500
/** Length of the `snippet` field in search output. */
export const SNIPPET_LENGTH = 240

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** An error that carries the contract's stderr `code`. */
export class CliError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
  }
}

/** The publisher API key, or null when the environment variable is unset/blank. */
export function readToken(): string | null {
  const raw = process.env[TOKEN_ENV]
  return raw && raw.trim() ? raw.trim() : null
}

export function missingTokenMessage(): string {
  return (
    `${TOKEN_ENV} is not set. Careerjet's search API needs a free publisher API key: ` +
    `sign up at https://www.careerjet.com.tr/partners/api (Publisher account), then ` +
    `export ${TOKEN_ENV}=<your key> in your shell. The key is never accepted as a flag.`
  )
}

/** Text of an API error body ({"error": "...", "type": "ERROR"}), if any. */
function apiErrorText(body: string): string | null {
  try {
    const j = JSON.parse(body)
    if (j && typeof j.error === "string") return j.error
  } catch {
    // not JSON
  }
  return null
}

/**
 * GET the API with Basic auth and exponential backoff with jitter on 429/5xx
 * (initial attempt + 6 retries). Returns null on a 404. Auth and request errors
 * are not retried: they throw a CliError naming the API's own message.
 */
export async function apiFetch(url: string, token: string): Promise<unknown | null> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json",
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
  }
  // Optional: the publisher page URL registered with the key. Careerjet's curl
  // example sends one (-e); it is configuration, not a secret, and is never
  // invented - when unset no Referer is sent.
  const referer = process.env.CAREERJET_REFERER?.trim()
  if (referer) headers.Referer = referer

  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new CliError(`Request failed: ${response.status} ${response.statusText}`, "API_UNAVAILABLE")
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    const body = await response.text()
    if (response.status === 401) {
      const msg = apiErrorText(body) ?? "unauthorized"
      throw new CliError(`Careerjet API rejected the key in ${TOKEN_ENV}: ${msg}`, "AUTH_FAILED")
    }
    if (!response.ok) {
      const msg = apiErrorText(body) ?? `${response.status} ${response.statusText}`
      throw new CliError(`Careerjet API error (${response.status}): ${msg}`, "API_ERROR")
    }
    try {
      return JSON.parse(body)
    } catch {
      throw new CliError("Careerjet API returned a non-JSON response", "BAD_RESPONSE")
    }
  }
  throw new CliError("Request failed after max retries", "API_UNAVAILABLE")
}

// ---------------------------------------------------------------------------
// Output hygiene (copied from linkedin-search/cli/src/helpers.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points decode correctly, and
 * drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// Named entities seen in Turkish and general job text. Unknown names are left as-is.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ccedil: "ç", Ccedil: "Ç", ouml: "ö", Ouml: "Ö", uuml: "ü", Uuml: "Ü",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—",
  hellip: "…", bull: "•", middot: "·", euro: "€", trade: "™", reg: "®", copy: "©",
}

/** Decode entities in one pass, so "&amp;lt;" becomes the text "&lt;", not "<". */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return numericEntity(cp)
    }
    return NAMED_ENTITIES[body] ?? whole
  })
}

/** Visible text of an API string field (which may carry markup), whitespace collapsed; null if empty or not a string. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = decodeHtmlEntities(visibleHtml(value).replace(/<[^>]+>/g, " "))
    .replace(INVISIBLE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
  return text || null
}

/** Like cleanText, but keeps paragraph and line breaks (for the detail description). */
export function cleanMultiline(value: unknown): string | null {
  if (typeof value !== "string") return null
  // Hidden markup goes before the line split: a hidden element can span the
  // breaks, and cleaning line by line would only see half of it.
  const withBreaks = visibleHtml(value)
    .replace(/\r\n?/g, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/li\s*>/gi, "")
    .replace(/<\/?(p|ul|ol|div|h\d)\b[^>]*>/gi, "\n")
  const text = withBreaks
    .split("\n")
    .map((line) => cleanText(line) ?? "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

/**
 * Parse the API's RFC-1123-style date ("Wed,15 Nov 2025 19:13:43 GMT" - note
 * the documented example has no space after the comma) to YYYY-MM-DD (UTC).
 * Returns null when it does not parse.
 */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const normalized = value.trim().replace(/^([A-Za-z]{3}),(?=\S)/, "$1, ")
  const ms = Date.parse(normalized)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}

const SALARY_PERIODS: Record<string, string> = { Y: "yearly", M: "monthly", W: "weekly", D: "daily", H: "hourly" }

// ---------------------------------------------------------------------------
// Search response parsing
// ---------------------------------------------------------------------------

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  salary: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  snippet: string | null
}

/** A search hit as kept in the local cache for `detail`: the result plus the full excerpt. */
export interface JobRecord extends JobResult {
  description: string | null
}

export type ParsedResponse =
  | { kind: "jobs"; hits: number | null; pages: number | null; jobs: JobRecord[] }
  | { kind: "locations"; message: string; locations: string[] }

/**
 * Stable id for a posting. The API returns no id, and its `url` is a
 * click-tracking link that may not be stable across calls, so the id hashes
 * the posting's visible identity: title, company, location and date.
 */
export function makeId(title: string, company: string | null, location: string | null, date: string | null): string {
  const key = [title, company ?? "", location ?? "", date ?? ""].map((s) => s.toLocaleLowerCase("tr-TR")).join("\u0001")
  return "cj-" + createHash("sha1").update(key).digest("hex").slice(0, 16)
}

/** Map one API job object; null when it lacks a title or a usable URL. */
export function parseJob(raw: unknown): JobRecord | null {
  if (!raw || typeof raw !== "object") return null
  const j = raw as Record<string, unknown>
  const title = cleanText(j.title)
  const urlText = typeof j.url === "string" ? j.url.trim() : ""
  if (!title || !/^https?:\/\//i.test(urlText)) return null
  let url: string
  try {
    url = new URL(urlText).toString()
  } catch {
    return null
  }
  const company = cleanText(j.company)
  const location = cleanText(j.locations)
  const date = toIsoDate(j.date)
  const description = cleanMultiline(j.description)
  const flat = description ? description.replace(/\s+/g, " ") : null
  const snippet = flat
    ? flat.length > SNIPPET_LENGTH
      ? flat.slice(0, SNIPPET_LENGTH).replace(/\s+\S*$/, "") + " …"
      : flat
    : null
  const periodCode = typeof j.salary_type === "string" ? j.salary_type.trim().toUpperCase() : ""
  return {
    id: makeId(title, company, location, date),
    title,
    company,
    location,
    date,
    url,
    salary: cleanText(j.salary),
    salaryMin: finiteNumber(j.salary_min),
    salaryMax: finiteNumber(j.salary_max),
    salaryCurrency: cleanText(j.salary_currency_code),
    salaryPeriod: SALARY_PERIODS[periodCode] ?? null,
    snippet,
    description,
  }
}

/**
 * Parse a v4 search response. Each job is mapped independently (the JSON
 * equivalent of chunked HTML parsing): a malformed entry is dropped, the rest
 * survive. "LOCATIONS" responses (ambiguous or unknown --location) are
 * returned as such so the CLI can report them; anything else throws.
 */
export function parseSearchResponse(json: unknown): ParsedResponse {
  if (!json || typeof json !== "object") throw new CliError("Unexpected API response shape", "BAD_RESPONSE")
  const r = json as Record<string, unknown>
  if (r.type === "LOCATIONS") {
    const locations = Array.isArray(r.locations)
      ? r.locations.map((l) => cleanText(l)).filter((l): l is string => l !== null)
      : []
    return { kind: "locations", message: cleanText(r.message) ?? "location not resolved", locations }
  }
  if (r.type === "ERROR") {
    throw new CliError(`Careerjet API error: ${cleanText(r.error) ?? "unknown error"}`, "API_ERROR")
  }
  if (r.type !== "JOBS" && !Array.isArray(r.jobs)) {
    throw new CliError("Unexpected API response shape (no jobs list)", "BAD_RESPONSE")
  }
  const jobs: JobRecord[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(r.jobs) ? r.jobs : []) {
    let job: JobRecord | null = null
    try {
      job = parseJob(raw)
    } catch {
      job = null
    }
    if (!job || seen.has(job.id)) continue
    seen.add(job.id)
    jobs.push(job)
  }
  return { kind: "jobs", hits: finiteNumber(r.hits), pages: finiteNumber(r.pages), jobs }
}

/** Drop the cache-only `description` to get the search-output shape. */
export function toResult(job: JobRecord): JobResult {
  const { description: _description, ...result } = job
  return result
}

/** Whether a YYYY-MM-DD date is within the last `days` days (unknown dates are not). */
export function withinDays(date: string | null, days: number, now = Date.now()): boolean {
  if (!date) return false
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(ms)) return false
  // Compare whole UTC days so "posted today" counts as 0 days old.
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  return (today - ms) / 86_400_000 <= days
}

// ---------------------------------------------------------------------------
// Local result cache (what `detail` reads)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 14 * 86_400_000
const CACHE_MAX = 1000

interface CacheFile {
  version: 1
  jobs: Record<string, { savedAt: number; job: JobRecord }>
}

/** Cache location: $CAREERJET_CACHE_FILE, else careerjet-search-cache.json in the OS temp dir. */
export function cachePath(): string {
  const override = process.env.CAREERJET_CACHE_FILE?.trim()
  return override || join(tmpdir(), "careerjet-search-cache.json")
}

function readCache(): CacheFile {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8"))
    if (parsed && parsed.version === 1 && parsed.jobs && typeof parsed.jobs === "object") return parsed as CacheFile
  } catch {
    // missing or corrupt: start fresh
  }
  return { version: 1, jobs: {} }
}

/** Merge search hits into the cache (best effort: a failed write never fails the search). */
export function saveToCache(jobs: JobRecord[], now = Date.now()): void {
  try {
    const cache = readCache()
    for (const job of jobs) cache.jobs[job.id] = { savedAt: now, job }
    const kept = Object.entries(cache.jobs)
      .filter(([, e]) => e && typeof e.savedAt === "number" && now - e.savedAt <= CACHE_TTL_MS)
      .sort((a, b) => b[1].savedAt - a[1].savedAt)
      .slice(0, CACHE_MAX)
    const path = cachePath()
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, jobs: Object.fromEntries(kept) }))
    renameSync(tmp, path)
  } catch {
    // ignore: detail will report NOT_FOUND for jobs it cannot find
  }
}

/** Look up a cached search hit by id or by its exact URL. */
export function findInCache(key: { id?: string; url?: string }): { savedAt: number; job: JobRecord } | null {
  const cache = readCache()
  if (key.id) {
    const e = cache.jobs[key.id]
    return e && e.job ? e : null
  }
  if (key.url) {
    for (const e of Object.values(cache.jobs)) if (e?.job?.url === key.url) return e
  }
  return null
}

/** Map --contract / --hours / --sort values to the API's codes (null if unknown). */
export const CONTRACT_CODES: Record<string, string> = {
  permanent: "p",
  contract: "c",
  temporary: "t",
  internship: "i",
  volunteer: "v",
}
export const HOURS_CODES: Record<string, string> = { full: "f", part: "p" }
export const SORT_VALUES = new Set(["relevance", "date", "salary"])
