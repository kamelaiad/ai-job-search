import {
  SEARCH_URL,
  ageDaysFromPosted,
  htmlFetch,
  jobTypeParam,
  parseJobCards,
  specialtyIds,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  remote?: boolean
  specialty?: string // comma-separated names, see SPECIALTIES
  type?: string // "fulltime" | "freelance"
  jobage?: number // days; filtered client-side (Dribbble has no posting-age parameter)
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("keyword", opts.query)
  if (opts.location) params.set("location", opts.location)
  // "Open to remote" checkbox. On the live board it returns remote-only and
  // remote-friendly postings and drops on-site ones even when a location is set.
  if (opts.remote) params.set("anywhere", "true")
  for (const id of opts.specialty ? specialtyIds(opts.specialty) ?? [] : []) {
    params.append("specialty_ids[]", id)
  }
  const type = opts.type ? jobTypeParam(opts.type) : null
  if (type) params.set(type, "true")
  if (opts.page > 1) params.set("page", String(opts.page))
  const qs = params.toString()
  return qs ? `${SEARCH_URL}?${qs}` : SEARCH_URL
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(7) +
    " " +
    "TITLE".padEnd(40) +
    " " +
    "COMPANY".padEnd(22) +
    " " +
    "LOCATION".padEnd(26) +
    " " +
    "REMOTE".padEnd(6) +
    " POSTED"
  const rows = cards.map((c) => {
    const title = (c.title + (c.featured ? " *" : "")).slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const loc = (c.location || "—").slice(0, 26).padEnd(26)
    const remote = (c.remote ? "yes" : "no").padEnd(6)
    return `${c.id.padEnd(7)} ${title} ${company} ${loc} ${remote} ${c.posted || "—"}`
  })
  const lines = [header, "-".repeat(header.length), ...rows]
  if (cards.some((c) => c.featured)) lines.push("", "* featured (paid) listing")
  return lines.join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    let cards = stripInvisible(parseJobCards(html))
    if (opts.jobage !== undefined) {
      const maxAge = opts.jobage
      // A card whose age cannot be read cannot be shown to satisfy the window.
      cards = cards.filter((c) => {
        const age = ageDaysFromPosted(c.posted)
        return age !== null && age <= maxAge
      })
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
                  `${c.title}${c.featured ? " (featured)" : ""}\n  ${c.company || "—"} · ${c.location || "—"}${c.remote ? " · remote" : ""} · ${c.posted || "—"}\n  id: ${c.id}\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
