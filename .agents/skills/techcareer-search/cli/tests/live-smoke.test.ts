import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

// Live smoke test against www.techcareer.net (two requests). Set
// SKIP_LIVE_TESTS=1 to skip it offline. Techcareer's keyword search is broad
// and its board is small (~100-150 open postings), so the check is "at least
// one complete result", not specific titles.

interface Card {
  id: string | null;
  title: string | null;
  url: string | null;
}

const live = process.env.SKIP_LIVE_TESTS === "1" ? describe.skip : describe;

live("live Techcareer search", () => {
  test('search -q "frontend developer" returns real, complete results and detail resolves one', async () => {
    const out = parseJSON<{ meta: { count: number; page: number }; results: Card[] }>(
      await runCLI(["search", "-q", "frontend developer", "--limit", "5"]),
    );
    expect(out.meta.page).toBe(1);
    expect(out.meta.count).toBeGreaterThanOrEqual(1);
    for (const job of out.results) {
      expect(job.id).toBeTruthy();
      expect(job.title).toBeTruthy();
      expect(job.url).toStartWith("https://www.techcareer.net/jobs/detail/");
      expect(job).toHaveProperty("company");
      expect(job).toHaveProperty("location");
      expect(job).toHaveProperty("date");
    }

    const detail = parseJSON<{ id: string; title: string; description: string | null }>(
      await runCLI(["detail", out.results[0].id!]),
    );
    expect(detail.id).toBe(out.results[0].id!);
    expect(detail.title).toBeTruthy();
    expect(detail.description).toBeTruthy();
  });
});
