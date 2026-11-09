#!/usr/bin/env bun
// Self-contained CLI for searching İŞKUR's public job ads ("Açık İş İlanları")
// on e-Şube (esube.iskur.gov.tr), Türkiye's state employment agency. No external
// CLI framework and zero runtime dependencies: it runs anywhere `bun` is
// available.
//
// Keep volume low: this is a government service. Each search is 2 requests
// (3 for --page > 1), spaced about a second apart.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { resolveProvince, sectorValue } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `iskur-cli — search İŞKUR (Türkiye İş Kurumu) public job ads on e-Şube

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [-l "<province>"] [flags]
  bun run src/cli.ts detail <ilanNo|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords: position, occupation, skill or employer name
                          (e.g. "grafik tasarım", "web tasarım", "muhasebe").
  --location, -l <text>   Province (il) name or plate code, e.g. "Bursa", "İstanbul",
                          "Istanbul", "izmir", "Ankara", "16", "34". Province-level only;
                          the district shows up in each result's location. Default: all.
  --sector <s>            private (özel, default) | public (kamu). İŞKUR searches one
                          sector at a time.
  --jobage <days>         Posted within N days. İŞKUR only offers 24h / 1 week / 15 days,
                          so N rounds up to 1, 7 or 15; N > 15 means no age filter.
  --page <n>              1-indexed page (15 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "grafik tasarım" -l Bursa --format table
  bun run src/cli.ts search -q "web tasarım" -l İstanbul --jobage 7 --format table
  bun run src/cli.ts search -q "bilgisayar" -l Ankara --sector public --format table
  bun run src/cli.ts search -q "tasarım" -l 34 --page 2 --limit 5
  bun run src/cli.ts detail 00009887102 --format plain

Keep volume low — public government service; no login, employer names of
private-sector ads are hidden by İŞKUR (company: null).
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "sector", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }

  if (cmd === "search") {
    // --query is optional, but a present one needs keywords: a bare -q or
    // -q "" would otherwise return every ad as if it matched.
    if (flags.query !== undefined && (typeof flags.query !== "string" || !flags.query.trim())) {
      return fail("--query requires a non-empty value", "BAD_ARG")
    }

    let provinceCode: string | undefined
    let provinceName: string | undefined
    if (flags.location !== undefined) {
      if (typeof flags.location !== "string" || !flags.location.trim()) {
        return fail("--location requires a province name or plate code, e.g. -l Bursa or -l 16", "BAD_ARG")
      }
      const province = resolveProvince(flags.location)
      if (!province) {
        return fail(
          `unknown province "${flags.location}" - pass one of Türkiye's 81 provinces (il) by name or plate code, e.g. "İstanbul", "Ankara", "İzmir", "Bursa", "34"; districts are not a search filter`,
          "UNKNOWN_LOCATION",
        )
      }
      provinceCode = province.code
      provinceName = province.name
    }

    let sector = sectorValue("private")!
    if (flags.sector !== undefined) {
      const s = typeof flags.sector === "string" ? sectorValue(flags.sector) : null
      if (!s) {
        const got = typeof flags.sector === "string" ? `"${flags.sector}"` : "no value"
        return fail(`--sector must be one of private|public (özel|kamu), got ${got}`, "BAD_ARG")
      }
      sector = s
    }

    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }

    const intFlag = (name: string): number | null | undefined => {
      const raw = flags[name]
      if (raw === undefined) return undefined
      // Number(), not parseInt(): parseInt truncates "0.5" to 0 and would
      // silently drop the filter. Whole numbers >= 1 only.
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
        return null
      }
      return val
    }
    const jobage = intFlag("jobage")
    if (jobage === null) return 1
    const page = intFlag("page")
    if (page === null) return 1
    const limit = intFlag("limit")
    if (limit === null) return 1

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      provinceCode,
      provinceName,
      sector: sector.sector,
      sectorValue: sector.value,
      jobage,
      page: page ?? 1,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <ilanNo|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return fail(`Unknown command "${cmd}"`, "BAD_CMD")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
