---
type: fix
recommended-model: opus
status: PENDING
priority: P1
source: audit section E (P1/P2 format, network, time, identity blocks)
depends-on: relocate-tests-and-benches
files-own: [src/validators/ulid.ts, src/validators/ip.ts, src/validators/iso.ts, src/validators/hostname.ts, src/validators/domain.ts, src/validators/mac.ts, src/validators/email.ts, src/validators/date-string.ts, src/validators/epoch.ts, src/validators/jwt.ts, src/validators/bic.ts, src/validators/isbn.ts, src/validators/words.ts, src/validators/url.ts, test/validators/format.test.ts]
tests: [test/validators/format.test.ts]
---

# Correct the format/network/time validator family against their specs

## Rationale

Executed P1s: `ulid()` rejects lowercase (spec: case-insensitive) and accepts overflowed timestamps (`ulid.ts:4`). `ip.v4()` accepts leading-zero octets (`ip.ts:6,11`; `010.1.1.1` is `8.1.1.1` under `inet_aton` — SSRF/allowlist bypass). `iso.date()` does no calendar validation (`2023-02-29` accepted); `iso.time()`/`iso.timestamp()` reject the RFC 3339 §5.8 leap second and lowercase `t`/`z`; `iso.duration()` rejects `P1W` (`iso.ts:6-10`). `hostname()`/`domain()` accept labels >63 octets. `mac()` accepts mixed separators (`mac.ts:6,7`). `email()` default accepts `a@b..com`, `.a@b.com`, `a..b@b.com`, `a@b.com.`, `a@-b.com` while `email.html5()` rejects the hyphen cases — the DEFAULT is the weakest variant; `email.rfc5322()` rejects quoted local parts with spaces (missing `\x20` in qtext); `email.unicode()` is byte-identical to `email()` (P2). `dateString()` accepts `"2024-02-30"`, `"5"`, `"2024"` (`new Date(v)` is the only gate). `epoch()` rejects numeric timestamps and accepts unbounded digit strings. `jwt()` rejects the RFC 7519 §6.1 unsecured JWT (empty third segment). P2s: `bic()` allows `0`/`1` as location-code first char; `isbn()` rejects lowercase `x` and skips the 978/979 prefix; `words()` mis-splits (NBSP) and counts 1 for space-free scripts; `url()` rejects `mailto:` while accepting `javascript://alert(1)`.

## Changes

Fourteen builtin validators corrected to their governing specs; format.test.ts vectors replaced with spec-derived cases (mechanism A2 closure for this family).

## Design

Per-file recipes (module-level regex constants throughout):

- `ulid.ts`: `/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i` — case-insensitive Crockford base32; leading `[0-7]` bounds the 48-bit timestamp (rejects overflow).
- `ip.ts` (v4 + the v4 part of cidr): octet atom `(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])` — no leading zeros. v6 verified correct; untouched.
- `iso.ts`: `iso.date` adds calendar validation after the regex (month 1-12, day against per-month table with leap-year rule — pure arithmetic, no Date round-trip); `iso.time`/`iso.timestamp` accept seconds value `60` (leap second) and case-insensitive `T`/`Z` per RFC 3339; `iso.duration` accepts the week form `P<n>W` (exclusive with date/time components, per ISO 8601). `iso.dateTime`/`iso.week` verified correct; untouched.
- `hostname.ts`/`domain.ts`: per-label quantifier 1–63 (`[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?`), total length <= 253 checked separately.
- `mac.ts`: one separator style per value via backreference: `/^[0-9A-Fa-f]{2}(?:([:-])[0-9A-Fa-f]{2})(?:\1[0-9A-Fa-f]{2}){4}$/` (implementer verifies the exact quantifier grouping against both 48-bit forms currently supported).
- `email.ts`: DEFAULT aligns with the html5 variant's strictness plus dot-atom rules — reject consecutive dots, leading/trailing dots in local and domain, trailing root dot, leading/trailing hyphen in any label (the five measured acceptances all fail). `rfc5322` adds `\x20` to qtext so quoted locals with spaces pass. `unicode` becomes a REAL variant: the default's structure with `\p{L}\p{N}`-based classes under `/u` for local part and domain labels.
- `date-string.ts`: require ISO shape `^\d{4}-\d{2}-\d{2}([T ].+)?$`, then component check: parsed `Date` must round-trip year/month/day (rejects `2024-02-30`, `5`, `2024`).
- `epoch.ts`: accept integer `number` values AND digit strings, 1–13 digits (millisecond epoch upper bound), value >= 0; reject fractional numbers and 14+ digit strings.
- `jwt.ts`: `/^[\w-]+\.[\w-]+\.[\w-]*$/` — third segment may be empty (RFC 7519 §6.1 unsecured JWT).
- `bic.ts`: location code first char excludes `0` and `1` (`[2-9A-Z]`); NO ISO 3166 country whitelist (documented limitation — a country-code table is a maintenance liability out of proportion to the check).
- `isbn.ts`: accept lowercase `x` check digit (normalize before checksum); ISBN-13 requires `978`/`979` prefix.
- `words.ts`: count via `Intl.Segmenter(undefined, {granularity:'word'})` filtering `isWordLike` segments — fixes both the NBSP split and space-free scripts (CJK); guard the factory arg (negative/NaN count throws a `Validators:`-prefixed Error at factory time, matching numeric-constraint-validators' convention).
- `url.ts`: `url()` is purely syntactic — any absolute URL the WHATWG `URL` constructor accepts passes, INCLUDING `mailto:` (the measured rejection is the bug); scheme policy belongs to `url.http()`/`url.https()` (verified correct, untouched). The `javascript:` acceptance is documented as inherent to a syntactic check (readme-accuracy carries the security note).

Test plan: replace/extend the family's blocks in `test/validators/format.test.ts` with the vectors named above (lowercase ULID passes; `010.1.1.1` and `127.000.000.001` fail; `2023-02-29`/`2024-04-31` fail; `1990-12-31T23:59:60Z` passes; `P1W` passes; a 64-char label fails; `00:1A-2B:3C-4D:5E` fails; the five email junk cases fail while `email.unicode` accepts an IDN local; `2024-02-30` fails dateString; `1721930000000` (number) passes epoch; unsecured JWT passes; `0AAAUS33` fails bic; `097522980x` passes isbn; NBSP/CJK word counts correct; `mailto:x@y.z` passes url). Also delete the per-describe boilerplate duplication noted in the audit where touched blocks are rewritten.

## Reads

- src/validators/uuid.ts — the family's verified-correct reference implementation style (variant sub-functions, vector-driven tests)
- src/validators/index.ts — barrel surface; no signature drift permitted

## Acceptance

- Every measured repro in the Rationale flips to spec-correct behavior; all verified-correct validators in this family's files (ip.v6, cidr forms, iso.dateTime, iso.week, url.http/https, email.html5 rejections) stay green.
- 0 regressions in test/validators/format.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/validators/format.test.ts
- npx tsc --noEmit

## Notes

`trim()`/`normalize()` naming (P2, assertion-only semantics) is Q2 in the index — default: keep names, document semantics (readme-accuracy). No behavior change to them here.
