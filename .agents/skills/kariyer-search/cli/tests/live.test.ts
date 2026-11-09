import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

// Live smoke test: ONE real search against kariyer.net per run. It proves the
// markup anchors still hold. Set KARIYER_SKIP_LIVE=1 to skip it (offline work,
// or a CI runner whose IP the site's bot protection refuses).
const skip = process.env.KARIYER_SKIP_LIVE === "1";

interface SearchOutput {
  meta: { count: number; page: number };
  results: Array<{ id: string | null; title: string | null; url: string | null; company: string | null }>;
}

describe.skipIf(skip)("live kariyer.net search", () => {
  test('search -q "web developer" returns real results', async () => {
    const r = await runCLI(["search", "-q", "web developer", "--limit", "5"]);
    const out = parseJSON<SearchOutput>(r);
    expect(out.meta.page).toBe(1);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    for (const job of out.results) {
      expect(job.id).toMatch(/^\d{5,}$/);
      expect(job.title).toBeTruthy();
      expect(job.url).toStartWith("https://www.kariyer.net/is-ilani/");
      expect(job).toHaveProperty("company");
    }
  });
});
