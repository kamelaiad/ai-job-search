import {
  API_BASE,
  PER_PAGE,
  CliError,
  jsonFetch,
  parseSearchResponse,
  stripInvisible,
  turkishSlug,
  withinDays,
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
 * GET /api/agent/jobs?q=&city=&page=&per_page=25. The keyword parameter is
 * `q`: robots.txt disallows any URL with `query=`, so that name is never sent.
 * The API has no posting-age parameter; --jobage is applied client-side.
 */
export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("q", opts.query)
  if (opts.location) params.set("city", turkishSlug(opts.location))
  params.set("page", String(opts.page))
  params.set("per_page", String(PER_PAGE))
  return `${API_BASE}/jobs?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 38).padEnd(38)
    const company = (c.company || "—").slice(0, 28).padEnd(28)
    const loc = (c.location || "—").slice(0, 26).padEnd(26)
    const date = c.date ? c.date.slice(0, 10) : "—"
    return `${c.id.padEnd(36)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(36) + " " + "TITLE".padEnd(38) + " " + "COMPANY".padEnd(28) + " " + "LOCATION".padEnd(26) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const json = await jsonFetch(buildUrl(opts))
    if (json === null) {
      writeError("search endpoint not found (404) - the API changed (see url-reference.md)", "NOT_FOUND")
      return 1
    }
    const page = parseSearchResponse(json)
    let cards = stripInvisible(page.cards)
    if (opts.jobage !== undefined) cards = withinDays(cards, opts.jobage)
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
            // total/lastPage are the API's figures for the query, before the
            // client-side --jobage filter and --limit cap.
            meta: { count: cards.length, page: opts.page, total: page.total, lastPage: page.lastPage },
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
