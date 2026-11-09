import {
  API_URL,
  CONTRACT_CODES,
  CliError,
  FRAGMENT_SIZE,
  HOURS_CODES,
  LOCALE,
  PAGE_SIZE,
  UA,
  apiFetch,
  missingTokenMessage,
  parseSearchResponse,
  readToken,
  saveToCache,
  stripInvisible,
  toResult,
  withinDays,
  writeError,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage?: number
  page: number
  limit?: number
  contract?: string // key of CONTRACT_CODES
  hours?: string // key of HOURS_CODES
  sort?: string // relevance | date | salary
  format: "json" | "table" | "plain"
}

/**
 * The API requires the end user's IP. For a CLI the end user is whoever runs
 * it; CAREERJET_USER_IP lets them state their public IP, otherwise the
 * loopback address is sent (the CLI makes no extra call to discover it).
 */
function userIp(): string {
  return process.env.CAREERJET_USER_IP?.trim() || "127.0.0.1"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  params.set("locale_code", LOCALE)
  if (opts.query) params.set("keywords", opts.query)
  if (opts.location) params.set("location", opts.location)
  if (opts.contract) params.set("contract_type", CONTRACT_CODES[opts.contract])
  if (opts.hours) params.set("work_hours", HOURS_CODES[opts.hours])
  // The API has no posted-within filter: --jobage filters client-side, and
  // sorting by date (unless the user chose a sort) puts the recent jobs on
  // the page being filtered.
  const sort = opts.sort ?? (opts.jobage !== undefined ? "date" : undefined)
  if (sort) params.set("sort", sort)
  params.set("page", String(opts.page))
  params.set("page_size", String(PAGE_SIZE))
  params.set("fragment_size", String(FRAGMENT_SIZE))
  params.set("user_ip", userIp())
  params.set("user_agent", UA)
  return `${API_URL}?${params.toString()}`
}

function renderTable(results: JobResult[]): string {
  if (results.length === 0) return "No results."
  const rows = results.map((c) => {
    const title = c.title.slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = c.date || "—"
    return `${c.id.padEnd(19)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(19) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(22) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(results: JobResult[]): string {
  if (results.length === 0) return "No results."
  return results
    .map((c) => {
      const lines = [
        c.title,
        `  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}`,
        c.salary ? `  Maaş / salary: ${c.salary}` : "",
        `  id: ${c.id}`,
        `  ${c.url}`,
      ]
      return lines.filter((l) => l !== "").join("\n")
    })
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const token = readToken()
  if (!token) {
    writeError(missingTokenMessage(), "MISSING_CREDENTIALS")
    return 1
  }
  try {
    const json = await apiFetch(buildUrl(opts), token)
    if (json === null) {
      writeError("Careerjet API endpoint not found (404) - the v4 API may have moved; see url-reference.md", "NOT_FOUND")
      return 1
    }
    const parsed = parseSearchResponse(json)
    if (parsed.kind === "locations") {
      const choices = parsed.locations.length ? ` Candidates: ${parsed.locations.join(" | ")}` : ""
      const code = parsed.locations.length ? "AMBIGUOUS_LOCATION" : "LOCATION_NOT_FOUND"
      writeError(
        stripInvisible(`Careerjet could not resolve --location "${opts.location ?? ""}": ${parsed.message}.${choices}`),
        code,
      )
      return 1
    }

    const records = stripInvisible(parsed.jobs)
    saveToCache(records)

    let results = records.map(toResult)
    if (opts.jobage !== undefined) results = results.filter((r) => withinDays(r.date, opts.jobage!))
    if (opts.limit !== undefined) results = results.slice(0, opts.limit)
    results = stripInvisible(results)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(results) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: results.length,
              page: opts.page,
              totalHits: parsed.hits,
              totalPages: parsed.pages,
              source: "careerjet-api-v4",
              locale: LOCALE,
            },
            results,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    if (e instanceof CliError) writeError(e.message, e.code)
    else writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
