import { cachePath, findInCache, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Careerjet's API has no single-posting endpoint, and careerjet.com.tr's own
 * job pages (/job/, /jobview/, /clk/ ...) are disallowed by its robots.txt. So
 * `detail` makes NO network request: it returns the longer excerpt and fields
 * that the last `search` calls stored in the local cache, plus the outbound URL.
 * It never fetches the URL either - that is a Careerjet click-tracking link
 * (counted per click) meant to be opened by a person who wants to apply.
 */
export function normalizeKey(input: string): { id?: string; url?: string } | null {
  const trimmed = input.trim()
  if (/^cj-[0-9a-f]{16}$/i.test(trimmed)) return { id: trimmed.toLowerCase() }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return { url: new URL(trimmed).toString() }
    } catch {
      return null
    }
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const key = normalizeKey(opts.id)
  if (!key) {
    writeError(
      `Could not parse a Careerjet job id from "${opts.id}" - pass an id from search results (cj-<16 hex chars>) or the result's url`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const entry = findInCache(key)
    if (!entry) {
      writeError(
        `Job ${key.id ?? key.url} is not in the local search cache (${cachePath()}). Run search first: ` +
          "Careerjet's API has no single-posting endpoint and careerjet.com.tr's job pages are disallowed by robots.txt, " +
          "so detail returns what search stored (kept 14 days).",
        "NOT_FOUND",
      )
      return 1
    }
    const job = stripInvisible({
      id: entry.job.id,
      title: entry.job.title,
      company: entry.job.company ?? null,
      location: entry.job.location ?? null,
      date: entry.job.date ?? null,
      url: entry.job.url,
      description: entry.job.description ?? null,
      descriptionIsExcerpt: true,
      salary: entry.job.salary ?? null,
      salaryMin: entry.job.salaryMin ?? null,
      salaryMax: entry.job.salaryMax ?? null,
      salaryCurrency: entry.job.salaryCurrency ?? null,
      salaryPeriod: entry.job.salaryPeriod ?? null,
      employmentType: null,
      deadline: null,
      source: "careerjet-api-v4 (cached search excerpt)",
      fetchedAt: new Date(entry.savedAt).toISOString(),
    })

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"} · ${job.date || "—"}`,
        "",
        job.salary ? `Salary: ${job.salary}${job.salaryPeriod ? ` (${job.salaryPeriod})` : ""}` : "",
        "",
        job.description || "(no description)",
        "",
        "(Excerpt from Careerjet's search API - the full posting is on the employer's or source site.)",
        `URL: ${job.url}`,
      ]
      const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
      process.stdout.write(text + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
