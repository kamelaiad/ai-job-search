import {
  API_URL,
  ATTRIBUTION,
  SOURCE,
  SOURCE_URL,
  fetchText,
  locationTerms,
  matchesAllTerms,
  matchesLocation,
  parseApiFeed,
  queryTerms,
  salaryText,
  searchableText,
  stripInvisible,
  toResult,
  withinJobage,
  writeError,
  type JobResult,
} from "../helpers.js"

export const DEFAULT_PAGE_SIZE = 20

export interface SearchOpts {
  query?: string
  tag?: string
  location?: string
  titleOnly: boolean
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** Remote OK tags use spaces ("web dev"); the API accepts them hyphenated too. */
export function tagParam(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-")
}

export function buildUrl(opts: Pick<SearchOpts, "tag">): string {
  return opts.tag ? `${API_URL}?tag=${encodeURIComponent(tagParam(opts.tag))}` : API_URL
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const header =
    "ID".padEnd(8) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(20) + " " + "DATE".padEnd(10) + " SALARY"
  const body = rows.map((r) =>
    [
      r.id.padEnd(8),
      r.title.slice(0, 40).padEnd(40),
      (r.company ?? "—").slice(0, 24).padEnd(24),
      (r.location ?? "—").slice(0, 20).padEnd(20),
      (r.date ?? "—").slice(0, 10).padEnd(10),
      salaryText(r.salaryMin, r.salaryMax),
    ].join(" "),
  )
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${(r.date ?? "—").slice(0, 10)} · ${salaryText(r.salaryMin, r.salaryMax)}`,
        `  id: ${r.id}`,
        r.tags.length ? `  tags: ${r.tags.join(", ")}` : "",
        `  ${r.url}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
}

const FOOTER = `Source: ${SOURCE} (${SOURCE_URL}) - link to each job's Remote OK URL when sharing it.`

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const fetched = await fetchText(buildUrl(opts), "application/json")
    if (!fetched) {
      writeError("Remote OK API returned 404", "NOT_FOUND")
      return 1
    }
    const terms = queryTerms(opts.query)
    const locTerms = locationTerms(opts.location)
    const matched = parseApiFeed(fetched.body)
      .filter((job) => matchesAllTerms(searchableText(job, opts.titleOnly), terms))
      .filter((job) => matchesLocation(job.location, locTerms))
      .filter((job) => withinJobage(job, opts.jobage))
      .sort((a, b) => (b.epoch ?? 0) - (a.epoch ?? 0))

    const pageSize = opts.limit ?? DEFAULT_PAGE_SIZE
    const start = (opts.page - 1) * pageSize
    const rows = stripInvisible(matched.slice(start, start + pageSize).map(toResult))

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n\n" + FOOTER + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n\n" + FOOTER + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: rows.length,
              page: opts.page,
              total: matched.length,
              source: SOURCE,
              sourceUrl: SOURCE_URL,
              attribution: ATTRIBUTION,
            },
            results: rows,
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
