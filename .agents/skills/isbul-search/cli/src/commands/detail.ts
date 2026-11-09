import {
  API_BASE,
  ID_OR_SLUG,
  CliError,
  jsonFetch,
  parseDetailResponse,
  stripInvisible,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const HOST = /^(www\.)?isbul\.net$/i

/**
 * Accept a listing id (UUID) or slug as returned by `search`, or an isbul.net
 * job URL (https://www.isbul.net/is-ilani/<slug>, with or without scheme).
 * A URL on any other host is rejected, read through real URL parsing so
 * look-alike hosts and userinfo tricks fall on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!HOST.test(parsed.hostname) || parsed.username || parsed.password) return null
    const m = parsed.pathname.match(/^\/is-ilani\/([^/]+)\/?$/)
    return m && ID_OR_SLUG.test(m[1]) ? m[1] : null
  }
  const path = trimmed.match(/^\/is-ilani\/([^/]+)\/?$/)
  const candidate = path ? path[1] : trimmed
  return ID_OR_SLUG.test(candidate) ? candidate : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse an isbul.net listing id or slug from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const json = await jsonFetch(`${API_BASE}/jobs/${encodeURIComponent(id)}`)
    const parsed = json === null ? null : parseDetailResponse(json)
    if (!parsed) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const status =
        job.isOpen === null ? (job.status ? `Status: ${job.status}` : "")
          : `Status: ${job.isOpen ? "OPEN" : "CLOSED"}${job.status ? ` (${job.status})` : ""}`
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.workType ? `Çalışma şekli: ${job.workType}` : "",
        job.position ? `Pozisyon: ${job.position}` : "",
        job.sector ? `Sektör: ${job.sector}` : "",
        job.experienceLevel ? `Tecrübe: ${job.experienceLevel}` : "",
        job.educationLevel ? `Eğitim: ${job.educationLevel}` : "",
        job.vacancyCount !== null ? `Kişi sayısı: ${job.vacancyCount}` : "",
        job.salary ? `Maaş: ${job.salary}` : "",
        job.date ? `Yayın tarihi: ${job.date}` : "",
        job.expiresAt ? `Son tarih: ${job.expiresAt}` : "",
        status,
      ].filter((l) => l !== "")
      process.stdout.write(
        [...lines, "", job.description || "(no description)", "", `URL: ${job.url}`].join("\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof CliError ? e.code : "DETAIL_FAILED")
    return 1
  }
}
