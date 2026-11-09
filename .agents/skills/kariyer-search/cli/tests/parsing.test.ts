import { describe, expect, test } from "bun:test";
import {
  ageDays,
  ageToDate,
  decodeHtmlEntities,
  foldTurkish,
  hasNextPage,
  jobageToParam,
  parseJobCards,
  parseJobDetail,
  resolveLocation,
  trDateToIso,
} from "../src/helpers";
import { card, detailPage, searchPage } from "./fixtures";

// 2026-11-09 12:00 in Türkiye (UTC+3).
const NOW = new Date("2026-11-09T09:00:00Z");

describe("parseJobCards", () => {
  test("extracts every contract field from a card", () => {
    const html = searchPage([
      card({ id: "4500001", title: "Web Developer", company: "Örnek Yazılım A.Ş.", location: "Bursa (Nilüfer)", time: "4 gün" }),
    ]);
    const [c] = parseJobCards(html, NOW);
    expect(c).toEqual({
      id: "4500001",
      title: "Web Developer",
      company: "Örnek Yazılım A.Ş.",
      location: "Bursa (Nilüfer)",
      date: "2026-11-05",
      age: "4 gün",
      workModel: "Hibrit",
      employmentType: "Tam zamanlı",
      sponsored: false,
      url: "https://www.kariyer.net/is-ilani/ornek-yazilim-a-s-web-developer-4500001",
    });
  });

  test("a remote card without a location span falls back to cityName plus the extra-city count", () => {
    const html = searchPage([
      card({ id: "4500002", title: "Frontend Developer", company: "Uzak Ekip Ltd.", workModel: "Uzaktan / Remote", cityName: "Adana", cityCount: 3 }),
    ]);
    const [c] = parseJobCards(html, NOW);
    expect(c.location).toBe("Adana +2 il daha");
    expect(c.workModel).toBe("Uzaktan / Remote");
  });

  test("missing values are null, never omitted", () => {
    const html = searchPage([card({ id: "4500003", title: "Grafik Tasarımcı", time: "Son gün ilanı" })]);
    const [c] = parseJobCards(html, NOW);
    expect(c.company).toBeNull();
    expect(c.date).toBeNull();
    expect(Object.keys(c)).toEqual(
      expect.arrayContaining(["id", "title", "company", "location", "date", "url"]),
    );
  });

  test("a malformed card is skipped without breaking the rest", () => {
    const broken = card({ id: "4500004", title: "Kırık" }).replace(/href="[^"]*"/, 'href="/firma-profil/x"');
    const html = searchPage([
      card({ id: "4500005", title: "UI/UX Designer" }),
      broken,
      card({ id: "4500006", title: "" }),
      card({ id: "4500007", title: "Grafik Tasarımcı" }),
    ]);
    expect(parseJobCards(html, NOW).map((c) => c.id)).toEqual(["4500005", "4500007"]);
  });

  test("sponsored cards are flagged", () => {
    const html = searchPage([card({ id: "4500008", title: "Tahsilat Uzmanı", sponsored: true })]);
    expect(parseJobCards(html, NOW)[0].sponsored).toBe(true);
  });

  test("entities in titles and company names are decoded", () => {
    const html = searchPage([card({ id: "4500009", title: "R&amp;D M&uuml;hendisi", company: "A &amp; B Ltd. &#350;ti." })]);
    const [c] = parseJobCards(html, NOW);
    expect(c.title).toBe("R&D Mühendisi");
    expect(c.company).toBe("A & B Ltd. Şti.");
  });

  test("an empty or unrelated page yields no results", () => {
    expect(parseJobCards("", NOW)).toEqual([]);
    expect(parseJobCards("<html><body>Bakımdayız</body></html>", NOW)).toEqual([]);
  });
});

describe("hasNextPage", () => {
  test("detects the cp=<page+1> link", () => {
    expect(hasNextPage(searchPage([], { nextPage: 2 }), 1)).toBe(true);
    expect(hasNextPage(searchPage([]), 1)).toBe(false);
    expect(hasNextPage(searchPage([], { nextPage: 2 }), 2)).toBe(false);
  });
});

describe("parseJobDetail", () => {
  const url = "https://www.kariyer.net/is-ilani/ornek-yazilim-a-s-web-developer-4500001";

  test("extracts header, dates, criteria and status", () => {
    const job = parseJobDetail(detailPage(), "4500001", url)!;
    expect(job.title).toBe("Web Developer");
    expect(job.company).toBe("Örnek Yazılım A.Ş.");
    expect(job.companyUrl).toBe("https://www.kariyer.net/firma-profil/ornek-yazilim-a-s-1-2");
    expect(job.location).toBe("Bursa (Nilüfer)");
    expect(job.date).toBe("2026-11-06");
    expect(job.deadline).toBe("2026-12-05");
    expect(job.url).toBe(url);
    expect(job.employmentType).toBe("Tam Zamanlı");
    expect(job.workModel).toBe("Hibrit");
    expect(job.positionLevel).toBe("Uzman");
    expect(job.experience).toBe("2 - 5 yıl arası");
    expect(job.department).toBe("Bilgi Teknolojileri / IT");
    expect(job.criteria).toEqual({ "Tecrübe": "2 - 5 yıl arası", "Eğitim Seviyesi": "Üniversite(Mezun)" });
    expect(job.isActive).toBe(true);
  });

  test("description keeps paragraph and list breaks with entities decoded", () => {
    const job = parseJobDetail(detailPage(), "4500001", url)!;
    expect(job.description).toBe(
      [
        "Örnek Yazılım A.Ş. olarak ekibimize “Web Developer” arıyoruz.",
        "Aranan Nitelikler",
        "",
        "• HTML5, CSS3 & JavaScript",
        "• React veya Vue deneyimi",
        "",
        "Bursa ofisimizde çalışacak.",
        "Hibrit çalışma.",
      ].join("\n"),
    );
  });

  test("bullets wrapped in separate paragraphs stay a tight list", () => {
    const job = parseJobDetail(
      detailPage({ description: "<p>• Birinci madde</p><p></p><p>• İkinci madde</p><p>Son paragraf</p>" }),
      "4500001",
      url,
    )!;
    expect(job.description).toBe("• Birinci madde\n• İkinci madde\nSon paragraf");
  });

  test("a closed posting reports isActive false", () => {
    expect(parseJobDetail(detailPage({ isActive: "false" }), "4500001", url)!.isActive).toBe(false);
  });

  test("a page without a job title is not a posting", () => {
    expect(parseJobDetail(searchPage([card({ id: "4500001", title: "Web Developer" })]), "4500001", url)).toBeNull();
  });
});

describe("dates", () => {
  test("relative labels map to ages and Türkiye calendar dates", () => {
    expect(ageDays("4 gün")).toBe(4);
    expect(ageDays("3 saat")).toBe(0);
    expect(ageDays("2 hafta")).toBe(14);
    expect(ageDays("1 ay")).toBe(30);
    expect(ageDays("Bugün")).toBe(0);
    expect(ageDays("Dün")).toBe(1);
    expect(ageDays("Son gün ilanı")).toBeNull();
    expect(ageDays(null)).toBeNull();
    expect(ageToDate("4 gün", NOW)).toBe("2026-11-05");
    // 22:30 UTC is already the next day in Türkiye.
    expect(ageToDate("1 saat", new Date("2026-11-09T22:30:00Z"))).toBe("2026-11-10");
  });

  test("dd.mm.yyyy becomes ISO", () => {
    expect(trDateToIso("20.11.2026")).toBe("2026-11-20");
    expect(trDateToIso("1.2.2027")).toBe("2027-02-01");
    expect(trDateToIso("2026-11-20")).toBeNull();
    expect(trDateToIso(null)).toBeNull();
  });
});

describe("filters", () => {
  test("--jobage maps to the smallest portal window that covers it", () => {
    expect(jobageToParam(1)).toBe("1g");
    expect(jobageToParam(2)).toBe("3g");
    expect(jobageToParam(3)).toBe("3g");
    expect(jobageToParam(7)).toBe("7g");
    expect(jobageToParam(14)).toBe("15g");
    expect(jobageToParam(15)).toBe("15g");
    expect(jobageToParam(30)).toBeNull();
  });

  test("Turkish city names resolve to kariyer.net city IDs", () => {
    expect(resolveLocation("Bursa")).toBe("16");
    expect(resolveLocation("İstanbul")).toBe("998");
    expect(resolveLocation("ISTANBUL")).toBe("998");
    expect(resolveLocation("İstanbul Anadolu")).toBe("82");
    expect(resolveLocation("istanbul-avrupa")).toBe("34");
    expect(resolveLocation("izmir")).toBe("35");
    expect(resolveLocation("Ankara, İzmir")).toBe("6,35");
    expect(resolveLocation("Şanlıurfa")).toBe("63");
    expect(resolveLocation("16")).toBe("16");
  });

  test("an unknown location is rejected, not ignored", () => {
    expect(resolveLocation("Berlin")).toBeNull();
    expect(resolveLocation("Bursa,Atlantis")).toBeNull();
    expect(resolveLocation("999")).toBeNull();
    expect(resolveLocation(" , ")).toBeNull();
  });

  test("foldTurkish handles dotted and dotless i", () => {
    expect(foldTurkish("İĞDIR")).toBe("igdir");
    expect(foldTurkish("Kırıkkale")).toBe("kirikkale");
  });
});

describe("decodeHtmlEntities", () => {
  test("decodes in one pass, so an escaped entity stays literal", () => {
    expect(decodeHtmlEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(decodeHtmlEntities("&#x1F600; &#287; &ouml; &unknown;")).toBe("😀 ğ ö &unknown;");
  });
});
