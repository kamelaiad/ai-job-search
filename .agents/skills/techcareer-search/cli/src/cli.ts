#!/usr/bin/env bun
// Self-contained CLI for searching tech jobs on Techcareer.net (Türkiye),
// the tech-career platform launched by Kariyer.net. Reads the public,
// server-rendered job pages; no authentication, no API key and no external
// CLI framework, so it runs anywhere `bun` is available.
//
// Keep volume low: this is for an individual's own job search, not bulk
// collection.

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

const HELP = `techcareer-cli — search tech jobs on Techcareer.net (Türkiye)

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [-l "<city>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill or role), e.g. "frontend developer".
                          Omit to list every open posting, newest first.
  --location, -l <text>   City, e.g. "İstanbul", "Ankara", "İzmir", "Bursa".
  --page <n>              1-indexed page (20 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

  --jobage is not supported: Techcareer has no posting-age filter and its search
  results carry no date. Results come newest first; 'detail' gives each posting's
  publication date and deadline.

EXAMPLES
  bun run src/cli.ts search -q "frontend developer" --format table
  bun run src/cli.ts search -q "web developer" -l "İstanbul" --format table
  bun run src/cli.ts search -q "UI/UX designer" -l "Ankara" --limit 5
  bun run src/cli.ts search -l "İzmir" --page 2 --format table
  bun run src/cli.ts detail back-end-developer-4491449 --format plain

Keep volume low: personal job search only.
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "page", "limit", "format", "help", "h"]),
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

  // The contract's recency flag gets its own error: the portal has nothing to
  // map it to, and silently dropping it would return old postings as fresh.
  if (cmd === "search" && (flags.jobage !== undefined || flags["jobage-minutes"] !== undefined)) {
    return fail(
      "--jobage is not supported: Techcareer has no posting-age filter and its search results carry no date. Results are listed newest first; use 'detail <id>' for a posting's publication date and deadline",
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
    // Both are optional, but a present one needs a value: parseFlags stores a
    // bare -q as true and -q "" as "", and treating either as unset would list
    // every posting as if it matched.
    for (const name of ["query", "location"]) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !v.trim())) {
        return fail(`--${name} requires a non-empty value`, "BAD_ARG")
      }
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }

    // Number(), not parseInt(): parseInt truncates, so "--page 1.5" would
    // quietly become 1. Whole numbers >= 1 only, matching the other portal CLIs.
    const intFlag = (name: string): number | null | undefined => {
      const raw = flags[name]
      if (raw === undefined) return undefined
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
        return null
      }
      return val
    }
    const page = intFlag("page")
    if (page === null) return 1
    const limit = intFlag("limit")
    if (limit === null) return 1

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
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
