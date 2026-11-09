// Contract tests. The first block makes ONE live request to secretcv.com (a
// keyword listing page); everything else fails before any network call.
import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers"

interface SearchOutput {
  meta: { count: number; page: number }
  results: Array<Record<string, unknown>>
}

function stderrJSON(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr)
  } catch {
    return {}
  }
}

describe("live smoke test", () => {
  test('search -q "web tasarım" returns results with the contract fields', async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "-q", "web tasarım", "--limit", "5"]))
    expect(out.meta.page).toBe(1)
    expect(out.meta.count).toBe(out.results.length)
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) expect(r).toHaveProperty(key)
      expect(typeof r.id).toBe("string")
      expect(typeof r.title).toBe("string")
      expect(String(r.url)).toStartWith("https://www.secretcv.com/")
    }
  })
})

describe("errors go to stderr as JSON with exit 1", () => {
  test("unknown flag", async () => {
    const r = await runCLI(["search", "-q", "web tasarım", "--bogus", "1"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("search without --query or --location", async () => {
    const r = await runCLI(["search"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_QUERY")
  })

  test("bare --query", async () => {
    const r = await runCLI(["search", "-q"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("--page 2 is refused (robots.txt disallows ?sf= pagination)", async () => {
    const r = await runCLI(["search", "-q", "web tasarım", "--page", "2"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("PAGE_NOT_ALLOWED")
  })

  test("fractional --jobage is refused, not truncated", async () => {
    const r = await runCLI(["search", "-q", "web tasarım", "--jobage", "0.5"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("a keyword whose URL robots.txt disallows is refused before fetching", async () => {
    const r = await runCLI(["search", "-q", "araştırma görevlisi"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("ROBOTS_DISALLOWED")
  })

  test("detail without an id", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_ID")
  })

  test("detail with a bare number", async () => {
    const r = await runCLI(["detail", "1882806"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ID")
  })
})
