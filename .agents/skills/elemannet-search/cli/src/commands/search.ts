import {
  BASE_URL,
  RobotsDisallowedError,
  hasNextPage,
  htmlFetch,
  jobageToGun,
  parseCanonicalPath,
  parseJobCards,
  slugify,
  splitExpanded,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** A failure the user can act on; carries its own stderr error code. */
export class SearchError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

const QUERY_HINT =
  'eleman.net only has listing pages for its own position and category names (e.g. "grafik tasarım uzmanı", "grafik", "arayüz tasarımcısı", "muhasebe"); free-text search is not available through robots-permitted pages'

/** The listing path for a keyword and/or city: /is-ilanlari/<city>/<kw>, /is-ilanlari/<kw>, /is-ilanlari/<city>. */
export function listingPath(parts: { city?: string; keyword?: string }): string {
  if (parts.city && parts.keyword) return `/is-ilanlari/${parts.city}/${parts.keyword}`
  if (parts.keyword) return `/is-ilanlari/${parts.keyword}`
  return `/is-ilanlari/${parts.city}`
}

export function buildUrl(opts: SearchOpts): { url: string; path: string; gun: number | null } {
  const keyword = opts.query ? slugify(opts.query) : undefined
  const city = opts.location ? slugify(opts.location) : undefined
  if (opts.query && !keyword) throw new SearchError(`--query "${opts.query}" has no letters or digits to search for`, "BAD_ARG")
  if (opts.location && !city) throw new SearchError(`--location "${opts.location}" has no letters or digits`, "BAD_ARG")
  const path = listingPath({ city, keyword })
  const params = new URLSearchParams()
  const gun = opts.jobage !== undefined ? jobageToGun(opts.jobage) : null
  if (gun !== null) params.set("gun", String(gun))
  if (opts.page > 1) params.set("sy", String(opts.page))
  const qs = params.toString()
  return { url: `${BASE_URL}${path}${qs ? `?${qs}` : ""}`, path, gun }
}

export interface SearchOutcome {
  cards: JobCard[]
  source: string
  jobageDays: number | null
  hasNextPage: boolean
  expandedOmitted: number
}

/**
 * Fetch one listing page and confirm eleman.net actually served the page that
 * was asked for. An unknown slug is not a 404: the site answers 200 with its
 * generic listing (every job, or every job in the city) and says so only in
 * <link rel="canonical">. Presenting that page as matches would be wrong, so
 * a fallback canonical is an error.
 */
export async function resolveSearch(opts: SearchOpts): Promise<SearchOutcome> {
  const { url, path, gun } = buildUrl(opts)
  const html = await htmlFetch(url)
  if (!html) throw new SearchError(`eleman.net returned 404 for ${url}`, "NOT_FOUND")
  const canonical = parseCanonicalPath(html)
  if (canonical === null) {
    throw new SearchError(
      "could not read the page's canonical link, so the CLI cannot tell whether eleman.net applied the query (markup may have changed)",
      "PARSE_FAILED",
    )
  }
  if (canonical !== path) {
    const city = opts.location ? slugify(opts.location) : undefined
    const fellBackToAll = canonical === "/is-ilanlari"
    const fellBackToCity = Boolean(opts.query && city && canonical === `/is-ilanlari/${city}`)
    if (fellBackToAll && !opts.query) {
      throw new SearchError(
        `eleman.net does not recognise the location "${opts.location}" - use a Turkish province or district such as "İstanbul", "Ankara", "İzmir", "Bursa" or "Nilüfer"`,
        "LOCATION_NOT_RECOGNIZED",
      )
    }
    if (fellBackToCity || (fellBackToAll && !opts.location)) {
      throw new SearchError(`eleman.net has no listing page for "${opts.query}" - ${QUERY_HINT}`, "QUERY_NOT_RECOGNIZED")
    }
    if (fellBackToAll) {
      throw new SearchError(
        `eleman.net has no listing page for "${opts.query}" in "${opts.location}" - check the city name; ${QUERY_HINT}`,
        "QUERY_NOT_RECOGNIZED",
      )
    }
    // Any other canonical is a specific listing (e.g. an alias slug): accept it.
  }
  const { matching, expanded } = splitExpanded(html)
  return {
    cards: parseJobCards(matching),
    source: url,
    jobageDays: gun,
    hasNextPage: hasNextPage(html, opts.page),
    expandedOmitted: expanded === null ? 0 : parseJobCards(expanded).length,
  }
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header = "ID".padEnd(8) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(28) + " " + "LOCATION"
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 28).padEnd(28)
    return `${c.id.padEnd(8)} ${title} ${company} ${c.location || "—"}`
  })
  return [header, "-".repeat(header.length + 24), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const outcome = await resolveSearch(opts)
    let cards = stripInvisible(outcome.cards)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (cards.length === 0
          ? "No results."
          : cards
              .map(
                (c) =>
                  `${c.title}${c.featured ? " [vitrin]" : ""}\n  ${c.company || "—"} · ${c.location || "—"}${c.benefits ? ` · ${c.benefits}` : ""}\n  id: ${c.id}\n  ${c.url}${c.snippet ? `\n  ${c.snippet}` : ""}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: cards.length,
              page: opts.page,
              hasNextPage: outcome.hasNextPage,
              jobageDays: outcome.jobageDays,
              expandedOmitted: outcome.expandedOmitted,
              source: outcome.source,
            },
            results: cards,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    if (e instanceof SearchError) writeError(e.message, e.code)
    else if (e instanceof RobotsDisallowedError) writeError(e.message, "ROBOTS_DISALLOWED")
    else writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
