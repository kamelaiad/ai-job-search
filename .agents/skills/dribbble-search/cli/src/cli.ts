#!/usr/bin/env bun
// Self-contained CLI for searching design jobs on Dribbble's public job board
// (https://dribbble.com/jobs) - product, UI/UX, web, graphic, brand, motion and
// illustration roles, worldwide and remote. No external CLI framework, so it
// runs anywhere `bun` is available with zero install beyond the repo clone.
//
// Personal use only. Dribbble's Terms of Service prohibit scraping and
// automated access faster than a person browsing; keep volume low and do not
// use it commercially or for bulk data collection. Run it on your own
// responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { SPECIALTIES, jobTypeParam, specialtyIds } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", s: "specialty" }
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

const SPECIALTY_NAMES = Object.keys(SPECIALTIES).join(", ")

const HELP = `dribbble-cli — search design jobs on Dribbble (worldwide and remote)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keyword phrase, matched literally against the whole posting
                          (title, company, description). "UI" matches nearly everything;
                          "UI designer" matches only postings containing that exact phrase.
  --location, -l <text>   Location filter, e.g. "London", "Berlin", "Istanbul".
  --remote                Only remote-only and remote-friendly postings (Dribbble's
                          "Open to remote" filter; drops on-site roles even with --location).
  --specialty, -s <list>  Comma-separated specialties: ${SPECIALTY_NAMES}.
  --type <type>           fulltime | freelance (freelance/contract).
  --jobage <days>         Posted within N days (filtered client-side from the card's
                          "Posted N days ago"; listings expire after 30 days anyway).
  --page <n>              1-indexed page. The whole board currently fits on page 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "product designer" --format table
  bun run src/cli.ts search --specialty ui,ux --remote --format table
  bun run src/cli.ts search -q "brand" -l "London" --jobage 14 --format table
  bun run src/cli.ts search --specialty web --type freelance --format table
  bun run src/cli.ts detail 311562 --format plain

Personal use only — Dribbble's Terms of Service prohibit scraping; keep volume low.
`

// Long-form flag names each command accepts (parseFlags resolves the short
// aliases q/l/n/s to these before validation). "help"/"h" pass so
// `search --help` still prints usage.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "remote", "specialty", "type", "jobage", "page", "limit", "format", "help", "h",
  ]),
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
    if ((flags._ as string[]).length > 1) {
      return fail(
        `unexpected argument "${(flags._ as string[])[1]}" - pass keywords with --query/-q (quote multi-word phrases)`,
        "BAD_ARG",
      )
    }
    // A present text flag needs a value: parseFlags stores a bare -q as true
    // and -q "" as "", and treating either as unset would return the whole
    // board as if it matched.
    for (const name of ["query", "location", "specialty", "type"]) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !v.trim())) {
        return fail(`--${name} requires a non-empty value`, "BAD_ARG")
      }
    }
    // --remote is a switch. A value after it (e.g. "--remote yes") would have
    // been swallowed by parseFlags, so only "true"/"false" spellings pass.
    let remote = false
    if (flags.remote !== undefined) {
      if (flags.remote === true || flags.remote === "true") remote = true
      else if (flags.remote === "false") remote = false
      else return fail(`--remote is a switch and takes no value, got "${flags.remote}"`, "BAD_ARG")
    }
    if (typeof flags.specialty === "string" && specialtyIds(flags.specialty) === null) {
      return fail(`--specialty must be a comma-separated list of: ${SPECIALTY_NAMES}; got "${flags.specialty}"`, "BAD_ARG")
    }
    if (typeof flags.type === "string" && jobTypeParam(flags.type) === null) {
      return fail(`--type must be one of fulltime|freelance, got "${flags.type}"`, "BAD_ARG")
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
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
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      remote,
      specialty: typeof flags.specialty === "string" ? flags.specialty : undefined,
      type: typeof flags.type === "string" ? flags.type : undefined,
      jobage: ints.jobage,
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
