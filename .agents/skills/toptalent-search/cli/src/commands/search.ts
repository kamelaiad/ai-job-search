import {
  PAGE_SIZE,
  SEARCH_URL,
  buildSearchBody,
  htmlFetch,
  parseJobCards,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  cityIds?: number[]
  levelIds?: number[]
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const idW = Math.max(2, ...cards.map((c) => c.id.length))
  const rows = cards.map((c) => {
    const id = c.id.padEnd(idW)
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 18).padEnd(18)
    const left = c.daysLeft === null ? "—" : `${c.daysLeft}d`
    return `${id} ${title} ${company} ${loc} ${left}`
  })
  const header =
    "ID".padEnd(idW) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(22) + " " + "LOCATION".padEnd(18) + " DAYS LEFT"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const { html, status } = await htmlFetch(
      SEARCH_URL,
      buildSearchBody({ query: opts.query, cityIds: opts.cityIds, levelIds: opts.levelIds, page: opts.page }),
    )
    if (status === 404) {
      writeError("toptalent.co returned 404 for /Job/SearchJob - the site may have changed its search endpoint (see url-reference.md)", "SEARCH_FAILED")
      return 1
    }
    // No results is a whitespace-only fragment; a full HTML document instead of
    // card markup means the endpoint changed, which must not pass as "0 results".
    if (/<html\b/i.test(html) && !/class="position"/.test(html)) {
      writeError("Unexpected response from /Job/SearchJob (a full page, not result cards) - the site may have changed (see url-reference.md)", "UNEXPECTED_RESPONSE")
      return 1
    }
    const all = stripInvisible(parseJobCards(html))
    // The endpoint returns no total; a full page means there may be another.
    const hasMore = all.length >= PAGE_SIZE
    let cards = all
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
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.daysLeft === null ? "no deadline shown" : `${c.daysLeft} days left`}\n  id: ${c.id}\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page, hasMore }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
