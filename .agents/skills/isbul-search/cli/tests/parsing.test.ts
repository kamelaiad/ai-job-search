// Offline tests on synthetic API responses (no real postings or people).
import { afterEach, describe, expect, test } from "bun:test";
import {
  parseDetailResponse,
  parseSearchResponse,
  stripInvisible,
  textFromHtml,
  turkishSlug,
  withinDays,
} from "../src/helpers";
import { buildUrl, runSearch } from "../src/commands/search";
import { normalizeId } from "../src/commands/detail";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

const listing = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Grafik Tasarımcı​",
  company: "Örnek Tasarım A.Ş.",
  company_slug: "ornek-tasarim",
  city: "İstanbul Avrupa",
  district: "Beşiktaş",
  work_type: "Hibrit",
  position: "Grafik Tasarımcı",
  sector: "Bilişim",
  salary: null,
  published_at: "2026-11-01T09:00:00.000000Z",
  expires_at: "2026-12-31T09:00:00.000000Z",
  url: "https://www.isbul.net/is-ilani/ornek-tasarim-grafik-tasarimci",
  slug: "ornek-tasarim-grafik-tasarimci",
};

function captureStd(stream: "stdout" | "stderr"): () => string {
  let buf = "";
  process[stream].write = ((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  return () => buf;
}

describe("parseSearchResponse", () => {
  test("maps fields and keeps nulls", () => {
    const res = parseSearchResponse({ data: [listing], meta: { total: 1, last_page: 1 } });
    expect(res.total).toBe(1);
    expect(stripInvisible(res.cards)[0]).toEqual({
      id: listing.id,
      title: "Grafik Tasarımcı",
      company: "Örnek Tasarım A.Ş.",
      location: "Beşiktaş, İstanbul Avrupa",
      date: "2026-11-01T09:00:00.000000Z",
      url: "https://www.isbul.net/is-ilani/ornek-tasarim-grafik-tasarimci",
      slug: "ornek-tasarim-grafik-tasarimci",
      workType: "Hibrit",
      position: "Grafik Tasarımcı",
      sector: "Bilişim",
      salary: null,
      expiresAt: "2026-12-31T09:00:00.000000Z",
    });
  });

  test("malformed entries are skipped without breaking the rest", () => {
    const res = parseSearchResponse({
      data: [null, 7, { id: "../etc", title: "X" }, { id: "abc" }, listing],
    });
    expect(res.cards.map((c) => c.id)).toEqual([listing.id]);
  });

  test("a url pointing off isbul.net is replaced with one built from the slug", () => {
    const res = parseSearchResponse({ data: [{ ...listing, url: "https://evil.example/x" }] });
    expect(res.cards[0].url).toBe("https://www.isbul.net/is-ilani/ornek-tasarim-grafik-tasarimci");
  });

  test("a response without a data array is a PARSE_FAILED error, not zero results", () => {
    expect(() => parseSearchResponse({ error: "x" })).toThrow(/data array/);
  });
});

describe("parseDetailResponse + textFromHtml", () => {
  test("hidden markup never reaches the description", () => {
    const job = parseDetailResponse({
      data: {
        ...listing,
        description: 'Açıklama<span hidden>GİZLİ</span><p>UI/UX &amp; web</p><!-- not -->',
        education_level: "Lisans",
        experience_level: "Deneyimli",
        vacancy_count: 2,
        status: "published",
        is_open: true,
      },
    })!;
    expect(job.description).toContain("Açıklama");
    expect(job.description).toContain("UI/UX & web");
    expect(job.description).not.toContain("GİZLİ");
    expect(job.description).not.toContain("not");
    expect(job.isOpen).toBe(true);
    expect(job.vacancyCount).toBe(2);
  });

  test("a closed listing reports isOpen false", () => {
    const job = parseDetailResponse({ data: { ...listing, status: "passive", is_open: false } })!;
    expect(job.isOpen).toBe(false);
    expect(job.status).toBe("passive");
  });

  test("plain text with a lone '<' is not mangled", () => {
    expect(textFromHtml("Deneyim <3 yıl")).toBe("Deneyim <3 yıl");
  });
});

describe("stripInvisible", () => {
  test("removes zero-width, bidi and tag characters", () => {
    const tagged = "Web" + String.fromCodePoint(0xe0041) + "‮ Developer‍";
    expect(stripInvisible({ t: tagged })).toEqual({ t: "Web Developer" });
  });
});

describe("URL building, jobage and id parsing", () => {
  test("keyword goes in q (never query=), city is a transliterated slug, page size 25", () => {
    const raw = buildUrl({ query: "web developer", location: "İzmir", page: 2, format: "json" });
    expect(raw).not.toMatch(/[?&]query=/);
    const url = new URL(raw);
    expect(url.pathname).toBe("/api/agent/jobs");
    expect(url.searchParams.get("q")).toBe("web developer");
    expect(url.searchParams.get("city")).toBe("izmir");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("per_page")).toBe("25");
  });

  test("turkishSlug transliterates", () => {
    expect(turkishSlug("İstanbul")).toBe("istanbul");
    expect(turkishSlug("Eskişehir")).toBe("eskisehir");
  });

  test("withinDays keeps only recent postings", () => {
    const now = Date.parse("2026-11-09T00:00:00Z");
    const cards = parseSearchResponse({
      data: [
        { ...listing, id: "a1", published_at: "2026-11-08T00:00:00Z" },
        { ...listing, id: "a2", published_at: "2026-10-01T00:00:00Z" },
        { ...listing, id: "a3", published_at: null },
      ],
    }).cards;
    expect(withinDays(cards, 7, now).map((c) => c.id)).toEqual(["a1"]);
  });

  test("normalizeId accepts ids, slugs and isbul.net URLs; rejects other hosts", () => {
    expect(normalizeId(listing.id)).toBe(listing.id);
    expect(normalizeId("ornek-tasarim-grafik-tasarimci-12")).toBe("ornek-tasarim-grafik-tasarimci-12");
    expect(normalizeId("https://www.isbul.net/is-ilani/ornek-tasarim-grafik-tasarimci")).toBe(
      "ornek-tasarim-grafik-tasarimci",
    );
    expect(normalizeId("isbul.net/is-ilani/abc-1")).toBe("abc-1");
    expect(normalizeId("https://isbul.net.evil.io/is-ilani/abc-1")).toBeNull();
    expect(normalizeId("https://isbul.net@evil.io/is-ilani/abc-1")).toBeNull();
    expect(normalizeId("../../api/x")).toBeNull();
  });
});

describe("runSearch", () => {
  test("an API 400 for city becomes UNKNOWN_LOCATION on stderr", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: "unknown_filter_value", parameter: "city", value: "atlantis", message: "ignored" }),
        { status: 400 },
      )) as unknown as typeof fetch;
    const err = captureStd("stderr");
    const code = await runSearch({ query: "web", location: "Atlantis", page: 1, format: "json" });
    expect(code).toBe(1);
    const parsed = JSON.parse(err());
    expect(parsed.code).toBe("UNKNOWN_LOCATION");
    expect(parsed.error).not.toContain("ignored");
  });

  test("--jobage filters client-side and --limit caps", async () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { ...listing, id: "b1", published_at: recent },
            { ...listing, id: "b2", published_at: recent },
            { ...listing, id: "b3", published_at: "2020-01-01T00:00:00Z" },
          ],
          meta: { total: 3, last_page: 1 },
        }),
      )) as unknown as typeof fetch;
    const out = captureStd("stdout");
    const code = await runSearch({ query: "tasarım", jobage: 7, page: 1, limit: 1, format: "json" });
    expect(code).toBe(0);
    const parsed = JSON.parse(out());
    expect(parsed.meta).toEqual({ count: 1, page: 1, total: 3, lastPage: 1 });
    expect(parsed.results.map((r: { id: string }) => r.id)).toEqual(["b1"]);
  });
});
