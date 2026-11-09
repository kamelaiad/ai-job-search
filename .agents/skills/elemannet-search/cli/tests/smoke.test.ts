// Contract tests. The first block makes ONE live request to eleman.net (a
// position listing page); everything else fails before any network call.
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
  test('search -q "grafik tasarım uzmanı" returns results with the contract fields', async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "-q", "grafik tasarım uzmanı", "--limit", "5"]))
    expect(out.meta.page).toBe(1)
    expect(out.meta.count).toBe(out.results.length)
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) expect(r).toHaveProperty(key)
      expect(String(r.id)).toMatch(/^\d+$/)
      expect(typeof r.title).toBe("string")
      expect(String(r.url)).toStartWith("https://www.eleman.net/is-ilani/")
    }
  })
})

describe("errors go to stderr as JSON with exit 1", () => {
  test("unknown flag", async () => {
    const r = await runCLI(["search", "-q", "grafik", "--bogus", "1"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("search without --query or --location", async () => {
    const r = await runCLI(["search"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_QUERY")
  })

  test("bare --location", async () => {
    const r = await runCLI(["search", "-l"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  for (const name of ["jobage", "page", "limit"]) {
    test(`fractional --${name} is refused, not truncated`, async () => {
      const r = await runCLI(["search", "-q", "grafik", `--${name}`, "1.5"])
      expect(r.exitCode).toBe(1)
      expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
    })
  }

  test("bad --format", async () => {
    const r = await runCLI(["search", "-q", "grafik", "--format", "xml"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("detail without an id", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_ID")
  })

  test("detail with a foreign URL", async () => {
    const r = await runCLI(["detail", "https://example.com/is-ilani/x-i4802848"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ID")
  })
})
