// Data source: eleman.net public HTML pages. No authentication required.
//
// Search reads the portal's path-based listing pages:
//   /is-ilanlari/<position-or-category>
//   /is-ilanlari/<city>
//   /is-ilanlari/<city>/<position-or-category>
// plus the site's own pagination (?sy=N) and posting-age filter (?gun=N),
// neither of which robots.txt disallows. It never touches the legacy search
// script robots.txt disallows (/is_ilanlari.php, ?t=arama) and does not use
// the free-text form (?aranan=), whose result pages are marked noindex,nofollow.
// Detail reads /is-ilani/<slug>-i<id> (no .html suffix, so /*.html$ does not apply).
// Both are parsed with regex over per-card chunks; zero runtime dependencies.

export const BASE_URL = "https://www.eleman.net"
const HOST = /^(?:www\.)?eleman\.net$/i

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; elemannet-cli/1.0)"

// ---------------------------------------------------------------------------
// robots.txt guard
// ---------------------------------------------------------------------------

/**
 * Disallow rules from https://www.eleman.net/robots.txt (User-agent: *),
 * snapshot taken 2026-11-09. Every URL the CLI builds or is handed is checked
 * against this list before it is fetched (and again after redirects).
 */
export const ROBOTS_DISALLOW: readonly string[] = [
  "/*.asp$",
  "/*.html$",
  "/*.htm$",
  "*?t=arama*",
  "*?yazi=*",
  "*?uyelik_tipi=*",
  "*?tip=*",
  "*?ilan_id=*",
  "*?t=*",
  "*?wbtrck=*",
  "/favori.php",
  "/resim_goster.php",
  "/uye_yorum.php",
  "/dogrulama_kodu.php",
  "/basvuru_yap.php",
  "/cv_guncelle.php",
  "/eleman.php",
  "/is_ilanlari.php",
  "/firmalar.php",
  "/arama_complete.php",
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
    throw new RobotsDisallowedError(`refusing to fetch ${url}: eleman.net robots.txt disallows this path`)
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
      throw new RobotsDisallowedError(`${url} redirected to ${response.url}, which eleman.net robots.txt disallows`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Turkish-aware slug, the form eleman.net uses in its URLs:
 * "Grafik Tasarım Uzmanı" -> "grafik-tasarim-uzmani", "İstanbul Avrupa" -> "istanbul-avrupa".
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

// Turkish job-board rich text often uses named entities for Turkish letters
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

/** Inner HTML of the <span> whose opening tag starts at `start`, nesting-aware. */
export function extractSpanAt(html: string, start: number): string | null {
  const openEnd = html.indexOf(">", start)
  if (openEnd === -1) return null
  const re = /<(\/?)span\b[^>]*>/gi
  re.lastIndex = openEnd + 1
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[1]) depth--
    else if (!m[0].endsWith("/>")) depth++
    if (depth === 0) return html.slice(openEnd + 1, m.index)
  }
  return null
}

// ---------------------------------------------------------------------------
// Search parsing
// ---------------------------------------------------------------------------

export interface JobCard {
  /** eleman.net's posting number; pass it to `detail`. */
  id: string
  title: string
  company: string | null
  location: string | null
  /** Always null: eleman.net's listing cards carry no posting date (see `detail`). */
  date: string | null
  /** Benefits shown on the card, e.g. "Yemek, Servis". */
  benefits: string | null
  /** The card's description teaser (truncated by the portal). */
  snippet: string | null
  /** Paid "vitrin" placement; these can repeat across pages. */
  featured: boolean
  url: string
}

const POSTING_PATH = /^\/is-ilani\/(?:[a-z0-9-]*-)?i(\d+)\/?$/i

/** The posting number and canonical-looking URL of an eleman.net posting link, or null. */
export function postingRef(href: string): { id: string; url: string } | null {
  let u: URL
  try {
    u = new URL(href, BASE_URL)
  } catch {
    return null
  }
  if (!HOST.test(u.hostname)) return null
  const m = u.pathname.match(POSTING_PATH)
  if (!m) return null
  return { id: m[1], url: `${BASE_URL}${u.pathname.replace(/\/$/, "")}` }
}

/** Split a card subtitle into company and location (two layouts: `<br>` or a map-marker icon). */
function splitSubtitle(sub: string): { company: string | null; location: string | null } {
  const br = sub.search(/<br\s*\/?>/i)
  if (br !== -1) {
    return { company: clean(sub.slice(0, br)) || null, location: clean(sub.slice(br).replace(/<br\s*\/?>/i, "")) || null }
  }
  const icon = sub.search(/<i\b[^>]*(?:icon-map-marker|hgi-location)/i)
  if (icon !== -1) {
    return {
      company: clean(sub.slice(0, icon)).replace(/\s*-\s*$/, "") || null,
      location: clean(sub.slice(icon)) || null,
    }
  }
  return { company: clean(sub) || null, location: null }
}

/**
 * Parse a listing page: one `ilan_listeleme_bol` card per posting, each a
 * single `<a>` wrapping title, subtitle and teaser. Each card is parsed on
 * its own, so one malformed card cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const seen = new Set<string>()
  const chunks = html.split(/class="c-box__body ilan_listeleme_bol\b/).slice(1)

  for (const raw of chunks) {
    const classRest = raw.slice(0, Math.max(0, raw.indexOf('"')))
    const featured = /vitrin/i.test(classRest)
    // The card's anchor wraps all of its fields and holds no nested <a>, so
    // the first </a> bounds the card (and keeps the footer out of the last one).
    const end = raw.indexOf("</a>")
    const chunk = end === -1 ? raw : raw.slice(0, end)

    const a = chunk.match(/<a\s+([^>]*)>/i)
    const href = a?.[1].match(/href="([^"]+)"/i)?.[1]
    const ref = href ? postingRef(decodeHtmlEntities(href)) : null
    if (!ref || seen.has(ref.id)) continue

    let title = ""
    const h3 = chunk.match(/<h3\b[^>]*class="c-showcase-box__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i)
    if (h3) {
      const badges = h3[1].search(/<div\b/i)
      title = clean(badges === -1 ? h3[1] : h3[1].slice(0, badges))
    }
    if (!title) {
      const attr = a?.[1].match(/title="([^"]*)"/i)?.[1] ?? ""
      title = clean(attr).replace(/\s*iş ilanı$/i, "")
    }
    if (!title) continue

    let company: string | null = null
    let location: string | null = null
    const subStart = chunk.search(/<span\b[^>]*class="c-showcase-box__subtitle"/i)
    if (subStart !== -1) {
      const sub = extractSpanAt(chunk, subStart)
      if (sub !== null) ({ company, location } = splitSubtitle(sub))
    }

    let benefits: string | null = null
    let snippet: string | null = null
    const textRe = /<span\b[^>]*class="c-showcase-box__text[^"]*"[^>]*>/gi
    let t: RegExpExecArray | null
    while ((t = textRe.exec(chunk)) !== null) {
      const inner = extractSpanAt(chunk, t.index)
      if (inner === null) continue
      const text = clean(inner) || null
      // The benefits line leads with an icon; the teaser is plain text.
      if (/<i\b/i.test(inner)) benefits = benefits ?? text
      else snippet = text ?? snippet
    }

    seen.add(ref.id)
    results.push({ id: ref.id, title, company, location, date: null, benefits, snippet, featured, url: ref.url })
  }
  return results
}

/**
 * Split a listing page at eleman.net's "Genişletilmiş arama sonuçlarını
 * görüyorsunuz" ("you are seeing expanded search results") notice. When a
 * listing has no exact matches the site pads it with broadened, mostly
 * unrelated postings after that notice; only cards before it match.
 */
export function splitExpanded(html: string): { matching: string; expanded: string | null } {
  const at = html.search(/Genişletilmiş arama sonuçlar/i)
  return at === -1 ? { matching: html, expanded: null } : { matching: html.slice(0, at), expanded: html.slice(at) }
}

/** Path of the page's <link rel="canonical">, without a trailing slash, or null. */
export function parseCanonicalPath(html: string): string | null {
  const tag = html.match(/<link\b[^>]*rel="canonical"[^>]*>/i)?.[0]
  const href = tag?.match(/href="([^"]+)"/i)?.[1]
  if (!href) return null
  try {
    return new URL(decodeHtmlEntities(href), BASE_URL).pathname.replace(/\/$/, "") || "/"
  } catch {
    return null
  }
}

/** Whether the page links to results page `page + 1` (`?sy=N`). */
export function hasNextPage(html: string, page: number): boolean {
  return new RegExp(`[?&](?:amp;)?sy=${page + 1}(?![0-9])`).test(html)
}

/** The site's posting-age filter values (`?gun=`), in days. */
export const GUN_VALUES = [1, 4, 7, 15, 30] as const

/**
 * Map --jobage to the smallest `gun` window that contains it (2 -> 4, 10 -> 15),
 * or null above 30 days (no filter). Cards carry no date, so the window cannot
 * be narrowed client-side.
 */
export function jobageToGun(days: number): number | null {
  for (const v of GUN_VALUES) if (days <= v) return v
  return null
}

// ---------------------------------------------------------------------------
// Detail parsing
// ---------------------------------------------------------------------------

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  deadline: string | null
  url: string
  employmentType: string | null
  education: string | null
  experience: string | null
  benefits: string | null
  /** Requirement badges as shown, e.g. "Erkek", "25 - 38 arası", "Ehliyet: B", "Dil: İngilizce". */
  criteria: string[]
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
  return typeof v === "string" && v.trim() ? clean(v) || null : null
}

/** "06-11-2026" -> "2026-11-06". */
function dmyToIso(text: string): string | null {
  const m = text.match(/(\d{2})[-.](\d{2})[-.](\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Parse a posting page fetched for posting number `id` (final URL `url`). */
export function parseJobDetail(html: string, id: string, url: string): JobDetail {
  const ld = findJobPostingLd(html) ?? {}
  const org = (ld.hiringOrganization ?? {}) as Record<string, unknown>
  const place = (ld.jobLocation ?? {}) as Record<string, unknown>
  const addr = (Array.isArray(place.address) ? place.address[0] : place.address ?? {}) as Record<string, unknown>

  // Header: <h1> title span + company paragraph, then a map-marker line and a calendar date.
  const h1At = html.search(/<h1\b/i)
  const header = h1At === -1 ? "" : html.slice(h1At, h1At + 4000)
  const hTitle = header.match(/<span\b[^>]*class="[^"]*u-text-ilan-baslik[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
  const hCompany = header.match(/<p\b[^>]*class="[^"]*u-text-ilan-altbaslik[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1]
  const hLoc = header.match(/icon-map-marker"><\/i>[\s\S]*?<span class="notranslate">([\s\S]*?)<\/span>/i)?.[1]
  const hDate = header.match(/icon-calendar"><\/i>\s*([0-9.-]{10})/i)?.[1]

  const title = (hTitle ? clean(hTitle) : "") || ldString(ld.title) || "(untitled)"
  const company = (hCompany ? clean(hCompany) || null : null) ?? ldString(org.name)
  const location = (hLoc ? clean(hLoc) || null : null) ?? ldString(addr.addressLocality)

  // Requirement badges.
  const criteria: string[] = []
  let benefits: string | null = null
  const badgeRe = /<span\b[^>]*class="is_ilani_ozellik_kutusu"[^>]*>([\s\S]*?)<\/span>/gi
  let b: RegExpExecArray | null
  while ((b = badgeRe.exec(html)) !== null) {
    const text = clean(b[1])
    if (!text || /^No:/i.test(text)) continue
    const benefit = text.match(/^Yan Haklar:\s*(.*)$/i)
    if (benefit) {
      benefits = benefits ?? (benefit[1] || null)
      continue
    }
    if (!criteria.includes(text)) criteria.push(text)
  }
  const badge = (label: string): string | null => {
    const hit = criteria.find((c) => c.toLocaleLowerCase("tr-TR").startsWith(label.toLocaleLowerCase("tr-TR") + ":"))
    return hit ? hit.slice(label.length + 1).trim() || null : null
  }

  // Visible description: <div class="d-information"> <div ... class="u-font-size-sm">...</div>
  let description: string | null = null
  const infoAt = html.search(/<div\b[^>]*class="d-information"/i)
  if (infoAt !== -1) {
    const info = extractDivAt(html, infoAt) ?? ""
    const bodyAt = info.search(/<div\b[^>]*class="u-font-size-sm"/i)
    const body = bodyAt === -1 ? null : extractDivAt(info, bodyAt)
    description = body ? cleanMultiline(body) : null
  }
  if (!description && typeof ld.description === "string") {
    // The JSON-LD copy is entity-escaped HTML ("&lt;br /&gt;"): unescape, then treat as markup.
    description = cleanMultiline(decodeHtmlEntities(ld.description))
  }

  const datePosted = ldString(ld.datePosted)
  const validThrough = ldString(ld.validThrough)
  const employment = ldString(ld.employmentType)

  return {
    id,
    title,
    company,
    location,
    date: datePosted ? datePosted.slice(0, 10) : hDate ? dmyToIso(hDate) : null,
    deadline: validThrough ? validThrough.slice(0, 10) : null,
    url,
    employmentType: employment,
    education: badge("Eğitim"),
    experience: badge("Deneyim"),
    benefits: benefits ?? ldString(ld.jobBenefits),
    criteria: criteria.filter((c) => !employment || c !== employment),
    description,
  }
}
