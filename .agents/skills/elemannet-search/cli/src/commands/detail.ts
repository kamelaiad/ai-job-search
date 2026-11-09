import {
  BASE_URL,
  RobotsDisallowedError,
  htmlFetch,
  parseJobDetail,
  postingRef,
  stripInvisible,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Accept a posting number ("4802848", optionally "i4802848"), a posting slug
 * ("grafik-tasarim-uzmani-i4802848") or a full eleman.net posting URL (with or
 * without scheme). Any other host is rejected via real URL parsing, so
 * look-alike hosts (eleman.net.evil.io) and userinfo tricks fall on the
 * reject side. A bare number is fetched as /is-ilani/ilan-i<n>, which
 * eleman.net 301-redirects to the posting's canonical URL.
 */
export function normalizeId(input: string): { id: string; url: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const num = trimmed.match(/^i?(\d{4,})$/i)
  if (num) return { id: num[1], url: `${BASE_URL}/is-ilani/ilan-i${num[1]}` }
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^(?:www\.)?eleman\.net\//i.test(trimmed)) {
    return postingRef(hasScheme ? trimmed : `https://${trimmed}`)
  }
  if (/^[a-z0-9-]*-i\d+$/i.test(trimmed)) return postingRef(`${BASE_URL}/is-ilani/${trimmed.toLowerCase()}`)
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = normalizeId(opts.id)
  if (!ref) {
    writeError(`Could not parse an eleman.net posting from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(ref.url)
    if (!html) {
      writeError("Job not found (eleman.net returned 404; the posting may have been removed)", "NOT_FOUND")
      return 1
    }
    // The canonical link names the posting's real URL (a bare number was fetched via a redirect).
    const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1]
    const canonicalRef = canonical ? postingRef(canonical) : null
    if (canonicalRef && canonicalRef.id !== ref.id) {
      writeError(`eleman.net served posting ${canonicalRef.id} for ${ref.id}; the posting may have been removed`, "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parseJobDetail(html, ref.id, canonicalRef?.url ?? ref.url))

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.date ? `Posted: ${job.date}` : "",
        job.deadline ? `Deadline: ${job.deadline}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.education ? `Education: ${job.education}` : "",
        job.experience ? `Experience: ${job.experience}` : "",
        job.benefits ? `Benefits: ${job.benefits}` : "",
        job.criteria.length ? `Requirements: ${job.criteria.join(" · ")}` : "",
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
