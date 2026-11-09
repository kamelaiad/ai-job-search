import { DETAIL_URL, SLUG_RE, htmlFetch, parseJobDetail, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const TECHCAREER_HOST = /^(?:www\.)?techcareer\.net$/i

/**
 * Accept a job slug from `search` ("back-end-developer-4491449") or a
 * Techcareer job-detail URL (with or without scheme, Turkish or /en/ path).
 *
 * A URL on any other host is rejected rather than mined for a slug, so an
 * employer's external apply link cannot be mistaken for a Techcareer posting.
 * Host and path are read through real URL parsing, so look-alike hosts
 * (techcareer.net.evil.io) and userinfo tricks (techcareer.net@evil.io) fall
 * on the reject side too.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (SLUG_RE.test(trimmed)) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!TECHCAREER_HOST.test(parsed.hostname) || parsed.username || parsed.password) return null
    const path = parsed.pathname.match(/^(?:\/en)?\/jobs\/detail\/([^/]+)\/?$/)
    if (!path) return null
    let slug: string
    try {
      slug = decodeURIComponent(path[1])
    } catch {
      return null
    }
    return SLUG_RE.test(slug) ? slug : null
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const slug = normalizeId(opts.id)
  if (!slug) {
    writeError(
      `Could not parse a Techcareer job slug from "${opts.id}" - pass the id from search results (e.g. "back-end-developer-4491449") or a techcareer.net/jobs/detail/... URL`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const html = await htmlFetch(`${DETAIL_URL}/${encodeURIComponent(slug)}`)
    const parsed = html ? parseJobDetail(html, slug) : null
    if (!parsed) {
      writeError(`Job not found (expired or unknown slug "${slug}")`, "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const where = [job.location, ...job.otherLocations].filter(Boolean).join(" | ")
      const optional = (label: string, value: string | null | undefined): string | null =>
        value ? `${label}: ${value}` : null
      const lines: Array<string | null> = [
        job.title,
        `${job.company || "—"} · ${where || "—"}`,
        "",
        optional("Workplace", job.workplace),
        optional("Employment", job.employmentType),
        optional("Experience", job.experience),
        optional("Level", job.positionLevel),
        optional("Position", job.position),
        optional("Skills", job.skills.join(", ")),
        optional("Languages", job.languages.join(", ")),
        optional("Published", job.date),
        optional("Deadline", job.deadline),
        `Status: ${job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        job.description || "(no description)",
        "",
        optional("Apply", job.applyUrl),
        `URL: ${job.url}`,
      ]
      process.stdout.write(lines.filter((l) => l !== null).join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
