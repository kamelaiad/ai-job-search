import {
  SEARCH_URL,
  ageDays,
  hasNextPage,
  jobageToParam,
  pageFetch,
  parseJobCards,
  PortalError,
  stripInvisible,
  workModelParam,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  /** Resolved `ct` value (comma-separated kariyer.net city IDs). */
  cityIds?: string
  jobage?: number
  remote?: string // "remote" | "hybrid" | "onsite"
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("kw", opts.query)
  if (opts.cityIds) params.set("ct", opts.cityIds)
  const date = opts.jobage !== undefined ? jobageToParam(opts.jobage) : null
  if (date) params.set("date", date)
  const wm = workModelParam(opts.remote)
  if (wm !== null) params.set("wm", wm)
  if (opts.page > 1) params.set("cp", String(opts.page))
  return `${SEARCH_URL}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = ((c.sponsored ? "[S] " : "") + (c.title || "")).slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 28).padEnd(28)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = c.date ? `${c.date} (${c.age})` : c.age || "—"
    return `${c.id.padEnd(8)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(8) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(28) + " " + "LOCATION".padEnd(22) + " DATE"
  const note = cards.some((c) => c.sponsored) ? ["", "[S] = sponsored (Sponsorlu İlan); repeats on every page"] : []
  return [header, "-".repeat(header.length + 12), ...rows, ...note].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const page = await pageFetch(buildUrl(opts))
    const html = page ? page.html : ""
    let cards = stripInvisible(parseJobCards(html))
    // The portal's date windows are fixed (today/3/7/15 days); cut to the
    // exact --jobage here. Cards whose age label cannot be read are kept.
    if (opts.jobage !== undefined) {
      const max = opts.jobage
      cards = cards.filter((c) => {
        const d = ageDays(c.age)
        return d === null || d <= max
      })
    }
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.sponsored ? "[Sponsorlu] " : ""}${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.workModel || "—"} · ${c.date || "—"} (${c.age || "—"})\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: cards.length, page: opts.page, hasMore: hasNextPage(html, opts.page) }, results: cards },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    if (e instanceof PortalError) {
      writeError(e.message, e.code)
      return 1
    }
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
