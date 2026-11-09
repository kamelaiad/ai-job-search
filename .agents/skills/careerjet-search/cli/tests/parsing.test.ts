import { describe, expect, test } from "bun:test";
import {
  cleanMultiline,
  cleanText,
  decodeHtmlEntities,
  makeId,
  parseSearchResponse,
  toIsoDate,
  toResult,
  withinDays,
} from "../src/helpers";
import { LOCATIONS_RESPONSE, searchResponse } from "./fixtures/search-response";

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

describe("parseSearchResponse", () => {
  const parsed = parseSearchResponse(searchResponse(NOW));
  if (parsed.kind !== "jobs") throw new Error("expected jobs");

  test("keeps well-formed jobs and drops malformed ones and duplicates independently", () => {
    expect(parsed.jobs.map((j) => j.title)).toEqual([
      "Web Developer (PHP / Laravel)",
      "Front-End Geliştirici & UI Developer",
      "Full Stack Developer",
    ]);
    expect(parsed.hits).toBe(57);
    expect(parsed.pages).toBe(3);
  });

  test("cleans markup and decodes entities", () => {
    const [a, b] = parsed.jobs;
    expect(a.company).toBe("Örnek Yazılım A.Ş.");
    expect(a.location).toBe("Nilüfer, Bursa");
    expect(b.company).toBe("Deneme Teknoloji & Danışmanlık");
    expect(b.description).toBe("React ve TypeScript ile çalışacak ekip arkadaşı.\n\nHibrit çalışma.");
    expect(a.description).toContain("3+ yıl PHP deneyimi");
    expect(a.description).not.toMatch(/<|>/);
  });

  test("parses the documented date format to YYYY-MM-DD", () => {
    expect(parsed.jobs[0].date).toBe("2026-11-08");
    expect(parsed.jobs[1].date).toBe("2026-10-20");
  });

  test("maps salary fields", () => {
    const b = parsed.jobs[1];
    expect(b.salary).toBe("40.000 TL - 55.000 TL");
    expect(b.salaryMin).toBe(40000);
    expect(b.salaryMax).toBe(55000);
    expect(b.salaryCurrency).toBe("TRY");
    expect(b.salaryPeriod).toBe("monthly");
  });

  test("missing values are null, never omitted", () => {
    const c = toResult(parsed.jobs[2]);
    for (const key of ["id", "title", "company", "location", "date", "url", "salary", "snippet"]) {
      expect(key in c).toBe(true);
    }
    expect(c.company).toBeNull();
    expect(c.location).toBeNull();
    expect(c.date).toBeNull();
    expect(c.salary).toBeNull();
    expect(c.salaryMin).toBeNull();
    expect(c.snippet).toBeNull();
  });

  test("search results omit the long description but keep a snippet", () => {
    const r = toResult(parsed.jobs[0]) as unknown as Record<string, unknown>;
    expect("description" in r).toBe(false);
    expect(typeof r.snippet).toBe("string");
  });

  test("ids are deterministic and do not depend on the tracking URL", () => {
    const again = parseSearchResponse(searchResponse(NOW));
    if (again.kind !== "jobs") throw new Error("expected jobs");
    expect(again.jobs.map((j) => j.id)).toEqual(parsed.jobs.map((j) => j.id));
    for (const j of parsed.jobs) expect(j.id).toMatch(/^cj-[0-9a-f]{16}$/);
    expect(makeId("A", "B", "C", "2026-01-01")).toBe(makeId("a", "b", "c", "2026-01-01"));
    expect(makeId("A", "B", "C", "2026-01-01")).not.toBe(makeId("A", "B", "C", "2026-01-02"));
  });

  test("LOCATIONS responses are reported, not treated as zero jobs", () => {
    const loc = parseSearchResponse(LOCATIONS_RESPONSE);
    expect(loc.kind).toBe("locations");
    if (loc.kind === "locations") expect(loc.locations).toEqual(["Merkez, Bursa", "Merkez, Ankara"]);
  });

  test("an unexpected shape throws instead of returning an empty list", () => {
    expect(() => parseSearchResponse({ foo: 1 })).toThrow();
    expect(() => parseSearchResponse("nope")).toThrow();
  });
});

describe("text helpers", () => {
  test("entity decoding is single-pass", () => {
    expect(decodeHtmlEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(decodeHtmlEntities("&#x15F;&#305;&uuml;&unknownentity;")).toBe("şıü&unknownentity;");
  });

  test("cleanText returns null for empty and non-string values", () => {
    expect(cleanText("  <b> </b> ")).toBeNull();
    expect(cleanText(42)).toBeNull();
    expect(cleanText(null)).toBeNull();
  });

  test("cleanMultiline keeps line breaks", () => {
    expect(cleanMultiline("a<br>b<p>c</p>d")).toBe("a\nb\nc\nd");
    expect(cleanMultiline("Gereksinimler:<ul><li>PHP</li><li>React</li></ul>")).toBe("Gereksinimler:\n\n• PHP\n• React");
  });

  test("toIsoDate handles RFC-1123 dates with or without the comma space, and garbage", () => {
    expect(toIsoDate("Wed,15 Nov 2025 19:13:43 GMT")).toBe("2025-11-15");
    expect(toIsoDate("Wed, 15 Nov 2025 19:13:43 GMT")).toBe("2025-11-15");
    expect(toIsoDate("yesterday")).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });

  test("withinDays treats unknown dates as not recent", () => {
    expect(withinDays("2026-11-09", 1, NOW)).toBe(true);
    expect(withinDays("2026-11-02", 7, NOW)).toBe(true);
    expect(withinDays("2026-11-01", 7, NOW)).toBe(false);
    expect(withinDays(null, 7, NOW)).toBe(false);
  });
});
