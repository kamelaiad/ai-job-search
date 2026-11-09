import { BASE_URL, htmlFetch, normalizeId, parseJobDetail, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const YOUTHALL_HOST = /^(?:www\.)?youthall\.com$/i

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a Youthall posting id from "${opts.id}" - pass the id from search results (e.g. "AcmeTR/ui-ux-tasarim-stajyeri_12") or a youthall.com posting URL`,
      "BAD_ID",
    )
    return 1
  }
  try {
    // /tr/ redirects to /en/ for English-language postings; follow it.
    const { html, finalUrl } = await htmlFetch(`${BASE_URL}/tr/${id}/`)
    let host = ""
    try {
      host = new URL(finalUrl).hostname
    } catch {
      host = ""
    }
    if (!html || !YOUTHALL_HOST.test(host)) {
      writeError("Posting not found (it may have expired and been removed)", "NOT_FOUND")
      return 1
    }
    const parsed = parseJobDetail(html, id, finalUrl)
    if (!parsed) {
      writeError("The page is not a Youthall job posting (it may have expired and been removed)", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.type ? `Type: ${job.type}` : null,
        job.employmentType ? `Employment: ${job.employmentType}` : null,
        job.department ? `Department: ${job.department}` : null,
        job.salary ? `Salary: ${job.salary}` : null,
        job.date ? `Posted: ${job.date}` : null,
        job.deadline ? `Deadline: ${job.deadline}` : null,
        `Status: ${job.isActive === null ? "UNKNOWN" : job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        job.description || "(no description)",
        "",
        job.hiringProcess.length ? `Hiring process: ${job.hiringProcess.join(" → ")}` : null,
        job.applyUrl ? `Apply (Youthall login required): ${job.applyUrl}` : null,
        `URL: ${job.url}`,
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
