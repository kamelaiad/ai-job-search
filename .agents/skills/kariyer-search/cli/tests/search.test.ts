import { afterEach, describe, expect, test } from "bun:test";
import { buildUrl, runSearch, type SearchOpts } from "../src/commands/search";
import { card, searchPage } from "./fixtures";

// The command path with fetch stubbed: no test here touches the network.

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
});

function serve(html: string): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(html, { status: 200 });
  }) as unknown as typeof fetch;
  return requested;
}

function captureStdout(): { text: () => string } {
  let out = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return { text: () => out };
}

const base: SearchOpts = { query: "web developer", page: 1, format: "json" };

describe("buildUrl", () => {
  test("maps every flag to the documented parameter", () => {
    const url = new URL(buildUrl({ ...base, cityIds: "16", jobage: 14, remote: "remote", page: 2 }));
    expect(url.origin + url.pathname).toBe("https://www.kariyer.net/is-ilanlari");
    expect(url.searchParams.get("kw")).toBe("web developer");
    expect(url.searchParams.get("ct")).toBe("16");
    expect(url.searchParams.get("date")).toBe("15g");
    expect(url.searchParams.get("wm")).toBe("1");
    expect(url.searchParams.get("cp")).toBe("2");
  });

  test("page 1 and no filters add nothing beyond kw", () => {
    expect(buildUrl(base)).toBe("https://www.kariyer.net/is-ilanlari?kw=web+developer");
  });

  test("onsite maps to wm=0, not to a dropped filter", () => {
    expect(new URL(buildUrl({ ...base, remote: "onsite" })).searchParams.get("wm")).toBe("0");
  });

  test("never builds a robots-disallowed URL (ckw, copilot, v=, /filtre)", () => {
    const url = buildUrl({ ...base, cityIds: "34,82", jobage: 3, remote: "hybrid", page: 3 });
    expect(url).not.toMatch(/[?&](ckw|copilot|v)=|\/filtre/);
  });
});

describe("runSearch", () => {
  test("emits the contract JSON shape", async () => {
    serve(searchPage([card({ id: "4500001", title: "Web Developer", company: "Örnek Yazılım A.Ş.", location: "Bursa" })], { nextPage: 2 }));
    const out = captureStdout();
    expect(await runSearch(base)).toBe(0);
    const json = JSON.parse(out.text());
    expect(json.meta).toEqual({ count: 1, page: 1, hasMore: true });
    expect(json.results[0]).toMatchObject({ id: "4500001", title: "Web Developer", company: "Örnek Yazılım A.Ş.", location: "Bursa" });
    expect(json.results[0]).toHaveProperty("date");
  });

  test("--limit caps the results client-side", async () => {
    serve(searchPage([card({ id: "4500001", title: "A" }), card({ id: "4500002", title: "B" })]));
    const out = captureStdout();
    expect(await runSearch({ ...base, limit: 1 })).toBe(0);
    expect(JSON.parse(out.text()).results).toHaveLength(1);
  });

  test("--jobage cuts the portal's window to exactly N days", async () => {
    serve(
      searchPage([
        card({ id: "4500001", title: "Yeni", time: "2 saat" }),
        card({ id: "4500002", title: "Beş gün", time: "5 gün" }),
        card({ id: "4500003", title: "On iki gün", time: "12 gün" }),
        card({ id: "4500004", title: "Okunamaz", time: "Son gün ilanı" }),
      ]),
    );
    const out = captureStdout();
    expect(await runSearch({ ...base, jobage: 7 })).toBe(0);
    expect(JSON.parse(out.text()).results.map((r: { id: string }) => r.id)).toEqual(["4500001", "4500002", "4500004"]);
  });

  test("an empty result page is a valid empty result", async () => {
    serve(searchPage([]));
    const out = captureStdout();
    expect(await runSearch(base)).toBe(0);
    expect(JSON.parse(out.text())).toEqual({ meta: { count: 0, page: 1, hasMore: false }, results: [] });
  });
});
