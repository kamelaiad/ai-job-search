# iskur-cli

CLI for searching the public job ads ("Açık İş İlanları") of **İŞKUR** (Türkiye İş Kurumu),
Türkiye's state employment agency, on e-Şube. Turkish-language ads, all 81 provinces,
private and public sector.

**Data source**: `https://esube.iskur.gov.tr/Istihdam/AcikIsIlanAra.aspx` (ASP.NET WebForms:
GET form, POST criteria) and `AcikIsIlanDetay.aspx?uiID=<ilanNo>`.
**Authentication**: None required (employer names of private ads stay hidden: `company: null`).
**Dependencies**: None (plain `bun` + `fetch` + regex). `bun install` is optional and only pulls dev type defs.

> Keep volume low - this is a government service. Each search is 2 requests (3 with
> `--page` > 1), spaced about a second apart.

## Installation

```bash
cd .agents/skills/iskur-search/cli
bun install   # optional - only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search job ads (keywords, province, sector, recency, page) |
| `detail` | Fetch the public detail of one ad by its 11-digit İlan No |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "grafik tasarım" -l Bursa --format table
bun run src/cli.ts search -q "web tasarım" -l İstanbul --jobage 7 --format table
bun run src/cli.ts search -l Ankara --sector public --format table
bun run src/cli.ts detail 00009887102 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (position, occupation, skill, employer). Matched against the whole ad. |
| `--location` | `-l` | Province name or plate code (`Bursa`, `Istanbul`, `34`). Default: all of Türkiye. |
| `--sector` | | `private` (default) \| `public` (`özel` \| `kamu`). |
| `--jobage` | | Posted within N days; rounds up to İŞKUR's 1 / 7 / 15-day windows, > 15 = no filter. |
| `--page` | | 1-indexed page (15 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun run typecheck
bun run test                     # includes a 3-request live smoke test
ISKUR_SKIP_LIVE=1 bun run test   # offline only
```

See `../SKILL.md` for the full reference and `../url-reference.md` for the form fields and
markup anchors to update if İŞKUR changes the page.
