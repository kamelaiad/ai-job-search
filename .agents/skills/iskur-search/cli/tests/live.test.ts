// Live smoke test against esube.iskur.gov.tr: 3 requests in total (form GET,
// search POST, one detail GET). Set ISKUR_SKIP_LIVE=1 to skip offline.
import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

const live = process.env.ISKUR_SKIP_LIVE ? describe.skip : describe;

interface SearchOut {
  meta: { count: number; page: number };
  results: { id: string; title: string; company: string | null; location: string | null; date: string | null; url: string }[];
}

live("live İŞKUR smoke test", () => {
  let firstId = "";

  test("search returns real results with the contract fields", async () => {
    // "tasarım" in Bursa is broad enough to stay non-empty from week to week.
    const out = parseJSON<SearchOut>(await runCLI(["search", "-q", "tasarım", "-l", "Bursa", "--limit", "5"]));
    expect(out.meta.page).toBe(1);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    for (const r of out.results) {
      expect(r.id).toMatch(/^\d{11}$/);
      expect(r.title).toBeTruthy();
      expect(r.title).not.toMatch(/[<>]/);
      expect(r.url).toStartWith("https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=");
      expect(r).toHaveProperty("company");
      expect(r).toHaveProperty("date");
      expect(r.location ?? "").toContain("Bursa");
    }
    firstId = out.results[0].id;
  }, 60000);

  test("detail returns a readable description for a search hit", async () => {
    expect(firstId).not.toBe("");
    const job = parseJSON<{ id: string; description: string | null; occupations: unknown[] }>(
      await runCLI(["detail", firstId]),
    );
    expect(job.id).toBe(firstId);
    expect(job.description ?? "").not.toMatch(/<[a-z]/i);
    expect((job.description ?? "").length + job.occupations.length).toBeGreaterThan(0);
  }, 60000);
});
