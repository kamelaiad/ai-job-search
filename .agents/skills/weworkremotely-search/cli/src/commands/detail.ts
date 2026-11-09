import {
  ALL_FEED_URL,
  BASE_URL,
  CATEGORIES,
  SOURCE,
  categoryFeedUrl,
  fetchText,
  normalizeId,
  parseFeed,
  stripInvisible,
  toDetail,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  categories: string[]
  format: "json" | "plain"
}

/**
 * Feeds to look in, in order. With --category: just those feeds (one request
 * each). Without: the all-jobs feed (the 10 newest per category), then every
 * category feed until the job turns up - the job page itself is behind a
 * Cloudflare challenge, so the RSS item is the only source of the description.
 */
export function lookupOrder(categories: string[]): string[] {
  if (categories.length) return categories.map(categoryFeedUrl)
  return [ALL_FEED_URL, ...Object.keys(CATEGORIES).map(categoryFeedUrl)]
}

async function lookup(id: string, categories: string[]): Promise<JobDetail | null> {
  for (const url of lookupOrder(categories)) {
    const xml = await fetchText(url)
    if (xml === null) continue
    const job = parseFeed(xml).find((j) => j.id === id)
    if (job) return toDetail(job)
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a We Work Remotely job slug from "${opts.id}" (expected a slug such as company-job-title, or a weworkremotely.com/remote-jobs/... URL)`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const found = await lookup(id, opts.categories)
    if (!found) {
      writeError(
        `Job "${id}" is not in the current We Work Remotely feeds${opts.categories.length ? " for that --category" : ""} (expired, removed, or a wrong slug)`,
        "NOT_FOUND",
      )
      return 1
    }
    const job = stripInvisible(found)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company ?? "—"} · ${job.location ?? "—"} · ${(job.date ?? "—").slice(0, 10)}`,
        "",
        job.category ? `Category: ${job.category}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.headquarters ? `Headquarters: ${job.headquarters}` : "",
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
        job.expiresAt ? `Expires: ${job.expiresAt.slice(0, 10)}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        `Source: ${SOURCE} (${BASE_URL})`,
      ]
      process.stdout.write(lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
