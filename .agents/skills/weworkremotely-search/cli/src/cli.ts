#!/usr/bin/env bun
// Self-contained CLI for searching remote jobs on We Work Remotely
// (https://weworkremotely.com) through its public RSS feeds. No external CLI
// framework and zero runtime dependencies, so it runs anywhere `bun` is available.
//
// Only the RSS feeds are read: the site's HTML pages answer this CLI's honest
// User-Agent with a Cloudflare challenge, and the CLI never impersonates a
// browser. Keyword, location, age and page filters run client-side.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CATEGORIES } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", l: "location", n: "limit", c: "category", h: "help" }
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

const CATEGORY_LIST = Object.keys(CATEGORIES).join(", ")

const HELP = `weworkremotely-cli - search remote jobs on We Work Remotely (weworkremotely.com), worldwide

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <slug|url> [--category <cat>] [--format json|plain]

SEARCH FLAGS
  --query, -q <text>       Keywords. Every word must appear (case-insensitive, at a word
                           start) in the title, company, skills, category or description.
  --title-only             Match --query against the job title only.
  --category, -c <list>    Comma-separated category feeds to read instead of the all-jobs
                           feed (which holds only the 10 newest jobs per category):
                           ${CATEGORY_LIST}
  --location, -l <text>    Comma-separated words matched against the region/country text
                           ("Anywhere in the World", "Europe Only", "USA Only", country
                           names); any one matches. "worldwide" matches "Anywhere in the World".
  --jobage <days>          Posted within N days (pubDate). Default: all.
  --page <n>               1-indexed page over the filtered results. Default 1.
  --limit, -n <n>          Results per page (client-side cap). Default 20.
  --format <fmt>           json (default) | table | plain.

DETAIL FLAGS
  --category, -c <list>    Look only in these category feeds (pass the result's category
                           alias to make detail one request). Default: all-jobs feed, then
                           each category feed until found.
  --format <fmt>           json (default) | plain.

EXAMPLES
  bun run src/cli.ts search -q "web designer" --format table
  bun run src/cli.ts search -c design -q designer --title-only -l "worldwide,europe,türkiye" --format table
  bun run src/cli.ts search -c front-end,full-stack -q "web developer" --jobage 14 --format table
  bun run src/cli.ts detail breakthrough-design-group-senior-creative-web-designer -c design --format plain

Data from We Work Remotely RSS feeds (https://weworkremotely.com). Personal use; keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "category", "location", "title-only", "jobage", "page", "limit", "format", "help"]),
  detail: new Set(["category", "format", "help"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

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

/** Parse --category into known aliases; null (with the bad value) when any item is unknown. */
function categoryFlag(flags: Flags): { ok: true; value: string[] } | { ok: false; bad: string } {
  const v = textFlag(flags, "category")
  if (v === undefined) return { ok: true, value: [] }
  if (v === null) return { ok: false, bad: "(empty)" }
  const items = v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  for (const item of items) if (!(item in CATEGORIES)) return { ok: false, bad: item }
  return { ok: true, value: [...new Set(items)] }
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

  const cats = categoryFlag(flags)
  if (!cats.ok) return fail(`--category must be a comma list of: ${CATEGORY_LIST}; got "${cats.bad}"`, "BAD_ARG")

  if (cmd === "search") {
    const extra = (flags._ as string[]).slice(1)
    if (extra.length) return fail(`unexpected argument "${extra[0]}" - pass keywords with --query`, "BAD_ARG")

    const text: Record<string, string | undefined> = {}
    for (const name of ["query", "location"]) {
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
      categories: cats.value,
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
    if (!id) return fail("detail requires a <slug|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
    }
    const opts: DetailOpts = { id, categories: cats.value, format: fmt as DetailOpts["format"] }
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
