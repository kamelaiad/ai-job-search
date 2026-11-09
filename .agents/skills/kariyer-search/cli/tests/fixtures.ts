// Synthetic kariyer.net markup, modelled on the live server render (Vue SSR,
// November 2026): same `data-test` anchors and card attributes, fictional
// companies and postings. See ../../url-reference.md for the real anchors.

export interface CardSpec {
  id: string
  slug?: string
  title: string
  company?: string
  location?: string // omitted => no location span (remote cards)
  cityName?: string
  cityCount?: number
  workModel?: string
  workType?: string
  time?: string
  sponsored?: boolean
  extraAttrs?: string
}

export function card(spec: CardSpec): string {
  const objs = Array(spec.cityCount ?? 1).fill("[object Object]").join(",")
  const sponsor = spec.sponsored ? ' sponsor="true" isRealSponsored="true"' : ""
  const loc = spec.location
    ? `<span data-test="location" class="location" data-v-bc2b9780>${spec.location}</span> <span class="dot"></span> `
    : "<!----> <!----> "
  const company = spec.company === undefined ? "" : `<div data-test="subtitle-section" class="subtitle"><span data-test="subtitle" data-v-bc2b9780>${spec.company}</span></div>`
  return `<div data-test="list-items" class="list-items"><!----> <div data-test="ad-card" time="${spec.time ?? "4 gün"}"${sponsor} jobStatus="Default" locations="${objs}" workModelText="${spec.workModel ?? "Hibrit"}" workTypeText="${spec.workType ?? "Tam zamanlı"}" countryName="Türkiye" cityId="16" cityName="${spec.cityName ?? "Bursa"}"${spec.extraAttrs ?? ""} class="job-list-card-item" data-v-bc2b9780><div data-v-bc2b9780><a href="/is-ilani/${spec.slug ?? "ornek-yazilim-a-s-web-developer"}-${spec.id}" target="_blank" data-test="ad-card-item" class="k-ad-card radius"><!----> <div data-test="ad-card-top" class="card-top"><div data-test="title-wrapper" class="title-wrapper"><div class="title-left"><span data-test="ad-card-title" class="k-ad-card-title multiline" data-v-bc2b9780>${spec.title}</span></div> ${company} <div data-test="job-detail" class="job-detail">${loc}<span data-test="work-model" class="work-model">${spec.workModel ?? "Hibrit"}</span></div></div></div> <div class="card-footer-wrapper"><div data-test="ad-date" class="ad-date"><span data-test="ad-date-item-date-other" class="date date-other"><i class="kariyer-icons update-icon">update</i> ${spec.time ?? "4 gün"}</span></div></div></a></div></div></div>`
}

export function searchPage(cards: string[], opts: { nextPage?: number } = {}): string {
  const next = opts.nextPage
    ? `<li class="page-item"><a aria-label="Go to page ${opts.nextPage}" href="/is-ilanlari?kw=web+developer&amp;cp=${opts.nextPage}" class="page-link">${opts.nextPage}</a></li>`
    : ""
  return `<!doctype html><html><head><script data-n-head="ssr" type="application/ld+json">{"@type":"BreadcrumbList"}</script></head><body><div class="list-items-wrapper">${cards.join("")}</div><ul class="pagination"><li class="page-item active"><a aria-label="Go to page 1" href="/is-ilanlari?kw=web+developer&amp;cp=1" class="page-link">1</a></li>${next}</ul><script>window.__NUXT__=(function(a){return {}}(1));</script></body></html>`
}

export interface DetailSpec {
  title?: string
  description?: string
  isActive?: string
  closingDate?: string
  lastPublishDate?: string
}

export function detailPage(spec: DetailSpec = {}): string {
  const description =
    spec.description ??
    `<p class="x_MsoNormal"><strong>Örnek Yazılım A.Ş.</strong>&nbsp;olarak ekibimize <strong>&ldquo;Web Developer&rdquo;</strong> arıyoruz.</p><p><strong>Aranan Nitelikler</strong></p><ul><li>HTML5, CSS3 &amp; JavaScript</li><li>React veya Vue deneyimi</li></ul><p>Bursa ofisimizde &ccedil;alışacak.<br>Hibrit çalışma.</p>`
  return `<!doctype html><html><body><section class="job-detail-body"><div workType="Tam Zamanlı" positionLevel="Uzman" experienceLevel="2 - 5 yıl arası" departmentName="Bilgi Teknolojileri / IT" applicationCount="120" workModelText="Hibrit" class="headline-top-box" data-v-1><div class="headline-top"><h1 class="title mb-0"><div autoresize="" tag="p" data-test="job-title" class="vue-clamp job-title">
          ${spec.title ?? "Web Developer"}
        </div> <div autoresize="" class="vue-clamp"><a href="https://www.kariyer.net/firma-profil/ornek-yazilim-a-s-1-2" target="_blank" data-test="company-name" class="company-name">
            Örnek Yazılım A.Ş.
          </a></div></h1></div><div class="company-location"><span data-test="company-location">
          Bursa (Nilüfer)
        </span></div><div class="updated-date"><span data-test="updated-date" class="date-text">3 gün önce yayınlandı</span></div></div>
<div isActive="${spec.isActive ?? "true"}" versionId="1" closingDate="${spec.closingDate ?? "05.12.2026"}" lastPublishDate="${spec.lastPublishDate ?? "06.11.2026"}" class="job-container mt-3"><h2 data-test="qualifications-and-job-description-headline">İş İlanı Hakkında</h2><div class="job-detail-content fixed-height-container"><div data-test="qualifications-and-job-description" class="job-detail-qualifications">${description}</div> <div class="aligment-container my-3"><header><h2 data-test="alignment-list-header">Aday Kriterleri</h2></header> <section><div class="alignment-list"><div data-test="alignment-list-title" class="alignment-title"><span class="bullet">•</span> Tecrübe
        </div> <div data-test="alignment-list-value" class="alignment-value">
            2 - 5 yıl arası
          </div><div data-test="alignment-list-title" class="alignment-title"><span class="bullet">•</span> Eğitim Seviyesi
        </div> <div data-test="alignment-list-value" class="alignment-value">
            Üniversite(Mezun)
          </div></div></section></div></div></div></section></body></html>`
}
