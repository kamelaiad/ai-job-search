import {
  BASE_URL,
  DETAIL_PATH,
  CliError,
  htmlFetch,
  parseDetailPage,
  stripInvisible,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const HOST = /^(www\.)?elemanonline\.com\.tr$/i
const ID = /^[a-f0-9]{24}$/i

/**
 * Accept a raw 24-hex job id, an elemanonline.com.tr job URL
 * (/is-ilani/<slug>/<id>, with or without scheme), or that path alone.
 * A URL on any other host is rejected, read through real URL parsing so
 * look-alike hosts and userinfo tricks fall on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (ID.test(trimmed)) return trimmed.toLowerCase()

  const pathId = (path: string) => {
    const m = path.match(/^\/(?:is-ilani\/)?[a-z0-9-]+\/([a-f0-9]{24})\/?$/i)
    return m ? m[1].toLowerCase() : null
  }
  if (trimmed.startsWith("/")) return pathId(trimmed)

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!HOST.test(parsed.hostname) || parsed.username || parsed.password) return null
    return pathId(parsed.pathname)
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse an elemanonline job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // Any slug resolves; "ilan" keeps the request independent of the title.
    const html = await htmlFetch(`${BASE_URL}${DETAIL_PATH}/ilan/${id}`, { redirectIsNotFound: true })
    const parsed = html ? parseDetailPage(html, id) : null
    if (!parsed) {
      writeError("Job not found (unknown id or the posting was removed)", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.workType ? `Çalışma şekli: ${job.workType}` : "",
        job.workPreference ? `Çalışma tercihi: ${job.workPreference}` : "",
        job.department ? `Departman: ${job.department}` : "",
        job.salary ? `Maaş: ${job.salary}` : "",
        job.gender ? `Cinsiyet: ${job.gender}` : "",
        job.ageRange ? `Yaş: ${job.ageRange}` : "",
        job.date ? `Yayın tarihi: ${job.date}` : "",
        job.status ? `Status: ${job.status}` : "",
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
