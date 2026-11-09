import { describe, expect, test } from "bun:test"
import {
  decodeEntities,
  locationTerms,
  matchesAllTerms,
  matchesLocation,
  normalizeId,
  parseFeed,
  queryTerms,
  splitSkills,
  splitTitle,
  stripInvisible,
  toDetail,
  withinJobage,
} from "../src/helpers"
import { feedUrls } from "../src/commands/search"
import { lookupOrder } from "../src/commands/detail"

// A synthetic feed in the shape weworkremotely.com serves (no real postings or
// people): the description is HTML escaped once at the XML level.
function item(fields: Record<string, string>): string {
  return `<item>\n${Object.entries(fields).map(([k, v]) => `  <${k}>${v}</${k}>`).join("\n")}\n</item>`
}
const DESC =
  "&lt;img src=&quot;https://example.invalid/logo.gif&quot; /&gt;\n" +
  "&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; Istanbul, Türkiye&lt;br /&gt;&lt;strong&gt;URL:&lt;/strong&gt; &lt;a href=&quot;https://example.invalid&quot;&gt;example&lt;/a&gt;&lt;/p&gt;" +
  "&lt;p&gt;We build things &amp;amp; ship them. Use &amp;lt;b&amp;gt; tags.&lt;/p&gt;" +
  "&lt;ul&gt;&lt;li&gt;&lt;p&gt;Figma&lt;/p&gt;&lt;/li&gt;&lt;li&gt;&lt;p&gt;Webflow&lt;/p&gt;&lt;/li&gt;&lt;/ul&gt;"
const GOOD = item({
  title: "Example Studio &amp; Co: Senior Web Designer",
  region: "Anywhere in the World",
  country: "🇹🇷 Türkiye",
  state: "",
  skills: "Figma, Webflow, and Branding",
  category: "Design",
  type: "Full-Time",
  description: DESC,
  pubDate: "Mon, 09 Nov 2026 09:07:13 +0000",
  expires_at: "Wed, 09 Dec 2026 09:06:46 +0000",
  guid: "https://weworkremotely.com/remote-jobs/example-studio-co-senior-web-designer",
  link: "https://weworkremotely.com/remote-jobs/example-studio-co-senior-web-designer",
})
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>We Work Remotely</title><link>https://weworkremotely.com/remote-jobs.rss</link>
${GOOD}
${item({ title: "No link here: Designer" })}
${item({ title: "Off-site: Designer", link: "https://evil.example/remote-jobs/designer" })}
${item({ title: "Bare Title Without Company", link: "https://weworkremotely.com/remote-jobs/bare-title" })}
</channel></rss>`

describe("parseFeed", () => {
  test("parses good items and skips ones without a weworkremotely.com job link", () => {
    const jobs = parseFeed(FEED)
    expect(jobs.map((j) => j.id)).toEqual(["example-studio-co-senior-web-designer", "bare-title"])
    const [job] = jobs
    expect(job.title).toBe("Senior Web Designer")
    expect(job.company).toBe("Example Studio & Co")
    expect(job.location).toBe("Anywhere in the World · 🇹🇷 Türkiye")
    expect(job.date).toBe("2026-11-09T09:07:13.000Z")
    expect(job.url).toBe("https://weworkremotely.com/remote-jobs/example-studio-co-senior-web-designer")
    expect(job.skills).toEqual(["Figma", "Webflow", "Branding"])
    expect(job.source).toBe("We Work Remotely")
  })

  test("missing values are null, never omitted", () => {
    const bare = parseFeed(FEED)[1]
    expect(bare.company).toBeNull()
    expect(bare.title).toBe("Bare Title Without Company")
    for (const key of ["company", "location", "date"]) {
      expect(Object.prototype.hasOwnProperty.call(bare, key)).toBe(true)
      expect((bare as unknown as Record<string, unknown>)[key]).toBeNull()
    }
  })

  test("a non-RSS body (e.g. a challenge page) is an error, not zero results", () => {
    expect(() => parseFeed("<!DOCTYPE html><title>Just a moment...</title>")).toThrow(/not an RSS feed/)
  })
})

describe("detail text", () => {
  test("XML and HTML entities are each decoded exactly once; structure kept", () => {
    const detail = toDetail(parseFeed(FEED)[0])
    expect(detail.headquarters).toBe("Istanbul, Türkiye")
    expect(detail.description).toBe(
      "Headquarters: Istanbul, Türkiye\nURL: example\n\nWe build things & ship them. Use <b> tags.\n- Figma\n- Webflow",
    )
    expect(decodeEntities("&amp;lt;")).toBe("&lt;")
  })

  test("hidden markup and invisible characters never reach the output", () => {
    const hostileDesc =
      "&lt;p&gt;Visible.&lt;/p&gt;&lt;div style=&quot;display:none&quot;&gt;HIDDEN&lt;/div&gt;&lt;!-- HIDDEN --&gt;&lt;script&gt;HIDDEN&lt;/script&gt;&lt;span hidden&gt;HIDDEN&lt;/span&gt;"
    const feed = FEED.replace(DESC, hostileDesc).replace("Senior Web Designer</title>", "Senior Web Designer​‮&#xE0041;</title>")
    const detail = stripInvisible(toDetail(parseFeed(feed)[0]))
    expect(detail.title).toBe("Senior Web Designer")
    expect(detail.description).toBe("Visible.")
  })
})

describe("client-side filters", () => {
  test("every query word must start a word", () => {
    expect(matchesAllTerms("Senior Web Designer", queryTerms("web designer"))).toBe(true)
    expect(matchesAllTerms("Senior Webflow Developer", queryTerms("web designer"))).toBe(false)
  })

  test("location terms are OR'd; worldwide matches Anywhere in the World", () => {
    expect(matchesLocation("Anywhere in the World", locationTerms("worldwide"))).toBe(true)
    expect(matchesLocation("Europe Only", locationTerms("worldwide, europe"))).toBe(true)
    expect(matchesLocation("Anywhere in the World · 🇹🇷 Türkiye", locationTerms("turkiye"))).toBe(true)
    expect(matchesLocation("USA Only", locationTerms("worldwide,europe"))).toBe(false)
    expect(matchesLocation(null, locationTerms("worldwide"))).toBe(false)
  })

  test("jobage compares against pubDate", () => {
    const now = Date.parse("2026-11-10T00:00:00Z")
    expect(withinJobage("2026-11-09T09:07:13.000Z", 1, now)).toBe(true)
    expect(withinJobage("2026-10-01T00:00:00.000Z", 7, now)).toBe(false)
    expect(withinJobage(null, 7, now)).toBe(false)
  })

  test("title and skills splitting", () => {
    expect(splitTitle("Acme: Designer: Brand")).toEqual({ company: "Acme", title: "Designer: Brand" })
    expect(splitTitle("No company")).toEqual({ company: null, title: "No company" })
    expect(splitSkills("")).toEqual([])
  })
})

describe("feeds and ids", () => {
  test("no category reads the all-jobs feed; categories map to their feeds", () => {
    expect(feedUrls([])).toEqual(["https://weworkremotely.com/remote-jobs.rss"])
    expect(feedUrls(["design", "front-end"])).toEqual([
      "https://weworkremotely.com/categories/remote-design-jobs.rss",
      "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
    ])
    expect(lookupOrder(["design"])).toEqual(["https://weworkremotely.com/categories/remote-design-jobs.rss"])
    expect(lookupOrder([])[0]).toBe("https://weworkremotely.com/remote-jobs.rss")
  })

  test("normalizeId accepts slugs and weworkremotely.com URLs only", () => {
    expect(normalizeId("thatch-brand-designer")).toBe("thatch-brand-designer")
    expect(normalizeId("https://weworkremotely.com/remote-jobs/thatch-brand-designer")).toBe("thatch-brand-designer")
    expect(normalizeId("weworkremotely.com/remote-jobs/thatch-brand-designer")).toBe("thatch-brand-designer")
    expect(normalizeId("https://boards.greenhouse.io/thatch/jobs/123")).toBeNull()
    expect(normalizeId("https://weworkremotely.com.evil.io/remote-jobs/x-y")).toBeNull()
    expect(normalizeId("https://weworkremotely.com@evil.io/remote-jobs/x-y")).toBeNull()
    expect(normalizeId("not a slug")).toBeNull()
  })
})
