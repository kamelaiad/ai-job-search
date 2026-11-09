import { afterAll, describe, expect, test } from "bun:test";
import { parseJSON, runCLI, tempCache } from "./helpers";

// Live smoke test against the real Careerjet API. It needs a publisher key, so
// it is skipped when CAREERJET_API_TOKEN is not set (CI and fresh clones); the
// offline tests cover the contract either way. One or two requests per run.

const TOKEN = process.env.CAREERJET_API_TOKEN?.trim();
const cache = tempCache();
afterAll(() => cache.cleanup());

interface SearchOutput {
  meta: { count: number };
  results: Array<{ id: string | null; title: string | null; url: string | null }>;
}

describe.skipIf(!TOKEN)("live Careerjet API (needs CAREERJET_API_TOKEN)", () => {
  const env = {
    CAREERJET_API_TOKEN: TOKEN,
    CAREERJET_CACHE_FILE: cache.file,
    CAREERJET_USER_IP: process.env.CAREERJET_USER_IP,
    CAREERJET_REFERER: process.env.CAREERJET_REFERER,
  };

  test("search 'web developer' in Bursa (falling back to İstanbul) returns real results, and detail reads one", async () => {
    let result = await runCLI(["search", "-q", "web developer", "-l", "Bursa", "--limit", "5"], { env });
    let out = parseJSON<SearchOutput>(result);
    if (out.results.length === 0) {
      result = await runCLI(["search", "-q", "web developer", "-l", "İstanbul", "--limit", "5"], { env });
      out = parseJSON<SearchOutput>(result);
    }
    expect(result.exitCode).toBe(0);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    for (const r of out.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toMatch(/^https?:\/\//);
    }

    const detail = await runCLI(["detail", out.results[0].id!, "--format", "plain"], { env });
    expect(detail.exitCode).toBe(0);
    expect(detail.stdout).toContain(out.results[0].title!);
  });
});
