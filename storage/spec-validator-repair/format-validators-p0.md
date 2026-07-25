---
type: fix
recommended-model: sonnet
status: PENDING
priority: P0
source: audit section E (P0 block)
depends-on: relocate-tests-and-benches
files-own: [src/validators/emoji.ts, src/validators/matches.ts, src/validators/cuid2.ts, src/validators/semver.ts, src/validators/base64.ts, test/validators/format.test.ts]
tests: [test/validators/format.test.ts]
---

# Fix the five P0 format validators against spec vectors

## Rationale

Five P0s, all executed: `emoji()` joins only with ZWJ (`emoji.ts:4`) so `"🇺🇸"`, `"1️⃣"`, `"👍🏻"` are rejected. `matches()` calls `regex.test()` on a SHARED RegExp (`matches.ts:8`) — with `/g` or `/y` the mutated `lastIndex` alternates pass/fail across records (re-verified: `alice,bob,carol,dan` → `true,false,true,false`). `cuid2()` demands `{24,}` after the first char (`cuid2.ts:4` — a copy of `cuid.ts:4` that never dropped one for the missing `c` prefix), rejecting every default-length 24-char CUID2 (re-verified: `tz4a98xxat96iws9zmbrgj3a` → false). `semver()` omits `-` from its identifier class (`semver.ts:4`), rejecting `1.0.0-alpha-beta` and semver.org's own `1.0.0+21AF26D3----117B344092BD`. `base64()` never checks `length % 4` (`base64.ts:6,11`), accepting undecodable `"A"`, `"AB"`, `"ABC"`, `"="`. The existing suite codified two of these bugs as intended behavior (mechanism A2) — those cases are corrected here.

## Changes

Five builtin format validators; their format.test.ts cases replaced with spec-derived vectors.

## Design

Exact recipes (all regexes are module-level constants; runtime contract `(value, errors) => void` unchanged):

1. `emoji.ts`: `const REGEX = /^[\p{RGI_Emoji}]+$/v;` — the `v`-flag property-of-strings class covers ZWJ sequences, flags, keycaps, skin tones, and tag sequences (Node >= 23 supports the `v` flag natively).
2. `matches.ts`: at FACTORY time, if the supplied regex has `global` or `sticky` set, rebuild it once without those flags: `regex = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''))`. Never mutate or share `lastIndex` state across calls.
3. `cuid2.ts`: `const REGEX = /^[a-z][0-9a-z]{1,31}$/;` — first char lowercase letter, total length 2–32 (cuid2 reference: default 24, configurable 2–32).
4. `semver.ts`: adopt the official semver.org recommended regex verbatim as the module constant (it carries hyphenated prerelease/build identifiers correctly).
5. `base64.ts`: keep the alphabet/padding shape and ADD `value.length % 4 === 0`; recipe regex: `/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/` — empty string stays accepted (decodes to empty), `"="` alone fails.

Test plan (rewrite the corresponding `test/validators/format.test.ts` blocks with spec vectors, not regex-reverse-engineered strings): emoji — the three rejected sequences pass, plain text fails; matches — one `/g` regex instance across 4 sequential records returns `true` all 4 times; cuid2 — `tz4a98xxat96iws9zmbrgj3a` (24 chars) passes, the old 26-char synthetic vector is corrected, uppercase fails; semver — semver.org vector list including both hyphen cases passes, `1.0` still fails; base64 — `A`/`AB`/`ABC`/`=` fail, RFC 4648 vectors pass.

## Reads

- src/validators/cuid.ts — the sibling cuid2.ts was mis-copied from; confirms the off-by-one provenance
- src/validators/index.ts — barrel re-export surface (unchanged, read to confirm no signature drift)

## Acceptance

- All five measured P0 repros flip; spec vectors pass; the two test-codified bugs (ulid-adjacent cuid2 26-char vector, base64 negatives) are replaced with correct vectors.
- 0 regressions in test/validators/format.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/validators/format.test.ts
- npx tsc --noEmit

## Notes

format-validators-correctness edits the same test file next — the planner welds them; deliberate.
