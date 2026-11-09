// Synthetic Techcareer pages for offline tests. The shapes mirror the live
// `__NEXT_DATA__` payload recorded in url-reference.md (2026-11-09); the
// companies and postings are invented.

export function nextDataPage(page: string, pageProps: unknown, query: Record<string, unknown> = {}): string {
  // Escaped the way Next.js's htmlEscapeJsonString does, so markup inside the
  // payload (descriptions are HTML) cannot close the <script> element.
  const payload = JSON.stringify({ props: { pageProps }, page, query, buildId: "test" })
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
  return `<!DOCTYPE html><html lang="tr-TR"><head><title>Techcareer</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${payload}</script></body></html>`
}

export function listItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 101,
    title: "Frontend Developer",
    isCompanyHidden: null,
    hiddenCompanyInfo: "",
    isDisabledJob: false,
    isAllLocationsSelected: false,
    slug: "frontend-developer-4500001",
    workPlaces: ["Hibrit"],
    jobTitle: "Front-End Geliştirici",
    jobTitleEn: "Front-End Developer",
    jobTitleSlug: "front-end-gelistirici",
    jobTitleId: 1,
    applyLink: "",
    location: "İstanbul(Avr.) / Türkiye",
    otherLocations: 0,
    owner: { name: "Örnek Yazılım A.Ş.", logo: "", isCompanyHidden: null },
    ...overrides,
  }
}

export function searchPage(items: unknown[] | null, pagination = { page: 1, pageCount: 1, pageSize: 20, total: items?.length ?? 0 }): string {
  return nextDataPage("/jobs", {
    initialJobList: items === null ? null : { jobListItems: items, pagination },
    searchAndFilterQuery: {},
  })
}

export function detailHead(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 101,
    hidden: false,
    title: "Frontend Developer",
    isDisabledJob: false,
    isCompanyHidden: null,
    hiddenCompanyInfo: "",
    slug: "frontend-developer-4500001",
    isCompleted: false,
    isDraftJob: false,
    startDate: "2026-11-02T00:00:00.000Z",
    endDate: "2099-12-01T00:00:00.000Z",
    applyLink: null,
    workPlaces: ["Hibrit"],
    typeOfWorks: ["Tam Zamanlı"],
    yearsOfExperiences: ["Deneyim: 2-4 Yıl"],
    positionLevels: [],
    jobTitle: "Front-End Geliştirici",
    location: "İstanbul(Avr.) / Türkiye",
    otherLocations: ["Ankara / Türkiye"],
    company: { name: "Örnek Yazılım A.Ş.", logo: "", slug: "ornek-yazilim-1" },
    ...overrides,
  }
}

export function detailPage(head: Record<string, unknown> = detailHead(), description = "<p>React ve TypeScript deneyimi.</p>"): string {
  return nextDataPage(
    "/jobs/detail/[jobSlug]",
    {
      jobDetail: {
        head,
        content: { description, skills: ["React", "TypeScript"], educationLevels: [], languages: ["İngilizce"] },
        owner: { name: "Örnek Yazılım A.Ş.", description: "<p>Şirket tanıtımı</p>" },
      },
    },
    { jobSlug: head.slug },
  )
}
