#!/usr/bin/env bun
// Self-contained CLI for searching toptalent.co, a Türkiye early-career
// platform (internships, new-graduate and junior jobs). No external CLI
// framework and no runtime dependencies, so it runs anywhere `bun` is available.
//
// Personal use only. toptalent's terms forbid copying, reproducing,
// distributing or commercially using site content without permission, so keep
// volume low, read listings for your own job search, and don't republish them.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { LEVEL_IDS, resolveCities } from "./helpers.js"

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

const HELP = `toptalent-cli — search early-career jobs and internships on toptalent.co (Türkiye)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords matched against the posting, e.g. "grafik tasarım",
                          "yazılım", "intern". Optional.
  --location, -l <cities> Comma-separated Turkish cities, e.g. "İstanbul", "Ankara,İzmir",
                          "İstanbul Anadolu". Nationwide ("Tüm Türkiye") postings are
                          NOT returned when a city is set.
  --level <levels>        Comma-separated "who can apply" levels: ${Object.keys(LEVEL_IDS).join(", ")}.
  --page <n>              1-indexed page (9 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

  --jobage is not supported: result cards carry no posting date (only a
  "Son N Gün" deadline countdown) and the site has no posting-age filter. Use
  \`detail\` for the posting date.

EXAMPLES
  bun run src/cli.ts search -q "grafik tasarım" --format table
  bun run src/cli.ts search -q "yazılım" -l "İstanbul" --format table
  bun run src/cli.ts search --level new-grad -l "Ankara,İzmir" --format table
  bun run src/cli.ts detail acme-ui-ux-designer-121900 --format plain

Personal use only — see SKILL.md.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "level", "page", "limit", "format", "help", "h"]),
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

  if (cmd === "search" && (flags.jobage !== undefined || flags["jobage-minutes"] !== undefined)) {
    return fail(
      "--jobage is not supported by toptalent-search: result cards carry no posting date and toptalent has no posting-age filter; use `detail <id>` for the posting date",
      "UNSUPPORTED_FLAG",
    )
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
    if (flags.query !== undefined && (typeof flags.query !== "string" || !flags.query.trim())) {
      return fail("--query requires a non-empty value", "BAD_ARG")
    }

    let cityIds: number[] | undefined
    if (flags.location !== undefined) {
      if (typeof flags.location !== "string" || !flags.location.trim()) {
        return fail('--location requires a city name, e.g. -l "İstanbul"', "BAD_ARG")
      }
      const { ids, unknown } = resolveCities(flags.location)
      if (unknown.length > 0 || ids.length === 0) {
        return fail(
          `unknown city ${unknown.map((u) => `"${u}"`).join(", ") || `"${flags.location}"`} - use a Turkish province name such as "İstanbul", "Ankara", "İzmir", "Bursa", or "İstanbul Avrupa"/"İstanbul Anadolu"`,
          "UNKNOWN_LOCATION",
        )
      }
      cityIds = ids
    }

    let levelIds: number[] | undefined
    if (flags.level !== undefined) {
      const raw = typeof flags.level === "string" ? flags.level : ""
      const keys = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      const bad = keys.filter((k) => !(k in LEVEL_IDS))
      if (keys.length === 0 || bad.length > 0) {
        return fail(
          `--level must be one or more of ${Object.keys(LEVEL_IDS).join(", ")} (comma-separated), got "${raw || "no value"}"`,
          "BAD_ARG",
        )
      }
      levelIds = keys.map((k) => LEVEL_IDS[k].id)
    }

    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      // Number(), not parseInt(): parseInt truncates "1.5" to 1 silently.
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
        return null
      }
      return val
    }

    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = v
    }
    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      cityIds,
      levelIds,
      page,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      return fail("detail requires an <id|url>", "NO_ID")
    }
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
