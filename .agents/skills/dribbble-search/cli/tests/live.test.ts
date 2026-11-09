import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

// Live smoke test against dribbble.com: two requests per run (one search, one
// detail). Keep it that way - Dribbble's ToS restrict automated access.

interface SearchOutput {
  meta: { count: number; page: number };
  results: {
    id: string | null;
    title: string | null;
    company: string | null;
    location: string | null;
    date: string | null;
    url: string | null;
  }[];
}

describe("live: dribbble.com", () => {
  let firstId: string | null = null;

  test('search -q "product designer" returns real results', async () => {
    const out = parseJSON<SearchOutput>(await runCLI(["search", "-q", "product designer", "--limit", "5"]));
    expect(out.meta.page).toBe(1);
    expect(out.meta.count).toBeGreaterThanOrEqual(1);
    expect(out.results.length).toBe(out.meta.count);
    for (const job of out.results) {
      expect(job.id).toMatch(/^\d+$/);
      expect(job.title).toBeTruthy();
      expect(job.title).not.toMatch(/[<>]/);
      expect(job.url).toMatch(/^https:\/\/dribbble\.com\/jobs\/\d+/);
      // Every contract key is present (null when unknown, never omitted).
      for (const key of ["company", "location", "date"] as const) expect(key in job).toBe(true);
    }
    firstId = out.results[0].id;
  });

  test("detail <id> returns a readable posting", async () => {
    expect(firstId).not.toBeNull();
    const job = parseJSON<{ id: string; title: string; description: string | null; url: string }>(
      await runCLI(["detail", firstId!]),
    );
    expect(job.id).toBe(firstId!);
    expect(job.title).toBeTruthy();
    expect(job.description).toBeTruthy();
    expect(job.description).not.toMatch(/<\/?(p|div|strong|li)\b/);
    expect(job.url).toContain(`/jobs/${firstId}`);
  });
});
