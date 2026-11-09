import { DETAIL_URL, idFromPath, pageFetch, parseJobDetail, PortalError, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const KARIYER_HOST = /^(www\.)?kariyer\.net$/i

/**
 * Accept a raw job ID ("4520391"), a kariyer.net posting URL (with or without
 * scheme), or a bare slug ending in the ID ("acme-web-developer-4520391").
 *
 * A URL on any other host is rejected before any request: an apply link or a
 * company site pasted from a posting must not be reduced to a number and
 * fetched as an unrelated kariyer.net ad. Host and path go through real URL
 * parsing, so look-alike hosts (kariyer.net.evil.io) and userinfo tricks
 * (kariyer.net@evil.io) land on the reject side too.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{5,}$/.test(trimmed)) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!KARIYER_HOST.test(parsed.hostname) || parsed.username || parsed.password) return null
    return idFromPath(parsed.pathname)
  }

  // A scheme- and slash-free slug such as "acme-web-developer-4520391".
  const slug = trimmed.match(/^[a-z0-9-]*-(\d{5,})$/i)
  return slug ? slug[1] : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a kariyer.net job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // /is-ilani/<id> 301s to the posting's slug URL.
    const page = await pageFetch(`${DETAIL_URL}/${id}`)
    // An unknown or removed ID redirects to the /is-ilanlari list: only a
    // page that is still this posting's URL is parsed as the posting.
    const isPosting = page !== null && idFromPath(new URL(page.url).pathname) === id
    const parsed = isPosting ? parseJobDetail(page.html, id, page.url) : null
    if (!parsed) {
      writeError("Job not found (removed, expired, or not a posting page)", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const facts = [
        job.workModel ? `Work model: ${job.workModel}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.positionLevel ? `Level: ${job.positionLevel}` : "",
        job.experience ? `Experience: ${job.experience}` : "",
        job.department ? `Department: ${job.department}` : "",
        ...Object.entries(job.criteria).map(([k, v]) => `${k}: ${v}`),
        job.date ? `Published: ${job.date}` : "",
        job.deadline ? `Deadline: ${job.deadline}` : "",
        `Status: ${job.isActive === false ? "CLOSED / EXPIRED" : job.isActive ? "ACTIVE" : "UNKNOWN"}`,
      ].filter((l) => l !== "")
      const sections = [
        `${job.title}\n${job.company || "—"} · ${job.location || "—"}`,
        facts.join("\n"),
        job.description || "(no description)",
        `URL: ${job.url}`,
      ]
      process.stdout.write(sections.join("\n\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    if (e instanceof PortalError) {
      writeError(e.message, e.code)
      return 1
    }
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
