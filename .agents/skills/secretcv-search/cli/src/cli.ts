#!/usr/bin/env bun
// Self-contained CLI for searching jobs on secretcv.com (Turkey). No external
// CLI framework, so it runs anywhere `bun` is available with zero install.
//
// Personal use only. secretcv's robots.txt disallows its search form and
// query-string URLs (keyword, pagination, filters); this CLI reads only the
// path-based listing pages and posting pages robots.txt leaves open, one
// results page per search. Keep volume low and do not use it commercially or
// for bulk data collection. Run it on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

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

const HELP = `secretcv-cli — search jobs on secretcv.com (Turkey)

USAGE
  bun run src/cli.ts search -q "<keyword>" [-l "<city>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS (at least one of --query / --location)
  --query, -q <text>      Keyword or job title, e.g. "web tasarım", "grafik tasarımcı".
  --location, -l <text>   Turkish province, e.g. "İstanbul", "Bursa", "Ankara", "İzmir".
  --jobage <days>         Keep postings at most N days old (client-side, from the card's
                          relative date; months count as 30 days).
  --page <n>              Only 1 is accepted: secretcv paginates with ?sf=N, which its
                          robots.txt disallows.
  --limit, -n <n>         Cap results emitted (client-side; a page holds up to 20).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "web tasarım" --format table
  bun run src/cli.ts search -q "grafik tasarımcı" -l "İstanbul" --jobage 14 --format table
  bun run src/cli.ts search -l "Bursa" --limit 10
  bun run src/cli.ts detail acme-ltd/web-tasarimci-is-ilanlari-1880001 --format plain

Personal use only — reads only robots.txt-permitted pages, one page per search; keep volume low.
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
    // A present --query/--location needs a value: parseFlags stores a bare
    // flag as true, and treating that as unset would widen the search.
    for (const name of ["query", "location"]) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return fail(`--${name} requires a non-empty value`, "BAD_ARG")
      }
    }
    const query = typeof flags.query === "string" ? flags.query.trim() : undefined
    const location = typeof flags.location === "string" ? flags.location.trim() : undefined
    if (!query && !location) {
      return fail(
        'search needs --query/-q and/or --location/-l (e.g. -q "web tasarım" -l "İstanbul")',
        "NO_QUERY",
      )
    }

    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }

    const parsed: Record<string, number> = {}
    for (const name of ["jobage", "page", "limit"]) {
      const raw = flags[name]
      if (raw === undefined) continue
      // Number(), not parseInt(): parseInt truncates "0.5" to 0 and silently
      // drops the filter. Whole numbers >= 1 only, matching the other CLIs.
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        return fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
      }
      parsed[name] = val
    }
    if (parsed.page !== undefined && parsed.page > 1) {
      return fail(
        "secretcv paginates with ?sf=N, which its robots.txt disallows (Disallow: */?sf=*); only --page 1 is available - narrow the query or add --location instead",
        "PAGE_NOT_ALLOWED",
      )
    }

    const opts: SearchOpts = {
      query,
      location,
      jobage: parsed.jobage,
      page: 1,
      limit: parsed.limit,
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
