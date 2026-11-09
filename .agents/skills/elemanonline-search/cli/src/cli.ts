#!/usr/bin/env bun
// Self-contained CLI for searching jobs on elemanonline.com.tr (Turkey). No
// external CLI framework, so it runs anywhere `bun` is available with zero
// install beyond the repo clone.
//
// Personal use only. robots.txt allows all paths, but the site's terms forbid
// copying or redistributing its content without written permission: keep
// volume low and do not use it commercially or for bulk data collection.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { turkishSlug } from "./helpers.js"

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

const HELP = `elemanonline-cli — search jobs on elemanonline.com.tr (Turkey)

USAGE
  bun run src/cli.ts search [--query "<text>"] [--location "<city>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS (at least one of --query / --location is required)
  --query, -q <text>      Keywords (job title, skill or role), e.g. "grafik tasarım".
  --location, -l <city>   Turkish province, e.g. "İstanbul", "Bursa", "Ankara", "İzmir",
                          "İstanbul Avrupa", "İstanbul Anadolu". Unknown names exit 1.
  --jobage <days>         Posted within N days (e.g. 1, 3, 7, 30). Default: all.
  --page <n>              1-indexed page (10 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "grafik tasarım" -l "Bursa" --format table
  bun run src/cli.ts search -q "web tasarım" -l "İstanbul" --jobage 30 --format table
  bun run src/cli.ts search -q "ui ux" -l "Ankara" --format table
  bun run src/cli.ts detail 6ad5d48e4701e9810bc4a09d --format plain

Personal use only — keep volume low (elemanonline.com.tr terms of use).
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "page", "limit", "format", "help", "h"]),
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
    // A present flag needs a value: parseFlags stores a bare -q as true and
    // -q "" as "", and treating either as unset would widen the search.
    for (const name of ["query", "location"]) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return fail(`--${name} requires a non-empty value`, "BAD_ARG")
      }
    }
    const query = typeof flags.query === "string" ? flags.query.trim() : undefined
    const location = typeof flags.location === "string" ? flags.location.trim() : undefined
    if (!query && !location) {
      return fail(
        'pass --query and/or --location (e.g. -q "grafik tasarım" -l "Bursa") - an empty search would list the whole board',
        "NO_QUERY",
      )
    }
    if (location && !turkishSlug(location)) {
      return fail(`--location "${location}" has no letters or digits`, "BAD_ARG")
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }

    const parseIntFlag = (name: string): number | null | undefined => {
      const raw = flags[name]
      if (raw === undefined) return undefined
      // Number(), not parseInt(): parseInt truncates "0.5" to 0. Whole
      // numbers >= 1 only, matching the other portal CLIs.
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
        return null
      }
      return val
    }
    const jobage = parseIntFlag("jobage")
    if (jobage === null) return 1
    const page = parseIntFlag("page")
    if (page === null) return 1
    const limit = parseIntFlag("limit")
    if (limit === null) return 1

    const opts: SearchOpts = {
      query,
      location,
      jobage,
      page: page ?? 1,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <id|url>", "NO_ID")
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
