#!/usr/bin/env bun
// Self-contained CLI for searching jobs on kariyer.net (Türkiye). Reads the
// site's public, server-rendered search and posting pages. No external CLI
// framework and zero runtime dependencies, so it runs anywhere `bun` is
// available.
//
// Personal use only. Keep volume low: a handful of searches, not a crawl. Do
// not use it commercially or for bulk data collection. Run it on your own
// responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { resolveLocation, workModelParam } from "./helpers.js"

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

const HELP = `kariyer-cli — search jobs on kariyer.net (Türkiye)

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts search --location "<city>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS (at least one of --query / --location)
  --query, -q <text>      Keywords (job title, skill, company), e.g. "web developer".
  --location, -l <city>   Turkish province name, e.g. "Bursa", "İstanbul", "Ankara", "İzmir".
                          "İstanbul Avrupa" / "İstanbul Anadolu" pick one side; several
                          cities comma-separated ("Bursa,Kocaeli"). Diacritics optional.
  --jobage <days>         Posted/updated within N days. The site filters in windows
                          (today, 3, 7, 15 days); the CLI cuts to exactly N.
  --remote <mode>         remote | hybrid | onsite. Filter by work model.
  --page <n>              1-indexed page (50 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "web developer" -l "Bursa" --format table
  bun run src/cli.ts search -q "frontend developer" -l "İstanbul" --jobage 7 --format table
  bun run src/cli.ts search -q "UI/UX designer" --remote remote --format table
  bun run src/cli.ts search -q "grafik tasarımcı" -l "İzmir" --format table
  bun run src/cli.ts detail 4520391 --format plain

Personal use only — keep volume low; no commercial or bulk use.
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "remote", "page", "limit", "format", "help", "h"]),
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
  // filter changes what the search returns with no error. add-portal.md's
  // contract requires a bogus flag to exit 1 with a JSON error on stderr.
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
    // flag as true, and treating that as unset would search all of Türkiye.
    for (const name of ["query", "location"]) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return fail(`--${name} requires a non-empty value`, "BAD_ARG")
      }
    }
    const query = typeof flags.query === "string" ? flags.query.trim() : undefined
    const location = typeof flags.location === "string" ? flags.location : undefined
    if (!query && !location) {
      return fail('search needs --query and/or --location (e.g. -q "web developer" -l "Bursa")', "MISSING_REQUIRED")
    }

    let cityIds: string | undefined
    if (location) {
      const resolved = resolveLocation(location)
      if (!resolved) {
        return fail(
          `unknown --location "${location}": use a Turkish province name (e.g. "Bursa", "İstanbul", "İstanbul Anadolu", "Ankara", "İzmir") or comma-separate several`,
          "BAD_ARG",
        )
      }
      cityIds = resolved
    }

    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }

    if (flags.remote !== undefined && (typeof flags.remote !== "string" || workModelParam(flags.remote) === null)) {
      const got = typeof flags.remote === "string" ? `"${flags.remote}"` : "no value"
      return fail(`--remote must be one of remote|hybrid|onsite, got ${got}`, "BAD_ARG")
    }

    // Number(), not parseInt(): parseInt truncates, so "--jobage 0.5" would
    // become 0 and silently drop the filter. Whole numbers >= 1 only.
    const ints: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      const raw = flags[name]
      if (raw === undefined) continue
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        return fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
      }
      ints[name] = val
    }

    const opts: SearchOpts = {
      query,
      cityIds,
      jobage: ints.jobage,
      remote: typeof flags.remote === "string" ? flags.remote : undefined,
      page: ints.page ?? 1,
      limit: ints.limit,
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
