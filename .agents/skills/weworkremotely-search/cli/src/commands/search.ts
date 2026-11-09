import {
  ALL_FEED_URL,
  SOURCE,
  BASE_URL,
  categoryFeedUrl,
  fetchText,
  locationTerms,
  matchesAllTerms,
  matchesLocation,
  parseFeed,
  queryTerms,
  searchableText,
  stripInvisible,
  toResult,
  withinJobage,
  writeError,
  type FeedJob,
  type JobResult,
} from "../helpers.js"

export const DEFAULT_PAGE_SIZE = 20

export interface SearchOpts {
  query?: string
  categories: string[] // aliases from CATEGORIES; empty = the all-jobs feed
  location?: string
  titleOnly: boolean
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function feedUrls(categories: string[]): string[] {
  return categories.length ? categories.map(categoryFeedUrl) : [ALL_FEED_URL]
}

/** Fetch the feeds (one request each, spaced), merge, de-duplicate, newest first. */
export async function loadJobs(urls: string[]): Promise<FeedJob[]> {
  const byId = new Map<string, FeedJob>()
  for (const url of urls) {
    const xml = await fetchText(url)
    if (xml === null) throw new Error(`feed not found (404): ${url}`)
    for (const job of parseFeed(xml)) if (!byId.has(job.id)) byId.set(job.id, job)
  }
  return [...byId.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const idWidth = Math.max(4, ...rows.map((r) => r.id.length))
  const header =
    "SLUG".padEnd(idWidth) + "  " + "TITLE".padEnd(36) + "  " + "COMPANY".padEnd(22) + "  " + "REGION".padEnd(22) + "  DATE"
  const body = rows.map((r) =>
    [
      r.id.padEnd(idWidth),
      r.title.slice(0, 36).padEnd(36),
      (r.company ?? "—").slice(0, 22).padEnd(22),
      (r.location ?? "—").slice(0, 22).padEnd(22),
      (r.date ?? "—").slice(0, 10),
    ].join("  "),
  )
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${(r.date ?? "—").slice(0, 10)}`,
        `  ${[r.category, r.employmentType].filter(Boolean).join(" · ") || "—"}`,
        `  id: ${r.id}`,
        `  ${r.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

const FOOTER = `Source: ${SOURCE} (${BASE_URL})`

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const terms = queryTerms(opts.query)
    const locTerms = locationTerms(opts.location)
    const matched = (await loadJobs(feedUrls(opts.categories)))
      .filter((job) => matchesAllTerms(searchableText(job, opts.titleOnly), terms))
      .filter((job) => matchesLocation(job.location, locTerms))
      .filter((job) => withinJobage(job.date, opts.jobage))

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
              feeds: feedUrls(opts.categories),
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
