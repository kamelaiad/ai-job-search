import { DETAIL_URL, htmlFetch, parseJobDetail, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const DRIBBBLE_HOST = /^(www\.)?dribbble\.com$/i

/**
 * Accept a numeric job ID ("311562"), an ID-slug ("311562-Staff-Product-Designer"),
 * or a dribbble.com job URL (with or without scheme, query string, or a trailing
 * /apply_now). Only the posting page /jobs/<id> is ever fetched - an apply_now
 * path is reduced to its ID because robots.txt disallows it.
 *
 * URLs on any other host are rejected: host and path are read through real URL
 * parsing, so look-alike hosts (dribbble.com.evil.io) and userinfo tricks
 * (dribbble.com@evil.io) fall on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{3,}$/.test(trimmed)) return trimmed
  const slug = trimmed.match(/^(\d{3,})-[A-Za-z0-9-]+$/)
  if (slug) return slug[1]

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!DRIBBBLE_HOST.test(parsed.hostname) || parsed.username || parsed.password) return null
    const path = parsed.pathname.match(/^\/jobs\/(\d{3,})(?:-[A-Za-z0-9-]*)?(?:\/apply_now)?\/?$/)
    return path ? path[1] : null
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a Dribbble job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(`${DETAIL_URL}/${id}`)
    const parsed = html ? parseJobDetail(html, id) : null
    if (!parsed) {
      writeError(`Job ${id} not found (unknown ID or the listing was removed)`, "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}${job.remote ? " · remote" : ""}`,
        "",
        job.employmentType ? `Job type: ${job.employmentType}` : "",
        job.workplace ? `Workplace: ${job.workplace}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.validThrough ? `Valid through: ${job.validThrough}` : "",
        `Status: ${job.isActive ? "ACTIVE" : "EXPIRED"}`,
        job.companyWebsite ? `Company website: ${job.companyWebsite}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        job.applyUrl ? `Apply (sign-in required, open in a browser): ${job.applyUrl}` : "",
      ].filter((l, i, all) => l !== "" || (all[i - 1] !== "" && i > 0))
      process.stdout.write(lines.join("\n").trim() + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
