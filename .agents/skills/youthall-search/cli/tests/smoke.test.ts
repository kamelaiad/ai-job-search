// Live smoke tests against www.youthall.com (a handful of requests) plus the
// network-free CLI contract checks: bad flags and missing args exit 1 with a
// JSON error on stderr and nothing on stdout.
import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

interface SearchOutput {
  meta: { count: number; page: number; hasMore: boolean };
  results: Array<Record<string, unknown> & { id: string; title: string; url: string }>;
}

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("live search", () => {
  // "staj" (internship) is the portal's core listing type, so it keeps matching
  // even as individual postings expire.
  test("search -q staj returns >= 1 result with id/title/url", async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "-q", "staj", "--limit", "5"]));
    expect(out.meta.page).toBe(1);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    expect(out.meta.count).toBe(out.results.length);
    for (const r of out.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toMatch(/^https:\/\/www\.youthall\.com\/(tr|en)\//);
      for (const key of ["company", "location", "date", "deadline", "type"]) {
        expect(key in r).toBe(true);
      }
      expect(r.date).toBeNull();
    }
  });

  test("detail on the first search result returns a readable posting", async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "--limit", "1"]));
    expect(out.results.length).toBe(1);
    const detail = parseJSON<Record<string, unknown>>(await runCLI(["detail", out.results[0].id]));
    expect(detail.id).toBe(out.results[0].id);
    expect(detail.title).toBeTruthy();
    expect(typeof detail.description).toBe("string");
    expect(String(detail.description)).not.toMatch(/<[a-z]+[\s>]/i);
  });
});

describe("CLI contract (network-free)", () => {
  test("a bogus flag exits 1 with UNKNOWN_FLAG on stderr", async () => {
    const result = await runCLI(["search", "-q", "staj", "--bogus-flag", "x"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("UNKNOWN_FLAG");
    expect(err.error).toContain("--bogus-flag");
  });

  test("--jobage is rejected as unsupported, never silently ignored", async () => {
    const result = await runCLI(["search", "-q", "staj", "--jobage", "7"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(parsedStderr(result.stderr).code).toBe("UNSUPPORTED_FLAG");
  });

  test("detail without an id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  test("detail with a non-Youthall URL exits 1 with BAD_ID", async () => {
    const result = await runCLI(["detail", "https://example.com/Youthall/grafik-tasarim-stajyeri_154/"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
  });

  for (const [flag, value] of [
    ["--page", "0"],
    ["--page", "1.5"],
    ["--limit", "abc"],
    ["--type", "intern"],
    ["--format", "csv"],
  ]) {
    test(`${flag} ${value} exits 1 with BAD_ARG`, async () => {
      const result = await runCLI(["search", flag, value]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  }

  test("an empty --query exits 1 with BAD_ARG", async () => {
    const result = await runCLI(["search", "-q", ""]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
  });

  test("an unknown command exits 1 with BAD_CMD", async () => {
    const result = await runCLI(["list"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
  });
});
