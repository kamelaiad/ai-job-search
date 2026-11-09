import {
  CliError,
  CookieJar,
  FIELD,
  PAGER_TARGET,
  SEARCH_TARGET,
  SEARCH_URL,
  formFields,
  htmlFetch,
  isSearchPage,
  jobageWindow,
  pageMessage,
  parseJobCards,
  parsePager,
  politePause,
  stripInvisible,
  writeError,
  type AgeWindow,
  type JobCard,
  type Sector,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  /** İŞKUR province code (plate code), already resolved by cli.ts. */
  provinceCode?: string
  provinceName?: string
  sector: Sector
  sectorValue: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export interface SearchMeta {
  count: number
  page: number
  totalPages: number
  total: number | null
  sector: Sector
  location: string | null
  jobageWindow: AgeWindow
}

function applyCriteria(fields: URLSearchParams, opts: SearchOpts, ageCode: string): void {
  fields.set("__EVENTARGUMENT", "")
  fields.set(FIELD.keyword, opts.query ?? "")
  fields.set(FIELD.sector, opts.sectorValue)
  fields.set(FIELD.province, opts.provinceCode ?? "")
  fields.set(FIELD.district, "")
  fields.set(FIELD.postedWithin, ageCode)
}

/** Fetch one page of results: GET the form, POST the search, and POST the pager for page > 1. */
export async function fetchResults(opts: SearchOpts): Promise<{ cards: JobCard[]; meta: SearchMeta }> {
  const jar = new CookieJar()
  const age = jobageWindow(opts.jobage)

  const formHtml = await htmlFetch(SEARCH_URL, { jar })
  if (!formHtml || !isSearchPage(formHtml)) {
    throw new CliError("İŞKUR search form not found - the page layout may have changed", "PORTAL_CHANGED")
  }
  const fields = formFields(formHtml)
  if (!fields.has("__VIEWSTATE")) {
    throw new CliError("İŞKUR search form carried no __VIEWSTATE - the page layout may have changed", "PORTAL_CHANGED")
  }
  applyCriteria(fields, opts, age.code)
  fields.set("__EVENTTARGET", SEARCH_TARGET)

  await politePause()
  let html = await htmlFetch(SEARCH_URL, { method: "POST", body: fields, jar, referer: SEARCH_URL })
  if (!html || !isSearchPage(html)) {
    throw new CliError("İŞKUR returned an unexpected page for the search (session or layout change)", "PORTAL_CHANGED")
  }

  let pager = parsePager(html)
  let cards = parseJobCards(html)
  const totalPages = pager?.totalPages ?? 1

  if (opts.page > 1) {
    if (!pager || opts.page > pager.totalPages) {
      cards = []
    } else {
      const next = formFields(html)
      applyCriteria(next, opts, age.code)
      next.set("__EVENTTARGET", PAGER_TARGET)
      next.set(FIELD.currentPage, String(opts.page))
      await politePause()
      html = await htmlFetch(SEARCH_URL, { method: "POST", body: next, jar, referer: SEARCH_URL })
      if (!html || !isSearchPage(html)) {
        throw new CliError(`İŞKUR returned an unexpected page for page ${opts.page}`, "PORTAL_CHANGED")
      }
      pager = parsePager(html)
      if (!pager || pager.currentPage !== opts.page) {
        throw new CliError(`İŞKUR did not move to page ${opts.page}`, "PAGE_FAILED")
      }
      cards = parseJobCards(html)
    }
  }

  if (cards.length === 0 && opts.page === 1) {
    // No grid at all: surface the portal's own notice (validation errors and
    // the like) rather than reporting a silent empty search.
    const message = pageMessage(html)
    const noResults = message && /bulunamad|kay[ıi]t yok|sonu[çc] yok/i.test(message)
    if (message && !noResults) throw new CliError(`İŞKUR: ${message}`, "PORTAL_MESSAGE")
  }

  return {
    cards,
    meta: {
      count: cards.length,
      page: opts.page,
      totalPages,
      total: pager?.total ?? (opts.page === 1 ? cards.length : null),
      sector: opts.sector,
      location: opts.provinceName ?? null,
      jobageWindow: age.window,
    },
  }
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 36).padEnd(36)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 28).padEnd(28)
    const deadline = c.deadline || "—"
    return `${c.id.padEnd(11)} ${title} ${company} ${loc} ${deadline}`
  })
  const header =
    "ID".padEnd(11) +
    " " +
    "TITLE".padEnd(36) +
    " " +
    "COMPANY".padEnd(24) +
    " " +
    "LOCATION".padEnd(28) +
    " DEADLINE"
  return [header, "-".repeat(header.length + 2), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const { cards: raw, meta } = await fetchResults(opts)
    let cards = stripInvisible(raw)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)
    meta.count = cards.length

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (cards.length === 0
          ? "No results."
          : cards
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || (c.employerHidden ? "(employer hidden)" : "—")} · ${c.location || "—"} · deadline ${c.deadline || "—"}\n  ${[c.sector, c.contractType, c.employmentType].filter(Boolean).join(" / ")}${c.openings ? ` · ${c.openings} opening(s)` : ""}\n  id: ${c.id}\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify({ meta, results: cards }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    const code = e instanceof CliError ? e.code : "SEARCH_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
