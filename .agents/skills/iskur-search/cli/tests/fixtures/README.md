# Fixtures

Hand-written HTML that reproduces the structure of İŞKUR e-Şube pages as observed on
2026-11-09 (`Istihdam/AcikIsIlanAra.aspx` results grid + pager, and
`Istihdam/AcikIsIlanDetay.aspx` anonymous view). The element ids, nesting and
attribute style match the live markup; the ad numbers, titles, employer name and
texts are invented. `__VIEWSTATE` / `__EVENTVALIDATION` are placeholders.

Each fixture also carries deliberately hidden text (`display:none`, an HTML comment, a
zero-width space) that the parsers must drop - see `parsing.test.ts`.
