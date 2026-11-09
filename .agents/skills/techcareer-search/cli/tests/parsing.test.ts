import { describe, expect, test } from "bun:test";
import { buildSearchUrl, htmlToText, parseJobDetail, parseSearchPage } from "../src/helpers";
import { normalizeId } from "../src/commands/detail";
import { detailHead, detailPage, listItem, searchPage } from "./fixtures";

describe("parseSearchPage", () => {
  test("maps a job-list item to the contract shape with every field present", () => {
    const page = parseSearchPage(searchPage([listItem()], { page: 1, pageCount: 3, pageSize: 20, total: 41 }));
    expect(page.total).toBe(41);
    expect(page.totalPages).toBe(3);
    expect(page.cards).toEqual([
      {
        id: "frontend-developer-4500001",
        title: "Frontend Developer",
        company: "Örnek Yazılım A.Ş.",
        location: "İstanbul(Avr.) / Türkiye",
        date: null,
        url: "https://www.techcareer.net/jobs/detail/frontend-developer-4500001",
        workplace: "Hibrit",
        position: "Front-End Geliştirici",
        otherLocations: 0,
        applyUrl: null,
      },
    ]);
  });

  test("one malformed item does not break the rest of the page", () => {
    const page = parseSearchPage(
      searchPage([
        "not an object",
        listItem({ slug: null }),
        listItem({ title: "" }),
        listItem({ slug: "../../etc/passwd-1234" }),
        listItem({ owner: "broken", workPlaces: "broken", otherLocations: "x" }),
        listItem({ slug: "web-developer-4500002", title: "Web Developer" }),
      ]),
    );
    expect(page.cards.map((c) => c.id)).toEqual(["frontend-developer-4500001", "web-developer-4500002"]);
    expect(page.cards[0].company).toBeNull();
    expect(page.cards[0].workplace).toBeNull();
    expect(page.cards[0].otherLocations).toBe(0);
  });

  test("a hidden company shows only the portal's hidden-company text, never the owner name", () => {
    const [card] = parseSearchPage(
      searchPage([listItem({ isCompanyHidden: true, hiddenCompanyInfo: "Lider bir e-ticaret şirketi" })]),
    ).cards;
    expect(card.company).toBe("Lider bir e-ticaret şirketi");
    const [blank] = parseSearchPage(searchPage([listItem({ isCompanyHidden: true, hiddenCompanyInfo: "" })])).cards;
    expect(blank.company).toBeNull();
  });

  test("an external apply link is kept only when it is an http(s) URL", () => {
    const [a, b] = parseSearchPage(
      searchPage([
        listItem({ applyLink: "https://careers.example.com/123" }),
        listItem({ slug: "web-developer-4500002", applyLink: "javascript:alert(1)" }),
      ]),
    ).cards;
    expect(a.applyUrl).toBe("https://careers.example.com/123");
    expect(b.applyUrl).toBeNull();
  });

  test("a search with no matches (initialJobList: null) is zero results, not an error", () => {
    expect(parseSearchPage(searchPage(null))).toEqual({ cards: [], total: 0, totalPages: 0 });
  });

  test("a page without the __NEXT_DATA__ payload throws instead of reporting zero jobs", () => {
    expect(() => parseSearchPage("<html><body>Bakım çalışması</body></html>")).toThrow(/__NEXT_DATA__/);
  });
});

describe("parseJobDetail", () => {
  test("maps the detail payload, including dates, deadline and criteria", () => {
    const job = parseJobDetail(detailPage(), "frontend-developer-4500001");
    expect(job).not.toBeNull();
    expect(job).toMatchObject({
      id: "frontend-developer-4500001",
      title: "Frontend Developer",
      company: "Örnek Yazılım A.Ş.",
      location: "İstanbul(Avr.) / Türkiye",
      otherLocations: ["Ankara / Türkiye"],
      date: "2026-11-02",
      deadline: "2099-12-01",
      workplace: "Hibrit",
      employmentType: "Tam Zamanlı",
      experience: "Deneyim: 2-4 Yıl",
      positionLevel: null,
      skills: ["React", "TypeScript"],
      languages: ["İngilizce"],
      description: "React ve TypeScript deneyimi.",
      isActive: true,
    });
  });

  test("a completed, disabled or past-deadline posting is not active", () => {
    for (const overrides of [{ isCompleted: true }, { isDisabledJob: true }, { endDate: "2020-01-01T00:00:00.000Z" }]) {
      expect(parseJobDetail(detailPage(detailHead(overrides)), "x-1234")?.isActive).toBe(false);
    }
  });

  test("an unknown slug that redirected to the job list is not parsed as a posting", () => {
    expect(parseJobDetail(searchPage([listItem()]), "bogus-job-0000001")).toBeNull();
    expect(parseJobDetail("<html></html>", "bogus-job-0000001")).toBeNull();
  });
});

describe("htmlToText", () => {
  test("keeps paragraph and list structure and decodes entities once", () => {
    const text = htmlToText(
      "<p><strong>Aranan Nitelikler</strong></p><ul><li><p>React &amp; Next.js</p></li><li>Figma&nbsp;bilgisi</li></ul><p>&amp;lt;b&amp;gt; kalır &ccedil;&ouml;z&uuml;m &#8211; &#x2713;</p>",
    );
    expect(text).toBe("Aranan Nitelikler\n• React & Next.js\n• Figma bilgisi\n\n&lt;b&gt; kalır çözüm – ✓");
  });
});

describe("normalizeId", () => {
  test("accepts a slug or a Techcareer detail URL", () => {
    expect(normalizeId("back-end-developer-4491449")).toBe("back-end-developer-4491449");
    expect(normalizeId("mid.-software-engineer-4577524")).toBe("mid.-software-engineer-4577524");
    expect(normalizeId("https://www.techcareer.net/jobs/detail/back-end-developer-4491449")).toBe("back-end-developer-4491449");
    expect(normalizeId("techcareer.net/en/jobs/detail/back-end-developer-4491449/")).toBe("back-end-developer-4491449");
  });

  test("rejects other hosts, look-alikes, bare numbers and non-detail paths", () => {
    for (const input of [
      "https://evil.io/jobs/detail/back-end-developer-4491449",
      "https://www.techcareer.net.evil.io/jobs/detail/back-end-developer-4491449",
      "https://www.techcareer.net@evil.io/jobs/detail/back-end-developer-4491449",
      "https://www.techcareer.net/jobs",
      "4491449",
      "frontend",
      "",
    ]) {
      expect(normalizeId(input)).toBeNull();
    }
  });
});

describe("buildSearchUrl", () => {
  test("encodes keyword, location and page as the portal's bracketed params", () => {
    const url = new URL(buildSearchUrl({ query: "frontend developer", location: "İzmir", page: 2 }));
    expect(url.origin + url.pathname).toBe("https://www.techcareer.net/jobs");
    expect(url.searchParams.get("jobs[search][keyword]")).toBe("frontend developer");
    expect(url.searchParams.get("jobs[search][location]")).toBe("İzmir");
    expect(url.searchParams.get("jobs[page]")).toBe("2");
  });

  test("omits keyword and location when unset", () => {
    const url = new URL(buildSearchUrl({ page: 1 }));
    expect([...url.searchParams.keys()]).toEqual(["jobs[page]"]);
  });
});
