import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers"

interface SearchOutput {
  meta: { count: number; page: number; total: number; source: string }
  results: Array<{ id: string | null; title: string | null; url: string | null; company: string | null; location: string | null; date: string | null }>
}

function stderrJSON(stderr: string): { error?: string; code?: string } {
  return JSON.parse(stderr)
}

describe("Remote OK CLI error contract (no network)", () => {
  test("an unknown flag exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "-q", "web developer", "--remote", "remote"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(stderrJSON(result.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("detail without an id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(stderrJSON(result.stderr).code).toBe("NO_ID")
  })

  test("detail with a URL on another host exits 1 with BAD_ID", async () => {
    const result = await runCLI(["detail", "https://boards.greenhouse.io/example/jobs/1137703"])
    expect(result.exitCode).toBe(1)
    expect(stderrJSON(result.stderr).code).toBe("BAD_ID")
  })

  for (const [flag, value] of [["--jobage", "1.5"], ["--page", "0"], ["--limit", "abc"]]) {
    test(`${flag} ${value} exits 1 with BAD_ARG`, async () => {
      const result = await runCLI(["search", "-q", "designer", flag, value])
      expect(result.exitCode).toBe(1)
      expect(stderrJSON(result.stderr).code).toBe("BAD_ARG")
    })
  }

  test("an empty --query exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", ""])
    expect(result.exitCode).toBe(1)
    expect(stderrJSON(result.stderr).code).toBe("BAD_ARG")
  })

  test("a bad --format exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "--format", "xml"])
    expect(result.exitCode).toBe(1)
    expect(stderrJSON(result.stderr).code).toBe("BAD_ARG")
  })
})

describe("Remote OK live smoke test", () => {
  test('search -q "web developer" returns results with id, title and a remoteok.com url', async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "-q", "web developer", "--limit", "5"]))
    expect(out.meta.source).toBe("Remote OK")
    expect(out.meta.page).toBe(1)
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toBeTruthy()
      expect(r.title).toBeTruthy()
      expect(r.url).toMatch(/^https:\/\/remoteok\.com\/remote-jobs\//)
      for (const key of ["company", "location", "date"]) expect(key in r).toBe(true)
    }
  })
})
