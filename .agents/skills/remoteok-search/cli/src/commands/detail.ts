import {
  API_URL,
  JOB_URL,
  SOURCE,
  SOURCE_URL,
  detailFromApi,
  fetchText,
  normalizeId,
  parseApiFeed,
  parseJobPage,
  salaryText,
  stripInvisible,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * The API feed first: it carries the full HTML description with paragraphs and
 * lists intact, and covers every job a fresh default search returns. A job that
 * has aged out of the feed (or came from a `--tag` search) falls back to its
 * public job page, whose description Remote OK serves with the paragraph
 * markup already flattened.
 */
async function lookup(id: string): Promise<JobDetail | null> {
  const feed = await fetchText(API_URL, "application/json")
  if (feed) {
    const job = parseApiFeed(feed.body).find((j) => j.id === id)
    if (job) return detailFromApi(job)
  }
  const page = await fetchText(`${JOB_URL}/${id}`, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
  if (!page) return null
  return parseJobPage(page.body, id, page.url)
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a Remote OK job id from "${opts.id}" (expected a numeric id, a slug ending in the id, or a remoteok.com/remote-jobs/... URL)`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const found = await lookup(id)
    if (!found) {
      writeError(`Job ${id} not found on Remote OK`, "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(found)

    if (opts.format === "plain") {
      const facts = [
        job.salaryMin !== null || job.salaryMax !== null ? `Salary: ${salaryText(job.salaryMin, job.salaryMax)}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.applicantLocations ? `Applicants from: ${job.applicantLocations.join(", ")}` : "",
        job.validThrough ? `Valid through: ${job.validThrough.slice(0, 10)}` : "",
        job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
      ].filter(Boolean)
      const lines = [
        job.title,
        `${job.company ?? "—"} · ${job.location ?? "—"} · ${(job.date ?? "—").slice(0, 10)}`,
        ...(facts.length ? ["", ...facts] : []),
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        `Source: ${SOURCE} (${SOURCE_URL})`,
      ]
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
