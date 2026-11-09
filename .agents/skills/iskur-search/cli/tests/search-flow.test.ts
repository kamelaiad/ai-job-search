// Offline tests of the GET-form -> POST-search -> POST-pager flow, with fetch mocked.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "path";
import { runSearch, type SearchOpts } from "../src/commands/search";
import { setPoliteDelay } from "../src/helpers";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

let RESULTS = "";
beforeAll(async () => {
  RESULTS = await Bun.file(join(import.meta.dir, "fixtures", "search-results.html")).text();
  setPoliteDelay(0);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

interface Captured {
  method: string;
  url: string;
  body: URLSearchParams | null;
  headers: Headers;
}

function mockPortal(pages: string[]): Captured[] {
  const captured: Captured[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      method: init?.method ?? "GET",
      url: String(input),
      body: init?.body ? new URLSearchParams(String(init.body)) : null,
      headers: new Headers(init?.headers),
    });
    const page = pages[Math.min(captured.length - 1, pages.length - 1)];
    return new Response(page, {
      status: 200,
      headers: { "Content-Type": "text/html", "Set-Cookie": "ASP.NET_SessionId=fixture; path=/; HttpOnly" },
    });
  }) as typeof fetch;
  return captured;
}

function captureStdout(): () => string {
  let out = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return () => out;
}

const base: SearchOpts = {
  query: "grafik tasarım",
  provinceCode: "16",
  provinceName: "Bursa",
  sector: "private",
  sectorValue: "ozelSektorRadio",
  jobage: 14,
  page: 1,
  format: "json",
};

describe("search flow", () => {
  test("page 1 is GET form + POST search with the criteria, honest UA and the session cookie", async () => {
    const reqs = mockPortal([RESULTS, RESULTS]);
    const out = captureStdout();
    const code = await runSearch(base);

    expect(code).toBe(0);
    expect(reqs.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect(reqs[0].headers.get("user-agent")).toBe("Mozilla/5.0 (compatible; iskur-cli/1.0)");
    const body = reqs[1].body!;
    expect(body.get("__EVENTTARGET")).toBe("ctl04$ctlAcikIsPageCommand$CommandItem_Search");
    expect(body.get("__VIEWSTATE")).toBe("FIXTUREVIEWSTATE2");
    expect(body.get("ctl04$ctlArananMetin2")).toBe("grafik tasarım");
    expect(body.get("ctl04$ctlIl")).toBe("16");
    expect(body.get("ctl04$IsyeriTuruRadios")).toBe("ozelSektorRadio");
    expect(body.get("ctl04$ctlIlanTarihi")).toBe("4");
    expect(reqs[1].headers.get("cookie")).toContain("ASP.NET_SessionId=fixture");

    const json = JSON.parse(out());
    expect(json.meta).toEqual({
      count: 2,
      page: 1,
      totalPages: 4,
      total: 50,
      sector: "private",
      location: "Bursa",
      jobageWindow: "15d",
    });
    for (const r of json.results) {
      for (const key of ["id", "title", "company", "location", "date", "url"]) expect(r).toHaveProperty(key);
    }
  });

  test("page 2 posts the pager with the page number", async () => {
    const page2 = RESULTS.replace(
      'value="1" id="ctl04_ctlDataPagerDetay_txtCurrentPage"',
      'value="2" id="ctl04_ctlDataPagerDetay_txtCurrentPage"',
    );
    const reqs = mockPortal([RESULTS, RESULTS, page2]);
    const out = captureStdout();
    const code = await runSearch({ ...base, page: 2 });

    expect(code).toBe(0);
    expect(reqs.map((r) => r.method)).toEqual(["GET", "POST", "POST"]);
    expect(reqs[2].body!.get("__EVENTTARGET")).toBe("ctl04$ctlDataPagerDetay$btnChangeCurrentPage");
    expect(reqs[2].body!.get("ctl04$ctlDataPagerDetay$txtCurrentPage")).toBe("2");
    expect(reqs[2].body!.get("ctl04$ctlArananMetin2")).toBe("grafik tasarım");
    expect(JSON.parse(out()).meta.page).toBe(2);
  });

  test("a page past the last one returns no results without another request", async () => {
    const reqs = mockPortal([RESULTS, RESULTS]);
    const out = captureStdout();
    const code = await runSearch({ ...base, page: 9 });

    expect(code).toBe(0);
    expect(reqs).toHaveLength(2);
    expect(JSON.parse(out()).results).toEqual([]);
  });

  test("--limit 0 emits zero results", async () => {
    mockPortal([RESULTS, RESULTS]);
    const out = captureStdout();
    const code = await runSearch({ ...base, limit: 0 });
    expect(code).toBe(0);
    expect(JSON.parse(out()).results).toHaveLength(0);
  });

  test("an unexpected page (layout change / error page) exits 1 with a JSON error", async () => {
    mockPortal(["<html><body>Bakım çalışması</body></html>"]);
    let err = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
    const code = await runSearch(base);
    expect(code).toBe(1);
    expect(JSON.parse(err).code).toBe("PORTAL_CHANGED");
  });
});
