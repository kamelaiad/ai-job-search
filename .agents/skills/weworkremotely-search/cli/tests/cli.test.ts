import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers"

interface SearchOutput {
  meta: { count: number; page: number; total: number; source: string }
  results: Array<{ id: string | null; title: string | null; url: string | null; company: string | null; location: string | null; date: string | null }>
}

function stderrJSON(stderr: string): { error?: string; code?: string } {
  return JSON.parse(stderr)
}

describe("We Work Remotely CLI error contract (no network)", () => {
  test("an unknown flag exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "-q", "web designer", "--remote", "remote"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(stderrJSON(result.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("an unknown category exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-c", "design,astronaut"])
    expect(result.exitCode).toBe(1)
    expect(stderrJSON(result.stderr).code).toBe("BAD_ARG")
    expect(stderrJSON(result.stderr).error).toMatch(/astronaut/)
  })

  test("detail without a slug exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(stderrJSON(result.stderr).code).toBe("NO_ID")
  })

  test("detail with a URL on another host exits 1 with BAD_ID", async () => {
    const result = await runCLI(["detail", "https://boards.greenhouse.io/example/jobs/123"])
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
})

describe("We Work Remotely live smoke test", () => {
  test('search -q "web designer" returns results with id, title and a weworkremotely.com url', async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "-q", "web designer", "--limit", "5"]))
    expect(out.meta.source).toBe("We Work Remotely")
    expect(out.meta.page).toBe(1)
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toBeTruthy()
      expect(r.title).toBeTruthy()
      expect(r.url).toMatch(/^https:\/\/weworkremotely\.com\/remote-jobs\//)
      for (const key of ["company", "location", "date"]) expect(key in r).toBe(true)
    }
  })
})
