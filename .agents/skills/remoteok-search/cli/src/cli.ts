#!/usr/bin/env bun
// Self-contained CLI for searching remote jobs on Remote OK (https://remoteok.com)
// through its public JSON API. No external CLI framework and zero runtime
// dependencies, so it runs anywhere `bun` is available.
//
// Remote OK's API terms: link back to the job's URL on Remote OK and mention
// Remote OK as the source. Every output format keeps `url` on remoteok.com and
// names Remote OK. robots.txt asks for a 1-second crawl delay, which the CLI
// enforces across invocations.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", l: "location", n: "limit", t: "tag", h: "help" }
// Flags that never take a value, so `--title-only design` does not swallow a word.
const BOOLEAN_FLAGS = new Set(["title-only", "help"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-") && a.length > 1) {
      const raw = a.replace(/^-+/, "")
      const key = ALIAS[raw] ?? raw
      const next = argv[i + 1]
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("-")) {
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

const HELP = `remoteok-cli - search remote jobs on Remote OK (remoteok.com), worldwide

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords. Every word must appear (case-insensitive, at a word
                          start) in the title, company, tags or description. Client-side.
  --title-only            Match --query against the job title only (precise; tags and
                          descriptions on Remote OK are broad).
  --tag, -t <tag>         Remote OK tag, sent to the API (e.g. design, "web dev", "front end",
                          javascript, react). Searches the 100 latest jobs with that tag
                          instead of the ~100 latest jobs overall.
  --location, -l <text>   Comma-separated location words; a job matches if its location
                          contains any of them. "worldwide"/"anywhere" also matches jobs
                          with no location restriction. Client-side.
  --jobage <days>         Posted within N days. Client-side. Default: all.
  --page <n>              1-indexed page over the filtered results. Default 1.
  --limit, -n <n>         Results per page (client-side cap). Default 20.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "web developer" --format table
  bun run src/cli.ts search --tag design -q designer --title-only --format table
  bun run src/cli.ts search --tag "web dev" -q developer -l "worldwide,europe,emea,turkey" --jobage 14
  bun run src/cli.ts detail 1137703 --format plain

Data from Remote OK (https://remoteok.com). Link back to each job's Remote OK URL when sharing it.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "tag", "location", "title-only", "jobage", "page", "limit", "format", "help"]),
  detail: new Set(["format", "help"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

/** A present string flag must carry a non-empty value (a bare `-q` parses as true). */
function textFlag(flags: Flags, name: string): string | undefined | null {
  const v = flags[name]
  if (v === undefined) return undefined
  if (typeof v !== "string" || !v.trim()) return null
  return v.trim()
}

/** Whole numbers >= 1 only: Number(), not parseInt(), so "1.5" is rejected, not truncated. */
function intFlag(flags: Flags, name: string): number | undefined | null {
  const raw = flags[name]
  if (raw === undefined) return undefined
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) return null
  return val
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags instead of silently discarding them: a discarded
  // filter changes what the search returns with no error.
  const known = KNOWN_FLAGS[cmd]
  if (known) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || known.has(key)) continue
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }

  if (cmd === "search") {
    const extra = (flags._ as string[]).slice(1)
    if (extra.length) return fail(`unexpected argument "${extra[0]}" - pass keywords with --query`, "BAD_ARG")

    const text: Record<string, string | undefined> = {}
    for (const name of ["query", "tag", "location"]) {
      const v = textFlag(flags, name)
      if (v === null) return fail(`--${name} requires a non-empty value`, "BAD_ARG")
      text[name] = v
    }
    const nums: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      const v = intFlag(flags, name)
      if (v === null) return fail(`--${name} must be a whole number of at least 1, got "${flags[name]}"`, "BAD_ARG")
      nums[name] = v
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }
    if (flags["title-only"] && !text.query) {
      return fail("--title-only needs --query (it narrows where the keywords are matched)", "BAD_ARG")
    }

    const opts: SearchOpts = {
      query: text.query,
      tag: text.tag,
      location: text.location,
      titleOnly: flags["title-only"] === true,
      jobage: nums.jobage,
      page: nums.page ?? 1,
      limit: nums.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <id|slug|url>", "NO_ID")
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
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
