import {
  buildSearchUrl,
  htmlFetch,
  parseSearchPage,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 28).padEnd(28)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    const wp = (c.workplace || "—").slice(0, 10).padEnd(10)
    return `${title} ${company} ${loc} ${wp} ${c.id}`
  })
  const header =
    "TITLE".padEnd(40) + " " + "COMPANY".padEnd(28) + " " + "LOCATION".padEnd(24) + " " + "WORKPLACE".padEnd(10) + " ID"
  return [header, "-".repeat(header.length + 30), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildSearchUrl(opts))
    if (!html) {
      writeError("Techcareer returned 404 for the job search page", "SEARCH_FAILED")
      return 1
    }
    const page = parseSearchPage(html)
    let cards = stripInvisible(page.cards)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      if (cards.length === 0) {
        process.stdout.write("No results.\n")
        return 0
      }
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"}${c.otherLocations ? ` (+${c.otherLocations})` : ""} · ${c.workplace || "—"}\n  id: ${c.id}\n  ${c.url}`,
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
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
