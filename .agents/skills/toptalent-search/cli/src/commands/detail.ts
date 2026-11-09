import {
  BASE_URL,
  ROBOTS_DISALLOWED_SLUGS,
  htmlFetch,
  normalizeId,
  parseJobDetail,
  stripInvisible,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const TOPTALENT_HOST = /^(?:www\.)?toptalent\.co$/i

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a toptalent posting id from "${opts.id}" - pass the id from search results (e.g. "acme-ui-ux-designer-121900") or a toptalent.co posting URL`,
      "BAD_ID",
    )
    return 1
  }
  if (ROBOTS_DISALLOWED_SLUGS.has(id.toLowerCase())) {
    writeError(`toptalent.co's robots.txt disallows /${id}; the CLI does not fetch it`, "ROBOTS_DISALLOWED")
    return 1
  }
  try {
    const { html, finalUrl } = await htmlFetch(`${BASE_URL}/${id}`)
    let finalPath = ""
    let host = ""
    try {
      const u = new URL(finalUrl)
      host = u.hostname
      finalPath = decodeURIComponent(u.pathname).replace(/\/+$/, "")
    } catch {
      host = ""
    }
    // An expired posting redirects to a listing page or returns 404.
    if (!html || !TOPTALENT_HOST.test(host) || finalPath.toLowerCase() !== `/${id}`.toLowerCase()) {
      writeError("Posting not found (it may have expired and been removed)", "NOT_FOUND")
      return 1
    }
    const parsed = parseJobDetail(html, id, `${BASE_URL}/${id}`)
    if (!parsed) {
      writeError("The page is not a toptalent job posting", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.departments.length ? `Department: ${job.departments.join(", ")}` : null,
        job.eligibility.length ? `Who can apply: ${job.eligibility.join(", ")}` : null,
        job.employmentType ? `Employment: ${job.employmentType}` : null,
        job.date ? `Posted: ${job.date}` : null,
        job.daysLeft !== null ? `Days left to apply: ${job.daysLeft}` : null,
        job.layout === "campaign" ? "Layout: company program page" : null,
        "",
        job.description || "(no description)",
        "",
        `Apply (toptalent login required): ${job.url}`,
      ].filter((l): l is string => l !== null)
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
