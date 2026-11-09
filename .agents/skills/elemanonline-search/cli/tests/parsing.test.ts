// Offline parser tests on synthetic pages (no real postings or people).
import { afterEach, describe, expect, test } from "bun:test";
import {
  parseDetailPage,
  parseSearchPage,
  stripInvisible,
  textFromHtml,
  turkishSlug,
} from "../src/helpers";
import { buildUrl, runSearch } from "../src/commands/search";
import { normalizeId } from "../src/commands/detail";

function page(pageProps: unknown): string {
  const data = { props: { pageProps }, page: "/is-ilanlari/[[...slug]]" };
  return `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

const ID1 = "6a0000000000000000000001";
const ID2 = "6a0000000000000000000002";

function searchPage(jobs: unknown[], provinceId: string | null = "16"): string {
  return page({
    query: { term: "grafik tasarım", slug: "bursa", provinceId, page: 1 },
    jobs: { jobs, jobsShowcase: [], totalItems: jobs.length, totalPages: 1, currentPage: 1 },
  });
}

const goodJob = {
  _id: ID1,
  slug: `/is-ilani/grafik-tasarimci/${ID1}`,
  position: "Grafik Tasarımcı​",
  workingTypeText: "Tam Zamanlı",
  publishDate: "2026-11-01T09:00:00.000Z",
  salary: null,
  location: [
    { provinceText: "Bursa", townText: "Nilüfer" },
    { provinceText: "Bursa", townText: "Nilüfer" },
  ],
  company: { title: "Örnek Tasarım Ltd. Şti.", slug: "/firma/ornek-tasarim/5a0000000000000000000001" },
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});
const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

describe("parseSearchPage", () => {
  test("maps fields, de-duplicates locations, keeps nulls", () => {
    const res = parseSearchPage(searchPage([goodJob]));
    expect(res.provinceId).toBe("16");
    expect(res.total).toBe(1);
    const [c] = stripInvisible(res.cards);
    expect(c).toEqual({
      id: ID1,
      title: "Grafik Tasarımcı",
      company: "Örnek Tasarım Ltd. Şti.",
      companyUrl: "https://www.elemanonline.com.tr/firma/ornek-tasarim/5a0000000000000000000001",
      location: "Nilüfer, Bursa",
      date: "2026-11-01T09:00:00.000Z",
      url: `https://www.elemanonline.com.tr/is-ilani/grafik-tasarimci/${ID1}`,
      workType: "Tam Zamanlı",
      salary: null,
    });
  });

  test("a malformed entry is skipped without breaking the rest", () => {
    const res = parseSearchPage(
      searchPage([null, { _id: "not-an-id", position: "X" }, { _id: ID2 }, goodJob, 42]),
    );
    expect(res.cards.map((c) => c.id)).toEqual([ID1]);
  });

  test("a missing __NEXT_DATA__ block is a PARSE_FAILED error, not zero results", () => {
    expect(() => parseSearchPage("<html><body>maintenance</body></html>")).toThrow(/__NEXT_DATA__/);
  });

  test("an unknown city slug comes back as provinceId null", () => {
    expect(parseSearchPage(searchPage([], null)).provinceId).toBeNull();
  });
});

describe("parseDetailPage + textFromHtml", () => {
  test("hidden markup never reaches the description; newlines survive", () => {
    const html = page({
      job: {
        ...goodJob,
        content:
          'Satır bir\nSatır iki<div style="display:none">GİZLİ METİN</div><!-- yorum --><p>Paragraf &amp; devam</p>',
        workingPreferenceText: "Hibrit",
        sdp: [{ departmentText: "Grafik" }, { departmentText: "Grafik" }],
        minAge: 20,
        maxAge: 35,
        status: "APPROVE",
      },
    });
    const job = parseDetailPage(html, ID1)!;
    expect(job.description).toContain("Satır bir\nSatır iki");
    expect(job.description).toContain("Paragraf & devam");
    expect(job.description).not.toContain("GİZLİ");
    expect(job.description).not.toContain("yorum");
    expect(job.department).toBe("Grafik");
    expect(job.ageRange).toBe("20-35");
    expect(job.workPreference).toBe("Hibrit");
  });

  test("a page without a job returns null", () => {
    expect(parseDetailPage(page({ jobs: {} }), ID1)).toBeNull();
  });

  test("plain text with a lone '<' is not mangled", () => {
    expect(textFromHtml("Deneyim <3 yıl tercih edilir")).toBe("Deneyim <3 yıl tercih edilir");
  });
});

describe("stripInvisible", () => {
  test("removes zero-width, bidi and tag characters", () => {
    const tagged = "UI/UX" + String.fromCodePoint(0xe0041, 0xe0042) + "‮ Designer‍";
    expect(stripInvisible({ t: tagged })).toEqual({ t: "UI/UX Designer" });
  });
});

describe("URL building and id parsing", () => {
  test("turkishSlug transliterates province names", () => {
    expect(turkishSlug("İstanbul")).toBe("istanbul");
    expect(turkishSlug("İstanbul Avrupa")).toBe("istanbul-avrupa");
    expect(turkishSlug("Eskişehir")).toBe("eskisehir");
    expect(turkishSlug("IĞDIR")).toBe("igdir");
  });

  test("location is a path segment, jobage maps to publishDate", () => {
    const url = new URL(buildUrl({ query: "web tasarım", location: "İzmir", jobage: 7, page: 2, format: "json" }));
    expect(url.pathname).toBe("/is-ilanlari/izmir");
    expect(url.searchParams.get("term")).toBe("web tasarım");
    expect(url.searchParams.get("publishDate")).toBe("7");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("query")).toBe(false);
  });

  test("normalizeId accepts ids, job URLs and paths; rejects other hosts", () => {
    expect(normalizeId(ID1)).toBe(ID1);
    expect(normalizeId(`https://www.elemanonline.com.tr/is-ilani/grafik-tasarimci/${ID1}`)).toBe(ID1);
    expect(normalizeId(`elemanonline.com.tr/is-ilani/x/${ID1}`)).toBe(ID1);
    expect(normalizeId(`/is-ilani/x/${ID1}`)).toBe(ID1);
    expect(normalizeId(`https://elemanonline.com.tr.evil.io/is-ilani/x/${ID1}`)).toBeNull();
    expect(normalizeId(`https://elemanonline.com.tr@evil.io/is-ilani/x/${ID1}`)).toBeNull();
    expect(normalizeId("12345")).toBeNull();
  });
});

describe("runSearch", () => {
  test("unknown location exits 1 instead of returning nationwide results", async () => {
    globalThis.fetch = (async () => new Response(searchPage([goodJob], null))) as unknown as typeof fetch;
    let stderr = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
    const code = await runSearch({ query: "x", location: "Atlantis", page: 1, format: "json" });
    expect(code).toBe(1);
    expect(JSON.parse(stderr).code).toBe("UNKNOWN_LOCATION");
  });

  test("--limit caps results client-side", async () => {
    globalThis.fetch = (async () =>
      new Response(searchPage([goodJob, { ...goodJob, _id: ID2, slug: `/is-ilani/x/${ID2}` }]))) as unknown as typeof fetch;
    let stdout = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    const code = await runSearch({ location: "Bursa", page: 1, limit: 1, format: "json" });
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.meta.count).toBe(1);
    expect(out.results).toHaveLength(1);
  });
});
