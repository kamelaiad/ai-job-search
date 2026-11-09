import {
  BASE_URL,
  RobotsDisallowedError,
  htmlFetch,
  parseAppliedFilters,
  parseJobCards,
  parseLastPage,
  slugify,
  stripInvisible,
  writeError,
  type AppliedFilters,
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

/** "web tasarım" -> "web-tasarim"; a pasted "...-is-ilanlari" suffix is dropped. */
function keywordSlug(query: string): string {
  return slugify(query).replace(/-?is-ilanlari$/, "")
}

/** "İstanbul" -> "istanbul", "Bursa" -> "bursa", "İstanbul Avrupa" -> "istanbul-avrupa". */
function citySlug(location: string): string {
  return slugify(location).replace(/-?is-ilanlari$/, "")
}

export function listingUrl(parts: { city?: string; keyword?: string }): string {
  if (parts.city && parts.keyword) return `${BASE_URL}/is-ilanlari/${parts.city}/${parts.keyword}-is-ilanlari`
  if (parts.keyword) return `${BASE_URL}/is-ilanlari/${parts.keyword}-is-ilanlari`
  return `${BASE_URL}/is-ilanlari/${parts.city}-is-ilanlari`
}

const keywordApplied = (f: AppliedFilters) => f.k !== null || f.p.length > 0 || f.s.length > 0
const cityApplied = (f: AppliedFilters) => f.sh.length > 0 || f.ilc.length > 0

/** Lower-cased, accent-folded text for comparing a card's location with --location. */
function fold(text: string): string {
  return slugify(text).replace(/-/g, " ")
}

async function fetchListing(url: string): Promise<{ html: string; filters: AppliedFilters }> {
  const html = await htmlFetch(url)
  if (!html) throw new SearchError(`secretcv returned 404 for ${url}`, "NOT_FOUND")
  const filters = parseAppliedFilters(html)
  if (!filters) {
    throw new SearchError(
      "could not read which filters secretcv applied (the searchParameters input is missing - the page markup may have changed)",
      "PARSE_FAILED",
    )
  }
  return { html, filters }
}

export interface SearchOutcome {
  cards: JobCard[]
  source: string
  locationFilter: "portal" | "client-side" | null
  lastPage: number
}

/**
 * Resolve the query/location to secretcv listing pages and parse page 1.
 *
 * - keyword only:   /is-ilanlari/<kw>-is-ilanlari (read as a keyword or a known position)
 * - location only:  /is-ilanlari/<city>-is-ilanlari
 * - both:           /is-ilanlari/<city>/<kw>-is-ilanlari when secretcv knows <kw> as a
 *                   position; otherwise it silently drops the keyword and lists every job
 *                   in the city, so the CLI falls back to the keyword page and keeps only
 *                   cards whose location mentions the city (client-side filter).
 */
export async function resolveSearch(opts: SearchOpts): Promise<SearchOutcome> {
  const keyword = opts.query ? keywordSlug(opts.query) : undefined
  const city = opts.location ? citySlug(opts.location) : undefined
  if (opts.query && !keyword) throw new SearchError(`--query "${opts.query}" has no letters or digits to search for`, "BAD_ARG")
  if (opts.location && !city) throw new SearchError(`--location "${opts.location}" has no letters or digits`, "BAD_ARG")

  if (keyword && city) {
    const url = listingUrl({ city, keyword })
    const { html, filters } = await fetchListing(url)
    if (cityApplied(filters) && keywordApplied(filters)) {
      return { cards: parseJobCards(html), source: url, locationFilter: "portal", lastPage: parseLastPage(html) }
    }
    if (!cityApplied(filters)) {
      throw new SearchError(
        `secretcv does not recognise the location "${opts.location}" - use a Turkish province name such as "İstanbul", "Ankara", "İzmir" or "Bursa"`,
        "LOCATION_NOT_RECOGNIZED",
      )
    }
    // The city page ignored the keyword: use the keyword page and filter by city text.
    const kwUrl = listingUrl({ keyword })
    const kw = await fetchListing(kwUrl)
    if (!keywordApplied(kw.filters)) {
      throw new SearchError(`secretcv did not apply the keyword "${opts.query}" (its page lists all jobs)`, "QUERY_NOT_RECOGNIZED")
    }
    const want = fold(opts.location!)
    const cards = parseJobCards(kw.html).filter((c) => c.location !== null && fold(c.location).includes(want))
    return { cards, source: kwUrl, locationFilter: "client-side", lastPage: parseLastPage(kw.html) }
  }

  if (keyword) {
    const url = listingUrl({ keyword })
    const { html, filters } = await fetchListing(url)
    if (!keywordApplied(filters) && !cityApplied(filters)) {
      throw new SearchError(`secretcv did not apply the keyword "${opts.query}" (its page lists all jobs)`, "QUERY_NOT_RECOGNIZED")
    }
    return { cards: parseJobCards(html), source: url, locationFilter: null, lastPage: parseLastPage(html) }
  }

  const url = listingUrl({ city })
  const { html, filters } = await fetchListing(url)
  if (!cityApplied(filters)) {
    throw new SearchError(
      `secretcv does not recognise the location "${opts.location}" - use a Turkish province name such as "İstanbul", "Ankara", "İzmir" or "Bursa"`,
      "LOCATION_NOT_RECOGNIZED",
    )
  }
  return { cards: parseJobCards(html), source: url, locationFilter: "portal", lastPage: parseLastPage(html) }
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "TITLE".padEnd(40) + " " + "COMPANY".padEnd(28) + " " + "LOCATION".padEnd(18) + " " + "DATE".padEnd(10) + " ID"
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 28).padEnd(28)
    const loc = (c.location || "—").slice(0, 18).padEnd(18)
    const date = (c.date || "—").padEnd(10)
    return `${title} ${company} ${loc} ${date} ${c.id}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const outcome = await resolveSearch(opts)
    let cards = stripInvisible(outcome.cards)
    if (opts.jobage !== undefined) {
      // Client-side: the portal's own date filter is a query parameter, and the
      // CLI only fetches path URLs. Cards with an unreadable date are dropped.
      const maxAge = opts.jobage
      cards = cards.filter((c) => c.ageDays !== null && c.ageDays <= maxAge)
    }
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
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}${c.dateText ? ` (${c.dateText})` : ""}\n  id: ${c.id}\n  ${c.url}`,
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
              lastPage: outcome.lastPage,
              source: outcome.source,
              locationFilter: outcome.locationFilter,
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
