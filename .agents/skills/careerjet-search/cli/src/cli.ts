#!/usr/bin/env bun
// Self-contained CLI for searching Careerjet Türkiye (careerjet.com.tr) job
// listings through Careerjet's official v4 search API. No external CLI
// framework and zero runtime dependencies: it runs anywhere `bun` is available.
//
// Needs a free Careerjet publisher API key in the CAREERJET_API_TOKEN
// environment variable (never a flag). Personal use only - keep volume low.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CONTRACT_CODES, HOURS_CODES, MAX_PAGE, SORT_VALUES, writeError } from "./helpers.js"

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

const HELP = `careerjet-cli — search Careerjet Türkiye (careerjet.com.tr) job listings via Careerjet's official API

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [-l "<city>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SETUP
  export CAREERJET_API_TOKEN=<your free Careerjet publisher API key>
  (sign up: https://www.careerjet.com.tr/partners/api — the key is never accepted as a flag)

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill, role), Turkish or English.
  --location, -l <text>   City or region in Türkiye, e.g. "Bursa", "İstanbul", "Ankara".
                          Omit for a country-wide search.
  --jobage <days>         Posted within N days (client-side filter on the fetched page;
                          also sorts by date unless --sort is given).
  --contract <type>       permanent | contract | temporary | internship | volunteer
  --hours <type>          full | part
  --sort <order>          relevance (default) | date | salary
  --page <n>              1-indexed page, 1-${MAX_PAGE} (20 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

DETAIL
  Returns the cached search excerpt (up to ~1500 chars) and the outbound URL for an id
  from a recent search. It makes no network request (no single-posting API exists, and
  careerjet.com.tr job pages are disallowed by robots.txt).

EXAMPLES
  bun run src/cli.ts search -q "web developer" -l "Bursa" --format table
  bun run src/cli.ts search -q "yazılım geliştirici" -l "İstanbul" --jobage 7 --format table
  bun run src/cli.ts search -q "UI/UX designer" -l "Ankara" --contract internship
  bun run src/cli.ts detail cj-0123456789abcdef --format plain

Personal use only — keep volume low; never automate clicks on result URLs (they are tracked).
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n to these before validation). "help"/"h" pass so `search --help`
// still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "contract", "hours", "sort", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function badArg(error: string): number {
  writeError(error, "BAD_ARG")
  return 1
}

/** Whole number >= min (and <= max if given), or null after writing a BAD_ARG error. */
function parseIntFlag(name: string, raw: string | boolean | string[], min = 1, max?: number): number | null {
  // Number(), not parseInt(): parseInt truncates "0.5" to 0 and "7days" to 7.
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < min || (max !== undefined && val > max)) {
    const range = max !== undefined ? `between ${min} and ${max}` : `of at least ${min}`
    badArg(`--${name} must be a whole number ${range}, got ${typeof raw === "string" ? `"${raw}"` : "no value"}`)
    return null
  }
  return val
}

/** A string flag restricted to a set of values, or null after writing a BAD_ARG error. */
function enumFlag(name: string, raw: string | boolean | string[] | undefined, allowed: string[]): string | null | undefined {
  if (raw === undefined) return undefined
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (!allowed.includes(v)) {
    badArg(`--${name} must be one of ${allowed.join("|")}, got ${typeof raw === "string" ? `"${raw}"` : "no value"}`)
    return null
  }
  return v
}

/** Optional text flag: absent is fine, but a present one needs a non-empty value. */
function textFlag(name: string, raw: string | boolean | string[] | undefined): string | null | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== "string" || !raw.trim()) {
    badArg(`--${name} requires a non-empty value`)
    return null
  }
  return raw.trim()
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
      writeError(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const query = textFlag("query", flags.query)
    if (query === null) return 1
    const location = textFlag("location", flags.location)
    if (location === null) return 1

    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return badArg(`--format must be one of json|table|plain, got "${fmt}"`)

    const contract = enumFlag("contract", flags.contract, Object.keys(CONTRACT_CODES))
    if (contract === null) return 1
    const hours = enumFlag("hours", flags.hours, Object.keys(HOURS_CODES))
    if (hours === null) return 1
    const sort = enumFlag("sort", flags.sort, [...SORT_VALUES])
    if (sort === null) return 1

    let jobage: number | undefined
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }
    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page, 1, MAX_PAGE)
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
      query,
      location,
      jobage,
      page,
      limit,
      contract,
      hours,
      sort,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      writeError("detail requires an <id|url> from search results", "NO_ID")
      return 1
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) return badArg(`--format must be one of json|plain, got "${fmt}"`)
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  writeError(`Unknown command "${cmd}"`, "BAD_CMD")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
