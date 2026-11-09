// Live smoke tests against isbul.net's public Agent API (2 requests per run)
// plus argument-validation tests that exit before any request is made.
import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

interface Card {
  id: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  date: string | null;
  url: string | null;
}

function stderrJSON(stderr: string): { error?: string; code?: string } {
  return JSON.parse(stderr);
}

describe("live search + detail", () => {
  // "tasarım" is broad on purpose: narrower queries ("web developer",
  // "grafik tasarım") often have 0-1 live postings, which would make the
  // smoke test flaky.
  test("search returns real results with the contract shape, and detail reads one", async () => {
    const result = await runCLI(["search", "-q", "tasarım", "--limit", "3"]);
    expect(result.exitCode).toBe(0);
    const out = parseJSON<{ meta: { count: number; page: number }; results: Card[] }>(result);
    expect(out.meta.page).toBe(1);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    expect(out.meta.count).toBe(out.results.length);
    for (const r of out.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) {
        expect(key in r).toBe(true);
      }
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toStartWith("https://www.isbul.net/is-ilani/");
    }

    const detail = await runCLI(["detail", out.results[0].id!]);
    expect(detail.exitCode).toBe(0);
    const job = parseJSON<Card & { description: string | null; isOpen: boolean | null }>(detail);
    expect(job.id).toBe(out.results[0].id);
    expect(job.title).toBeTruthy();
    expect(job.description).toBeTruthy();
    expect(typeof job.isOpen).toBe("boolean");
  });
});

describe("argument validation (no network)", () => {
  test("unknown flag exits 1 with a JSON error on stderr", async () => {
    const r = await runCLI(["search", "-q", "web developer", "--bogus", "x"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG");
  });

  test("search without --query or --location exits 1", async () => {
    const r = await runCLI(["search"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("NO_QUERY");
  });

  test("bare --query exits 1 instead of widening the search", async () => {
    const r = await runCLI(["search", "-l", "Bursa", "-q"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG");
  });

  test("detail without an id exits 1", async () => {
    const r = await runCLI(["detail"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("NO_ID");
  });

  test("detail with a foreign-host URL exits 1", async () => {
    const r = await runCLI(["detail", "https://example.com/is-ilani/some-job-123"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("BAD_ID");
  });

  for (const name of ["jobage", "page", "limit"]) {
    test(`--${name} fractional exits 1 with BAD_ARG`, async () => {
      const r = await runCLI(["search", "-q", "web developer", `--${name}`, "1.5"]);
      expect(r.exitCode).toBe(1);
      expect(stderrJSON(r.stderr).code).toBe("BAD_ARG");
    });
  }

  test("bad --format exits 1", async () => {
    const r = await runCLI(["search", "-q", "web developer", "--format", "xml"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG");
  });
});
