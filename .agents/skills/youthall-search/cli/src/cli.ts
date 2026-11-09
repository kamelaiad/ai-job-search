#!/usr/bin/env bun
// Self-contained CLI for searching Youthall (www.youthall.com), Türkiye's
// career platform for students and new graduates: internships, new-graduate
// and early-career jobs at large companies. No external CLI framework and no
// runtime dependencies, so it runs anywhere `bun` is available.
//
// Personal use, low volume. robots.txt allows the public listing and posting
// pages; Youthall's user agreement forbids putting disproportionate load on
// the site, so keep request volume low and don't republish the listings.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { LISTING_TYPES, citySlug } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", t: "type" }
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

const HELP = `youthall-cli — search internships and early-career jobs on Youthall (Türkiye)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (position, company or keyword), Turkish or English,
                          e.g. "tasarım", "yazılım", "marketing". Optional.
  --location, -l <city>   Turkish city, e.g. "İstanbul", "Ankara", "İzmir", "Bursa".
                          Maps to Youthall's city page (/tr/is-ilanlari/<city>/).
  --type, -t <types>      Comma-separated listing types: ${Object.keys(LISTING_TYPES).join(", ")}.
  --page <n>              1-indexed page (18 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

  --jobage is not supported: Youthall's result cards show only the application
  deadline, not the posting date, and the site has no posting-age filter. Every
  listed posting is still open (expired ones are removed). Use \`detail\` for the
  posting date.

EXAMPLES
  bun run src/cli.ts search -q "tasarım" --format table
  bun run src/cli.ts search -q "yazılım" -l "İstanbul" --type internship --format table
  bun run src/cli.ts search -l "Ankara" --type new_graduated,full_time --format table
  bun run src/cli.ts detail "AcmeTR/ui-ux-tasarim-stajyeri_12" --format plain

Personal use, low volume — see SKILL.md.
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases before validation). "help"/"h" pass so `search --help` still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "type", "page", "limit", "format", "help", "h"]),
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
      "--jobage is not supported by youthall-search: result cards carry only the application deadline, and Youthall has no posting-age filter. Every listed posting is open; use `detail <id>` for the posting date",
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
    if (typeof flags.query === "string" && flags.query.trim().length > 180) {
      return fail("--query is limited to 180 characters by Youthall's search box", "BAD_ARG")
    }
    if (flags.location !== undefined) {
      if (typeof flags.location !== "string" || !flags.location.trim() || !citySlug(flags.location)) {
        return fail('--location requires a city name, e.g. -l "İstanbul"', "BAD_ARG")
      }
    }
    let types: string[] | undefined
    if (flags.type !== undefined) {
      if (typeof flags.type !== "string" || !flags.type.trim()) {
        return fail(`--type requires a value: ${Object.keys(LISTING_TYPES).join(", ")}`, "BAD_ARG")
      }
      types = flags.type.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
      const bad = types.filter((t) => !(t in LISTING_TYPES))
      if (bad.length > 0 || types.length === 0) {
        return fail(
          `--type must be one or more of ${Object.keys(LISTING_TYPES).join(", ")} (comma-separated), got "${flags.type}"`,
          "BAD_ARG",
        )
      }
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
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      types,
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
