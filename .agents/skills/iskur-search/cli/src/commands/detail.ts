import {
  CliError,
  detailUrl,
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

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse an İŞKUR ad number from "${opts.id}" (expected e.g. 00009887102 or an esube.iskur.gov.tr AcikIsIlanDetay.aspx?uiID=... URL)`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const html = await htmlFetch(detailUrl(id))
    const parsed = html ? parseJobDetail(html, id) : null
    if (!parsed) {
      writeError(`Job ad ${id} not found (closed, removed or not public)`, "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const occupations = job.occupations
        .map((o) => (o.experience ? `${o.name} (deneyim: ${o.experience})` : o.name))
        .join("; ")
      const education = [job.educationMin, job.educationMax].some(Boolean)
        ? `Education: ${job.educationMin || "—"}${job.educationMax ? ` – ${job.educationMax}` : ""}`
        : ""
      const lines = [
        job.title || "(untitled)",
        `İlan No: ${job.id}`,
        "",
        occupations ? `Occupation: ${occupations}` : "",
        education,
        job.adType ? `Ad type: ${job.adType}` : "",
        "",
        "İş Tanımı (description):",
        job.description || "(no description)",
        "",
        job.qualifications ? "Nitelik ve Beceriler (qualifications):" : "",
        job.qualifications || "",
        "",
        "Employer, location and deadline are not on the public detail page - see the search result.",
        `URL: ${job.url}`,
      ]
      // Drop empty optional lines but keep single blank separators.
      const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
      process.stdout.write(out + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    const code = e instanceof CliError ? e.code : "DETAIL_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
