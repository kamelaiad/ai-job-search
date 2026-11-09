// Data source: toptalent.co public pages. No authentication.
// - search: the site's own listing XHR, POST /Job/SearchJob with a JSON body,
//   which returns an HTML fragment of result cards (the /is-ilanlari page
//   loads its list through the same endpoint).
// - detail: the server-rendered posting page https://toptalent.co/<slug>.
// robots.txt does not disallow /Job/ or posting pages (checked 2026-11-09).

export const BASE_URL = "https://toptalent.co"
export const SEARCH_URL = `${BASE_URL}/Job/SearchJob`
/** Results per page, the value the site itself sends. */
export const PAGE_SIZE = 9

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; toptalent-cli/1.0)"

export interface FetchResult {
  /** Response body; "" on a 404. */
  html: string
  /** URL after redirects. */
  finalUrl: string
  /** HTTP status of the final response. */
  status: number
}

/**
 * GET (or POST a JSON body) with exponential backoff and jitter on 429/5xx.
 * Returns html "" on a 404.
 */
export async function htmlFetch(url: string, jsonBody?: unknown): Promise<FetchResult> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    }
    if (jsonBody !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8"
      headers["X-Requested-With"] = "XMLHttpRequest"
    }
    const response = await fetch(url, {
      method: jsonBody === undefined ? "GET" : "POST",
      headers,
      body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
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
    if (response.status === 404) return { html: "", finalUrl: response.url || url, status: 404 }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return { html: await response.text(), finalUrl: response.url || url, status: response.status }
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  /** Posting slug, e.g. "acme-ui-ux-designer-121812". Pass to `detail`. */
  id: string
  title: string
  company: string | null
  /** As shown on the card, e.g. "İstanbul Anadolu" or "Tüm Türkiye" (nationwide). */
  location: string | null
  /** Posting date. Always null in search: result cards carry no date. Use `detail`. */
  date: string | null
  /** Days until the application deadline, from the "Son N Gün" badge; null when the card has none. */
  daysLeft: number | null
  url: string
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  locations: string[]
  /** Posting date (ISO YYYY-MM-DD), from the page's JobPosting metadata. */
  date: string | null
  daysLeft: number | null
  departments: string[]
  /** "Kimler Başvurabilir?" - who can apply (student year / experience level). */
  eligibility: string[]
  /** schema.org employmentType, e.g. INTERN, FULL_TIME. */
  employmentType: string | null
  description: string | null
  /** "posting" for a regular listing, "campaign" for a company program landing page. */
  layout: "posting" | "campaign"
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
// toptalent-specific parsing
// ---------------------------------------------------------------------------

/** Fold Turkish letters and case so "İSTANBUL", "Istanbul" and "istanbul" compare equal. */
export function foldTr(input: string): string {
  return input
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
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * toptalent's city filter ids (CityIds), from GET /Job/JobsFilter on
 * 2026-11-09. They are licence-plate codes, except that İstanbul is split
 * into Avrupa (34) and Anadolu (82).
 */
export const CITY_IDS: Record<string, number[]> = {
  "İstanbul": [34, 82], "İstanbul Avrupa": [34], "İstanbul Anadolu": [82],
  "Adana": [1], "Adıyaman": [2], "Afyonkarahisar": [3], "Ağrı": [4], "Amasya": [5], "Ankara": [6],
  "Antalya": [7], "Artvin": [8], "Aydın": [9], "Balıkesir": [10], "Bilecik": [11], "Bingöl": [12],
  "Bitlis": [13], "Bolu": [14], "Burdur": [15], "Bursa": [16], "Çanakkale": [17], "Çankırı": [18],
  "Çorum": [19], "Denizli": [20], "Diyarbakır": [21], "Edirne": [22], "Elazığ": [23], "Erzincan": [24],
  "Erzurum": [25], "Eskişehir": [26], "Gaziantep": [27], "Giresun": [28], "Gümüşhane": [29],
  "Hakkari": [30], "Hatay": [31], "Isparta": [32], "Mersin": [33], "İzmir": [35], "Kars": [36],
  "Kastamonu": [37], "Kayseri": [38], "Kırklareli": [39], "Kırşehir": [40], "Kocaeli": [41],
  "Konya": [42], "Kütahya": [43], "Malatya": [44], "Manisa": [45], "Kahramanmaraş": [46],
  "Mardin": [47], "Muğla": [48], "Muş": [49], "Nevşehir": [50], "Niğde": [51], "Ordu": [52],
  "Rize": [53], "Sakarya": [54], "Samsun": [55], "Siirt": [56], "Sinop": [57], "Sivas": [58],
  "Tekirdağ": [59], "Tokat": [60], "Trabzon": [61], "Tunceli": [62], "Şanlıurfa": [63], "Uşak": [64],
  "Van": [65], "Yozgat": [66], "Zonguldak": [67], "Aksaray": [68], "Bayburt": [69], "Karaman": [70],
  "Kırıkkale": [71], "Batman": [72], "Şırnak": [73], "Bartın": [74], "Ardahan": [75], "Iğdır": [76],
  "Yalova": [77], "Karabük": [78], "Kilis": [79], "Osmaniye": [80], "Düzce": [81],
}

const CITY_LOOKUP: Map<string, number[]> = new Map(
  Object.entries(CITY_IDS).map(([name, ids]) => [foldTr(name), ids]),
)
CITY_LOOKUP.set("icel", [33])

/** Resolve a comma-separated city list to CityIds; unknown names are returned separately. */
export function resolveCities(input: string): { ids: number[]; unknown: string[] } {
  const ids = new Set<number>()
  const unknown: string[] = []
  for (const part of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const hit = CITY_LOOKUP.get(foldTr(part))
    if (hit) hit.forEach((id) => ids.add(id))
    else unknown.push(part)
  }
  return { ids: [...ids], unknown }
}

/** "Kimler Başvurabilir?" levels (PositionLevelIds) keyed by CLI value. */
export const LEVEL_IDS: Record<string, { id: number; label: string }> = {
  prep: { id: 10, label: "Hazırlık" },
  "1st-year": { id: 9, label: "1. Sınıf" },
  "2nd-year": { id: 8, label: "2. Sınıf" },
  "3rd-year": { id: 7, label: "3. Sınıf" },
  "4th-year": { id: 6, label: "4. Sınıf" },
  "masters-student": { id: 5, label: "Master Öğrencisi" },
  "phd-student": { id: 4, label: "Doktora Öğrencisi" },
  "new-grad": { id: 3, label: "Yeni Mezun" },
  "exp-0-1": { id: 2, label: "0-1 yıl tecrübeli" },
  "exp-1-3": { id: 1, label: "1-3 yıl tecrübeli" },
  "exp-3-5": { id: 11, label: "3-5 yıl tecrübeli" },
  "exp-5-10": { id: 12, label: "5-10 yıl tecrübeli" },
  "exp-10-plus": { id: 13, label: "10+ yıl tecrübeli" },
}

export interface SearchBodyOpts {
  query?: string
  cityIds?: number[]
  levelIds?: number[]
  page: number
}

/** The JSON body the site's own listing page POSTs to /Job/SearchJob. */
export function buildSearchBody(opts: SearchBodyOpts): Record<string, unknown> {
  return {
    PageSize: PAGE_SIZE,
    PageNumber: opts.page,
    IsCardView: false,
    SearchKey: opts.query ?? "",
    DepartmentIds: [],
    CityIds: opts.cityIds ?? [],
    PositionLevelIds: opts.levelIds ?? [],
    OrderBy: "newests",
    FilterTags: [],
    DepartmentSeo: null,
    CitySeo: null,
  }
}

/** "Son 17 Gün" -> 17, "Son Gün" -> 0; null when there is no countdown. */
export function parseDaysLeft(text: string | null | undefined): number | null {
  const t = (text || "").trim()
  if (!t) return null
  const n = t.match(/(\d+)\s*gün/i)
  if (n) return parseInt(n[1], 10)
  if (/son\s*gün|bugün/i.test(t)) return 0
  return null
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{2,200}$/
const POSTING_HOST = /^(?:www\.)?toptalent\.co$/i

/**
 * Posting slugs robots.txt disallows. The CLI never fetches these: robots.txt
 * is the site owner's stated policy, and a portal skill does not override it.
 */
export const ROBOTS_DISALLOWED_SLUGS = new Set(["turkiye-sigorta-geleceginin-sigortasi-120944"])

/**
 * Accept a posting slug ("acme-web-developer-121812"), a path ("/acme-...")
 * or a toptalent.co URL, and return the slug. Other hosts, multi-segment
 * paths and query strings are rejected.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let path: string
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^(?:www\.)?toptalent\.co(?:\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!POSTING_HOST.test(parsed.hostname) || parsed.username || parsed.password) return null
    path = parsed.pathname
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /[?#]/.test(trimmed)) {
    return null
  } else {
    path = trimmed
  }
  const segments = path.split("/").filter(Boolean)
  if (segments.length !== 1) return null
  const slug = segments[0]
  if (!SLUG.test(slug) || !slug.includes("-")) return null
  if (/^is-ilanlari$/i.test(slug)) return null
  return slug
}

/**
 * Parse the /Job/SearchJob HTML fragment: one `<a class="position">` card per
 * posting. The fragment is cut at each card's opening tag and every chunk is
 * parsed on its own, so one malformed card cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const starts = [...html.matchAll(/<a\b[^>]*\bclass="position"[^>]*>/gi)]
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index ?? 0
    const end = i + 1 < starts.length ? (starts[i + 1].index ?? html.length) : html.length
    const chunk = html.slice(start, end)

    const href = starts[i][0].match(/href="([^"]+)"/i)?.[1]
    if (!href) continue
    let url: string
    try {
      url = new URL(decodeHtmlEntities(href), BASE_URL).toString()
    } catch {
      continue
    }
    const id = normalizeId(url)
    if (!id) continue

    const titleHtml = chunk.match(/<h5[^>]*class="[^"]*card-title[^"]*"[^>]*>([\s\S]*?)<\/h5>/i)?.[1]
    const title = titleHtml ? clean(titleHtml) : ""
    if (!title) continue

    const cardText = chunk.match(/<p class="card-text">([\s\S]*?)<\/p>/i)?.[1] ?? ""
    const spanAt = cardText.search(/<span\b/i)
    const company = clean(spanAt === -1 ? cardText : cardText.slice(0, spanAt)) || null
    const locHtml = cardText.match(/<span[^>]*class="[^"]*text-grey[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
    const location = locHtml ? clean(locHtml) || null : null

    const badge = chunk.match(/class=['"][^'"]*badge-circle-[a-z]+[^'"]*['"][^>]*>([^<]*)</i)?.[1]
    const daysLeft = parseDaysLeft(badge ? clean(badge) : null)

    results.push({ id, title, company, location, date: null, daysLeft, url: `${BASE_URL}/${id}` })
  }
  return results
}

function listAfterHeading(html: string, heading: RegExp): string[] {
  const re = new RegExp(`<h5[^>]*>\\s*${heading.source}\\s*<\\/h5>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`, "i")
  const block = html.match(re)?.[1]
  if (!block) return []
  return visibleHtml(block)
    .split(/<br\s*\/?>/i)
    .map((s) => clean(s).replace(/^•\s*/, "").trim())
    .filter(Boolean)
}

function ldString(html: string, key: string, pattern: RegExp): string | null {
  // The JSON-LD block here is not strict JSON (raw newlines inside strings),
  // so single keys are read with a regex and validated against `pattern`.
  const ld = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? ""
  if (!/"@type"\s*:\s*"JobPosting"/.test(ld)) return null
  const v = ld.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1]
  return v && pattern.test(v) ? v : null
}

/** Parse a posting page; null when the page is neither a posting nor a program landing page. */
export function parseJobDetail(html: string, id: string, url: string): JobDetail | null {
  const content = extractDivContent(html, "job-content")
  if (content) {
    const media = html.match(/class="media-body"[^>]*>([\s\S]*?)<\/li>/i)?.[1] ?? ""
    const titleHtml = media.match(/<span class="[^"]*ff-pnova-b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
    const companyHtml = media.match(/<div class="clearfix"><\/div>([\s\S]*?)<\/div>/i)?.[1]
    const logoAlt = html.match(/<img[^>]*class="comp-logo[^"]*"[^>]*alt="([^"]*)"/i)?.[1]
    const badge = media.match(/class=['"][^'"]*badge-circle-[a-z]+[^'"]*['"][^>]*>([^<]*)</i)?.[1]

    const eligibilityBlock = html.match(/<h5[^>]*>\s*Kimler Başvurabilir\?\s*<\/h5>([\s\S]*?)<\/div>/i)?.[1] ?? ""
    const eligibility = [...visibleHtml(eligibilityBlock).matchAll(/<input\b([^>]*)>/gi)]
      .filter((m) => !/type="hidden"/i.test(m[1]))
      .map((m) => clean(decodeHtmlEntities(m[1].match(/value="([^"]*)"/i)?.[1] ?? "")))
      .filter(Boolean)

    const descHtml = content.inner.split(/<div class="menu-seperator/i)[0]
    const locations = listAfterHeading(html, /Lokasyon/)
    return {
      id,
      title: (titleHtml ? clean(titleHtml) : "") || "(untitled)",
      company: (companyHtml ? clean(companyHtml) : "") || (logoAlt ? clean(logoAlt) : "") || null,
      location: locations.length ? locations.join(", ") : null,
      locations,
      date: ldString(html, "datePosted", /^\d{4}-\d{2}-\d{2}/)?.slice(0, 10) ?? null,
      daysLeft: parseDaysLeft(badge ? clean(badge) : null),
      departments: listAfterHeading(html, /Departman/),
      eligibility,
      employmentType: ldString(html, "employmentType", /^[A-Z_]{2,20}$/),
      description: richText(descHtml),
      layout: "posting",
      url,
    }
  }

  // Company program landing page (e.g. a sponsored internship program): a
  // banner <h1 class="title">, an apply button, and CMS blocks in .ckContent.
  const h1 = html.match(/<h1 class="title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  if (h1 && /ckContent/.test(html) && /Başvur/.test(html)) {
    const blocks: string[] = []
    let from = 0
    for (;;) {
      const block = extractDivContent(html, "ckContent", from)
      if (!block) break
      const text = richText(block.inner)
      if (text) blocks.push(text)
      from = block.end
    }
    const lead = html.match(/<p class="lead[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1]
    const pageTitle = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
    const tail = pageTitle ? clean(pageTitle) : ""
    const dash = tail.lastIndexOf(" - ")
    const company = dash === -1 ? null : tail.slice(dash + 3).trim() || null
    const description = [lead ? clean(lead) : "", ...blocks].filter(Boolean).join("\n\n") || null
    return {
      id,
      title: clean(h1) || "(untitled)",
      company,
      location: null,
      locations: [],
      date: null,
      daysLeft: null,
      departments: [],
      eligibility: [],
      employmentType: null,
      description,
      layout: "campaign",
      url,
    }
  }

  return null
}
