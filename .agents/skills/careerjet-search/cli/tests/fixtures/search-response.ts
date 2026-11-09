// SYNTHETIC fixture - not a live capture. It follows the v4 response shape
// documented at https://www.careerjet.com/partners/api (read 2026-11-09):
// { type: "JOBS", hits, message, pages, response_time, jobs: [{ title, company,
// date, description, locations, salary, salary_currency_code, salary_max,
// salary_min, salary_type, url }] }. No API key was available when the skill
// was built, so the companies, URLs and texts below are invented placeholders.
// Dates are generated relative to `now` so --jobage tests do not rot.

/** RFC-1123 date like the documented example, which has no space after the comma ("Wed,15 Nov 2025 ..."). */
export function apiDate(daysAgo: number, now = Date.now()): string {
  return new Date(now - daysAgo * 86_400_000).toUTCString().replace(", ", ",");
}

export function searchResponse(now = Date.now()) {
  return {
    type: "JOBS",
    hits: 57,
    message: "57 matching jobs found",
    pages: 3,
    response_time: 0.21,
    jobs: [
      {
        title: "<b>Web Developer</b> (PHP / Laravel)",
        company: "Örnek Yazılım A.Ş.",
        date: apiDate(1, now),
        description:
          "Bursa ofisimiz için <b>web developer</b> arıyoruz.<br>Gereksinimler:<ul><li>3+ yıl PHP deneyimi</li><li>Vue.js veya React</li></ul>",
        locations: "Nilüfer, Bursa",
        salary: "",
        salary_currency_code: "",
        salary_max: null,
        salary_min: null,
        salary_type: "",
        url: "https://jobviewtrack.com/v2/example-0001",
      },
      {
        title: "Front-End Geli&#351;tirici &amp; UI Developer",
        company: "Deneme Teknoloji &amp; Danışmanlık",
        date: apiDate(20, now),
        description: "<p>React ve TypeScript ile &ccedil;alışacak ekip arkadaşı.</p><p>Hibrit çalışma.</p>",
        locations: "İstanbul",
        salary: "40.000 TL - 55.000 TL",
        salary_currency_code: "TRY",
        salary_max: 55000,
        salary_min: 40000,
        salary_type: "M",
        url: "https://jobviewtrack.com/v2/example-0002",
      },
      // Malformed: no title -> skipped, the rest survive.
      { title: null, company: "Eksik Başlık Ltd.", url: "https://jobviewtrack.com/v2/example-0003" },
      // Malformed: no usable URL -> skipped.
      { title: "Backend Developer", company: "URL'siz Şirket", url: "javascript:alert(1)" },
      // Not even an object -> skipped.
      "garbage",
      // Missing optional fields -> null, never omitted.
      {
        title: "Full Stack Developer",
        url: "https://jobviewtrack.com/v2/example-0004",
      },
      // Exact duplicate of the first job -> deduplicated by id.
      {
        title: "<b>Web Developer</b> (PHP / Laravel)",
        company: "Örnek Yazılım A.Ş.",
        date: apiDate(1, now),
        description: "duplicate",
        locations: "Nilüfer, Bursa",
        url: "https://jobviewtrack.com/v2/example-0001-dup",
      },
    ],
  };
}

export const LOCATIONS_RESPONSE = {
  type: "LOCATIONS",
  locations: ["Merkez, Bursa", "Merkez, Ankara"],
  message: "multiple locations found",
  response_time: 0.11,
};
