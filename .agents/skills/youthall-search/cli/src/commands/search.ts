import {
  SEARCH_URL,
  citySlug,
  hasNextPage,
  htmlFetch,
  parseJobCards,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  types?: string[]
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  // A city is a path facet (/tr/is-ilanlari/<city>/); everything else is a query param.
  const base = opts.location ? `${SEARCH_URL}${citySlug(opts.location)}/` : SEARCH_URL
  const params = new URLSearchParams()
  if (opts.query) params.set("query", opts.query)
  for (const t of opts.types ?? []) params.append("type[]", t)
  if (opts.page > 1) params.set("page", String(opts.page))
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const idW = Math.max(2, ...cards.map((c) => c.id.length))
  const rows = cards.map((c) => {
    const id = c.id.slice(0, idW).padEnd(idW)
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = ((c.location || "—") + (c.multipleLocations ? " +" : "")).slice(0, 16).padEnd(16)
    const type = (c.type || "—").slice(0, 14).padEnd(14)
    const deadline = c.deadline || "—"
    return `${id} ${title} ${company} ${loc} ${type} ${deadline}`
  })
  const header =
    "ID".padEnd(idW) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(22) + " " +
    "LOCATION".padEnd(16) + " " + "TYPE".padEnd(14) + " DEADLINE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const { html } = await htmlFetch(buildUrl(opts))
    if (!html) {
      if (opts.location) {
        writeError(
          `Youthall has no city page for "${opts.location}" (looked for /tr/is-ilanlari/${citySlug(opts.location)}/). Use a Turkish city name such as "İstanbul", "Ankara", "İzmir" or "Bursa".`,
          "UNKNOWN_LOCATION",
        )
      } else {
        writeError("Youthall returned 404 for the listing page", "SEARCH_FAILED")
      }
      return 1
    }
    const hasMore = hasNextPage(html)
    let cards = stripInvisible(parseJobCards(html))
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
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"}${c.multipleLocations ? " (+ more)" : ""} · ${c.type || "—"} · deadline ${c.deadline || "—"}\n  id: ${c.id}\n  ${c.url}`,
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
