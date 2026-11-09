import { describe, expect, test } from "bun:test"
import {
  detailFromApi,
  fixMojibake,
  matchesAllTerms,
  matchesLocation,
  locationTerms,
  normalizeId,
  parseApiFeed,
  queryTerms,
  stripInvisible,
  withinJobage,
} from "../src/helpers"
import { buildUrl } from "../src/commands/search"

// Synthetic records in the API's shape (no real postings or people).
const LEGAL = { last_updated: 1794211212, legal: "API Terms of Service: link back to Remote OK." }
const JOB = {
  slug: "remote-senior-web-developer-example-co-1000001",
  id: "1000001",
  epoch: 1794096003,
  date: "2026-11-08T00:00:03+00:00",
  company: "Example Co &amp; Partners",
  company_logo: "",
  position: "Senior Web Developer",
  tags: ["web dev", "javascript", "react"],
  // "we’re" as the API serves it: UTF-8 bytes read as Latin-1.
  description: "<h1>About</h1><p>Weâ\u0080\u0099re hiring.</p><ul><li><p>React</p></li><li><p>CSS</p></li></ul>",
  location: "Europe, ",
  salary_min: 0,
  salary_max: 0,
  apply_url: "https://remoteOK.com/remote-jobs/remote-senior-web-developer-example-co-1000001",
  logo: "",
  url: "https://remoteOK.com/remote-jobs/remote-senior-web-developer-example-co-1000001",
}

describe("parseApiFeed", () => {
  test("skips the legal notice and malformed elements, keeps jobs", () => {
    const jobs = parseApiFeed(JSON.stringify([LEGAL, JOB, null, "x", { id: "abc" }, { ...JOB, id: "1000002", position: "" }]))
    expect(jobs).toHaveLength(1)
    const [job] = jobs
    expect(job.id).toBe("1000001")
    expect(job.title).toBe("Senior Web Developer")
    expect(job.company).toBe("Example Co & Partners")
    expect(job.location).toBe("Europe")
    expect(job.salaryMin).toBeNull()
    expect(job.salaryMax).toBeNull()
    expect(job.date).toBe("2026-11-08T00:00:03.000Z")
    expect(job.url).toBe("https://remoteok.com/remote-jobs/remote-senior-web-developer-example-co-1000001")
    expect(job.source).toBe("Remote OK")
  })

  test("missing values are null, never omitted", () => {
    const [job] = parseApiFeed(JSON.stringify([{ id: "1000003", position: "Designer" }]))
    for (const key of ["id", "title", "company", "location", "date", "url"]) {
      expect(Object.prototype.hasOwnProperty.call(job, key)).toBe(true)
    }
    expect(job.company).toBeNull()
    expect(job.location).toBeNull()
    expect(job.date).toBeNull()
  })

  test("a non-array or non-JSON body is an error", () => {
    expect(() => parseApiFeed("<html>")).toThrow(/not JSON/)
    expect(() => parseApiFeed("{}")).toThrow(/unexpected shape/)
  })
})

describe("text hygiene", () => {
  test("mojibake is repaired before invisible characters are stripped", () => {
    expect(fixMojibake("Weâ\u0080\u0099re")).toBe("We’re")
    expect(fixMojibake("MÃ¼nchen")).toBe("München")
    expect(fixMojibake("Müller")).toBe("Müller")
    const detail = stripInvisible(detailFromApi(parseApiFeed(JSON.stringify([JOB]))[0]))
    expect(detail.description).toBe("About\n\nWe’re hiring.\n- React\n- CSS")
  })

  test("hidden markup and invisible characters never reach the output", () => {
    const hostile = {
      ...JOB,
      position: "Web Developer​‮",
      description: '<p>Visible.</p><div style="display:none">HIDDEN</div><!-- HIDDEN --><script>HIDDEN</script><span hidden>HIDDEN</span>',
    }
    const detail = stripInvisible(detailFromApi(parseApiFeed(JSON.stringify([hostile]))[0]))
    expect(detail.title).toBe("Web Developer")
    expect(detail.description).toBe("Visible.")
  })
})

describe("client-side filters", () => {
  test("every query word must start a word", () => {
    expect(matchesAllTerms("Senior Web Developer", queryTerms("web developer"))).toBe(true)
    expect(matchesAllTerms("Senior Web Developer", queryTerms("WEB dev"))).toBe(true)
    expect(matchesAllTerms("Senior Webflow Developer", queryTerms("web designer"))).toBe(false)
    expect(matchesAllTerms("Cobweb Developer", queryTerms("web"))).toBe(false)
  })

  test("location terms are OR'd; worldwide also matches an empty location", () => {
    const terms = locationTerms("worldwide, europe, türkiye")
    expect(matchesLocation("Europe", terms)).toBe(true)
    expect(matchesLocation("Istanbul, Turkiye", terms)).toBe(true)
    expect(matchesLocation(null, terms)).toBe(true)
    expect(matchesLocation("US", terms)).toBe(false)
    expect(matchesLocation(null, locationTerms("europe"))).toBe(false)
  })

  test("jobage compares against the posting epoch", () => {
    const now = Date.parse("2026-11-09T00:00:00Z")
    expect(withinJobage({ epoch: now / 1000 - 86_400, date: null }, 2, now)).toBe(true)
    expect(withinJobage({ epoch: now / 1000 - 5 * 86_400, date: null }, 2, now)).toBe(false)
    expect(withinJobage({ epoch: null, date: null }, 2, now)).toBe(false)
    expect(withinJobage({ epoch: null, date: null }, undefined, now)).toBe(true)
  })

  test("--tag goes to the API hyphenated; no tag means the default feed", () => {
    expect(buildUrl({ tag: "Web Dev" })).toBe("https://remoteok.com/api?tag=web-dev")
    expect(buildUrl({})).toBe("https://remoteok.com/api")
  })
})

describe("normalizeId", () => {
  test("accepts ids, slugs and remoteok.com URLs", () => {
    expect(normalizeId("1137703")).toBe("1137703")
    expect(normalizeId("remote-account-executive-harvey-1137703")).toBe("1137703")
    expect(normalizeId("https://remoteOK.com/remote-jobs/remote-account-executive-harvey-1137703")).toBe("1137703")
    expect(normalizeId("remoteok.com/remote-jobs/1137703")).toBe("1137703")
  })

  test("rejects other hosts and look-alikes", () => {
    expect(normalizeId("https://boards.greenhouse.io/example/jobs/1137703")).toBeNull()
    expect(normalizeId("https://remoteok.com.evil.io/remote-jobs/1137703")).toBeNull()
    expect(normalizeId("https://remoteok.com@evil.io/remote-jobs/1137703")).toBeNull()
    expect(normalizeId("not an id")).toBeNull()
  })
})
