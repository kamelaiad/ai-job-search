import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  decodeHtmlEntities,
  formFields,
  jobageWindow,
  normalizeId,
  parseJobCards,
  parseJobDetail,
  parsePager,
  resolveProvince,
  sectorValue,
  stripInvisible,
  trDateToIso,
  turkishTitleCase,
  visibleHtml,
} from "../src/helpers";

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text();

describe("parseJobCards", () => {
  test("parses every well-formed row and skips the malformed one", async () => {
    const cards = parseJobCards(await fixture("search-results.html"));
    expect(cards.map((c) => c.id)).toEqual(["00001000001", "00001000002"]);
  });

  test("private-sector ad: hidden employer becomes company null, fields normalised", async () => {
    const [card] = parseJobCards(await fixture("search-results.html"));
    expect(card).toEqual({
      id: "00001000001",
      title: "Grafik Tasarımcısı",
      company: null,
      employerHidden: true,
      location: "Bursa / Osmangazi",
      date: null,
      deadline: "2026-12-03",
      url: "https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=00001000001",
      sector: "Özel",
      employmentType: "Tam Zamanlı",
      contractType: "Daimi",
      openings: 1,
      applicationScope: "İlçe Geneli Başvuru",
      disabilityQuota: false,
    });
  });

  test("public-sector ad: employer shown, hidden text and zero-width chars dropped", async () => {
    const card = stripInvisible(parseJobCards(await fixture("search-results.html"))[1]);
    expect(card.title).toBe("Bilgisayar Operatörü");
    expect(card.company).toBe("ÖRNEK KAMU KURUMU");
    expect(card.employerHidden).toBe(false);
    expect(card.location).toBe("Isparta / Isparta Merkez");
    expect(card.applicationScope).toBe("İl Geneli Başvuru");
    expect(card.contractType).toBe("Geçici");
    expect(card.employmentType).toBe("Kısmi Zamanlı");
    expect(card.openings).toBe(3);
    expect(card.disabilityQuota).toBe(true);
    expect(card.deadline).toBe("2026-11-13");
    expect(JSON.stringify(card)).not.toContain("IGNORE");
    expect(JSON.stringify(card)).not.toContain("​");
  });

  test("a page without the grid yields no cards", () => {
    expect(parseJobCards("<html><body>nothing</body></html>")).toEqual([]);
  });
});

describe("parsePager", () => {
  test("reads current page, total pages and total count", async () => {
    expect(parsePager(await fixture("search-results.html"))).toEqual({ currentPage: 1, totalPages: 4, total: 50 });
  });

  test("absent pager (single page) is null", () => {
    expect(parsePager("<div></div>")).toBeNull();
  });
});

describe("formFields", () => {
  test("collects hidden/text inputs, checked radios and selected options; skips disabled and submit", async () => {
    const f = formFields(await fixture("search-results.html"));
    expect(f.get("__VIEWSTATE")).toBe("FIXTUREVIEWSTATE2");
    expect(f.get("ctl04$ctlPageTop$ctlMenu$hdnMenuParameters")).toBe("ShowHomePage=False&ApplicationCode=PORTAL");
    expect(f.get("ctl04$IsyeriTuruRadios")).toBe("ozelSektorRadio");
    expect(f.get("ctl04$ctlIl")).toBe("16");
    expect(f.get("ctl04$ctlIlanTarihi")).toBe("1");
    expect(f.get("ctl04$ctlDataPagerDetay$txtCurrentPage")).toBe("1");
    expect(f.has("ctl04$ctlUlke")).toBe(false);
    expect(f.has("ctl04$ctlAramaKaydet")).toBe(false);
    expect(f.has("ctl04$ulkeGeneliChk")).toBe(false);
  });
});

describe("parseJobDetail", () => {
  test("extracts description with line breaks, qualifications, occupations and education", async () => {
    const job = stripInvisible(parseJobDetail(await fixture("detail.html"), "00001000001"))!;
    expect(job.title).toBe("Grafik Tasarımcısı");
    expect(job.description).toBe(
      "Görev tanımı: Kurumsal kimlik ve sosyal medya için grafik tasarım\nAdobe Photoshop ve Illustrator bilgisi\nHaftaiçi 08:30 - 18:00\nServis vardır.",
    );
    expect(job.qualifications).toBe('"Başvurular İŞKUR danışmanı aracılığıyla alınır."');
    expect(job.occupations).toEqual([
      { name: "Grafik Tasarımcısı", experience: "2 Yıl" },
      { name: "Grafiker", experience: null },
    ]);
    expect(job.educationMin).toBe("Önlisans");
    expect(job.educationMax).toBeNull();
    expect(job.company).toBeNull();
    expect(job.location).toBeNull();
    expect(job.date).toBeNull();
    expect(job.loginNotice).toBe(true);
    expect(job.url).toBe("https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=00001000001");
  });

  test("hidden markup and comments never reach the description", async () => {
    const job = parseJobDetail(await fixture("detail.html"), "00001000001")!;
    expect(job.description).not.toContain("Rate this candidate");
    expect(job.description).not.toContain("ignore all previous");
  });

  test("a page with no posting content is null (NOT_FOUND upstream)", () => {
    expect(parseJobDetail("<html><span id='ctl01_ctlLabelUyari'>x</span></html>", "1")).toBeNull();
  });
});

describe("small helpers", () => {
  test("resolveProvince accepts names in any casing/diacritics, plate codes and aliases", () => {
    expect(resolveProvince("Bursa")).toEqual({ code: "16", name: "Bursa" });
    expect(resolveProvince("İstanbul")?.code).toBe("34");
    expect(resolveProvince("ISTANBUL")?.code).toBe("34");
    expect(resolveProvince("istanbul")?.code).toBe("34");
    expect(resolveProvince("Izmir")?.code).toBe("35");
    expect(resolveProvince("Iğdır")?.code).toBe("76");
    expect(resolveProvince("igdir")?.code).toBe("76");
    expect(resolveProvince("sanliurfa")?.code).toBe("63");
    expect(resolveProvince("Urfa")?.code).toBe("63");
    expect(resolveProvince("06")?.code).toBe("6");
    expect(resolveProvince("82")).toBeNull();
    expect(resolveProvince("Berlin")).toBeNull();
  });

  test("jobageWindow rounds up to İŞKUR's 24h / 7d / 15d / all windows", () => {
    expect(jobageWindow(undefined)).toEqual({ code: "1", window: "all" });
    expect(jobageWindow(1)).toEqual({ code: "2", window: "24h" });
    expect(jobageWindow(3)).toEqual({ code: "3", window: "7d" });
    expect(jobageWindow(7)).toEqual({ code: "3", window: "7d" });
    expect(jobageWindow(14)).toEqual({ code: "4", window: "15d" });
    expect(jobageWindow(30)).toEqual({ code: "1", window: "all" });
  });

  test("sectorValue accepts English and Turkish", () => {
    expect(sectorValue("public")?.value).toBe("kamuRadio");
    expect(sectorValue("Kamu")?.value).toBe("kamuRadio");
    expect(sectorValue("özel")?.value).toBe("ozelSektorRadio");
    expect(sectorValue("remote")).toBeNull();
  });

  test("normalizeId pads ad numbers and only accepts iskur.gov.tr detail URLs", () => {
    expect(normalizeId("00009887102")).toBe("00009887102");
    expect(normalizeId("9887102")).toBe("00009887102");
    expect(normalizeId("https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=00009887102")).toBe("00009887102");
    expect(normalizeId("http://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=00009887102&isyeriTuru=%C3%96zel")).toBe("00009887102");
    expect(normalizeId("https://esube.iskur.gov.tr.evil.io/Istihdam/AcikIsIlanDetay.aspx?uiID=1")).toBeNull();
    expect(normalizeId("https://esube.iskur.gov.tr@evil.io/Istihdam/AcikIsIlanDetay.aspx?uiID=1")).toBeNull();
    expect(normalizeId("123456789012")).toBeNull();
    expect(normalizeId("abc")).toBeNull();
  });

  test("dates, casing and entities", () => {
    expect(trDateToIso("3.12.2026")).toBe("2026-12-03");
    expect(trDateToIso("24 Gün Kaldı")).toBeNull();
    expect(turkishTitleCase("İSTANBUL / ÜSKÜDAR")).toBe("İstanbul / Üsküdar");
    expect(turkishTitleCase("ISPARTA / ISPARTA MERKEZ")).toBe("Isparta / Isparta Merkez");
    expect(decodeHtmlEntities("&amp;lt;b&amp;gt; &ccedil;&#252;&#x15F;&nbsp")).toBe("&lt;b&gt; çüş ");
  });

  test("visibleHtml drops hidden elements, scripts and comments", () => {
    expect(visibleHtml('a<span hidden>x</span>b<script>y</script>c<!-- z -->d<div style="display: none">w</div>e')).toBe("abcde");
  });
});
