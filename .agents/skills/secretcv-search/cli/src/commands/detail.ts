import {
  BASE_URL,
  RobotsDisallowedError,
  htmlFetch,
  parseJobDetail,
  postingKey,
  stripInvisible,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Accept the `id` from search results ("<company-slug>/<job-slug>-is-ilanlari-<n>"),
 * the same path with a leading slash, or a full secretcv.com posting URL (with or
 * without scheme). Any other host is rejected via real URL parsing, so
 * look-alike hosts (secretcv.com.evil.io) and userinfo tricks fall on the
 * reject side. A bare number cannot be resolved: secretcv's posting URLs need
 * the company slug, and its by-ID lookup (?ilanId=) is disallowed by robots.txt.
 */
export function normalizeId(input: string): { id: string; jobId: string; url: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^(?:www\.)?secretcv\.com\//i.test(trimmed)) {
    return postingKey(hasScheme ? trimmed : `https://${trimmed}`)
  }
  if (/^\/?[a-z0-9-]+\/[a-z0-9-]+-is-ilanlari-\d+\/?$/i.test(trimmed)) {
    return postingKey(`${BASE_URL}/${trimmed.replace(/^\//, "").toLowerCase()}`)
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const key = normalizeId(opts.id)
  if (!key) {
    const hint = /^\d+$/.test(opts.id.trim())
      ? " - a bare posting number cannot be resolved; pass the `id` or `url` field from search results"
      : ""
    writeError(`Could not parse a secretcv posting from "${opts.id}"${hint}`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(key.url)
    if (!html) {
      writeError("Job not found (secretcv returned 404; the posting may have been removed)", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parseJobDetail(html, key))

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.date ? `Posted: ${job.date}` : "",
        job.deadline ? `Deadline: ${job.deadline}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.sector ? `Sector: ${job.sector}` : "",
        job.education ? `Education: ${job.education}` : "",
        job.openings ? `Openings: ${job.openings}` : "",
        job.districts ? `Districts: ${job.districts}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    if (e instanceof RobotsDisallowedError) writeError(e.message, "ROBOTS_DISALLOWED")
    else writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
