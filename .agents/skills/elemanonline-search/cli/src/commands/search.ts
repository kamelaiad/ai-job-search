import {
  BASE_URL,
  SEARCH_PATH,
  CliError,
  htmlFetch,
  parseSearchPage,
  stripInvisible,
  turkishSlug,
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

/**
 * Location is a path segment (/is-ilanlari/<city-slug>), the keyword is
 * ?term=, posting age is ?publishDate=<days>, and pagination is ?page=<n>
 * (10 results per page, fixed by the site).
 */
export function buildUrl(opts: SearchOpts): string {
  const path = opts.location ? `${SEARCH_PATH}/${encodeURIComponent(turkishSlug(opts.location))}` : SEARCH_PATH
  const params = new URLSearchParams()
  if (opts.query) params.set("term", opts.query)
  if (opts.jobage !== undefined) params.set("publishDate", String(opts.jobage))
  params.set("page", String(opts.page))
  return `${BASE_URL}${path}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 28).padEnd(28)
    const loc = (c.location || "—").slice(0, 26).padEnd(26)
    const date = c.date ? c.date.slice(0, 10) : "—"
    return `${c.id.padEnd(24)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(24) + " " + "TITLE".padEnd(38) + " " + "COMPANY".padEnd(28) + " " + "LOCATION".padEnd(26) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    if (!html) {
      writeError("search page not found (404)", "NOT_FOUND")
      return 1
    }
    const page = parseSearchPage(html)
    // An unknown city slug is not an error on the site: it silently falls back
    // to a nationwide search. Refuse that instead of mislabelling the results.
    if (opts.location && page.provinceId === null) {
      writeError(
        `unknown location "${opts.location}" - use a Turkish province name such as "İstanbul", "Bursa", "Ankara", "İzmir" (or "İstanbul Avrupa" / "İstanbul Anadolu")`,
        "UNKNOWN_LOCATION",
      )
      return 1
    }
    let cards = stripInvisible(page.cards)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: { count: cards.length, page: opts.page, total: page.total, totalPages: page.totalPages },
            results: cards,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof CliError ? e.code : "SEARCH_FAILED")
    return 1
  }
}
