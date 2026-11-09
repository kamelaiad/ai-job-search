// Live smoke tests against toptalent.co (a handful of requests) plus the
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
  // toptalent carries only a handful of open postings at a time (5 on
  // 2026-11-09), so the >= 1 assertion runs on the unfiltered list; the
  // keyword test checks the contract shape, since its matches come and go.
  test("search returns >= 1 result with id/title/url", async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "--limit", "5"]));
    expect(out.meta.page).toBe(1);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    expect(out.meta.count).toBe(out.results.length);
    for (const r of out.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toBe(`https://toptalent.co/${r.id}`);
      for (const key of ["company", "location", "date", "daysLeft"]) {
        expect(key in r).toBe(true);
      }
      expect(r.date).toBeNull();
    }
  });

  test("a keyword search exits 0 with the contract JSON shape", async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "-q", "grafik tasarım"]));
    expect(out.meta).toMatchObject({ page: 1 });
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.meta.count).toBe(out.results.length);
  });

  test("detail on the first search result returns a readable posting", async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "--limit", "1"]));
    expect(out.results.length).toBe(1);
    const detail = parseJSON<Record<string, unknown>>(await runCLI(["detail", out.results[0].url]));
    expect(detail.id).toBe(out.results[0].id);
    expect(detail.title).toBeTruthy();
    expect(typeof detail.description).toBe("string");
    expect(String(detail.description)).not.toMatch(/<[a-z]+[\s>]/i);
  });
});

describe("CLI contract (network-free)", () => {
  test("a bogus flag exits 1 with UNKNOWN_FLAG on stderr", async () => {
    const result = await runCLI(["search", "-q", "web", "--bogus-flag", "x"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("UNKNOWN_FLAG");
    expect(err.error).toContain("--bogus-flag");
  });

  test("--jobage is rejected as unsupported, never silently ignored", async () => {
    const result = await runCLI(["search", "-q", "web", "--jobage", "7"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(parsedStderr(result.stderr).code).toBe("UNSUPPORTED_FLAG");
  });

  test("an unknown city exits 1 with UNKNOWN_LOCATION", async () => {
    const result = await runCLI(["search", "-l", "İstanbul,Atlantis"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = parsedStderr(result.stderr);
    expect(err.code).toBe("UNKNOWN_LOCATION");
    expect(err.error).toContain("Atlantis");
  });

  test("detail without an id exits 1 with NO_ID", async () => {
    const result = await runCLI(["detail"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("NO_ID");
  });

  test("detail with a non-toptalent URL exits 1 with BAD_ID", async () => {
    const result = await runCLI(["detail", "https://example.com/acme-web-developer-121812"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
  });

  test("detail on a robots.txt-disallowed posting is refused without fetching", async () => {
    const result = await runCLI(["detail", "turkiye-sigorta-geleceginin-sigortasi-120944"]);
    expect(result.exitCode).toBe(1);
    expect(parsedStderr(result.stderr).code).toBe("ROBOTS_DISALLOWED");
  });

  for (const [flag, value] of [
    ["--page", "0"],
    ["--page", "1.5"],
    ["--limit", "abc"],
    ["--level", "senior"],
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
});
