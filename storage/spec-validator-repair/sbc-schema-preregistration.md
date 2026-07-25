---
type: fix
recommended-model: opus
status: BLOCKED
blocked-reason: blocked pending user review of the SBC audit findings (Q3/Q4)
priority: P0
source: findings D2, D4 (audit section D)
depends-on: relocate-tests-and-benches
files-own: [src/sbc/index.ts, test/sbc/index.test.ts]
tests: [test/sbc/index.test.ts]
---

# defineSchema pre-registration is honored; unknown hints throw

## Rationale

D2 (P0): `src/sbc/index.ts:713-734` indexes a declared schema into `typedSchemas` only when `hasStructural` (some field has `elementType` or `refHash`), and `matchSchema` (`:223`) consults ONLY `typedSchemas` — so for every non-structural schema, declared widths and `nullable` are silently DISCARDED and one logical type mints unbounded registry entries (re-verified: declared hash `2783110723` ignored, `honored? false`, 3 registry entries from 3 encodes of one type). README:94-110 claims pre-registration is used; README:139-146's own nullable example is dead. D4 (P1): `encode(v, {schema: unknownHash})` returns `registry.schemas.get(hint) ?? null` (`:757-765`) and silently falls through to inference — producing a valid-looking buffer under the WRONG schema — while `decode` throws on the same stale hash (`:740-754`).

## Changes

Schema matching honors ALL declared schemas; encode-side hint resolution fails loud on unknown hashes; one logical type maps to one registry entry.

## Design

Settled decisions:

- **Index every declared schema.** `defineSchema` registrations enter the match index regardless of `hasStructural` (either `typedSchemas` gains non-structural entries or a parallel shape-keyed index — implementer's structural choice; criterion below). `matchSchema` resolves a value against declared schemas FIRST (field-name-set match), before inference; declared widths and `nullable` flags drive the encoder for matched values.
- **Stability invariant.** N encodes of one logical (declared) type produce exactly ONE registry entry with the declared hash — never per-encode minting. The declared hash is the wire hash.
- **Unknown hint throws (D4).** `encode` with an explicit `{schema: hash}` hint that resolves to no registered schema throws a `Codec2:`-prefixed error naming the hash — mirroring decode. Silent fallback to inference is the defect, not a feature.
- Discretion point: match-index structure (extend `typedSchemas` vs parallel index) and the field-name-set matching key; criterion — `matchSchema` stays O(1)-ish on the hot path (no per-encode linear scans over the registry), and the D2 byte repro (declared-u8 layout `8,149,165,56,204,2,0,0,0,5,2`) is what a declared-schema encode now emits.

Test plan (extend the moved `test/sbc/index.test.ts`, replacing the vacuous assertions the audit flagged — D7's `:1539` "pre-registered schema encodes/decodes" that passes with deliberately wrong declared types, and `:1578`'s `typeof hash === 'number'`): a declared non-structural schema (u8 widths + nullable) is HONORED — assert the exact declared-layout bytes, not just round-trip; README:139-146's nullable example works as documented; registry holds 1 entry after 3 encodes of the declared type; a deliberately wrong declared type now FAILS the assertion that previously passed (test-honesty closure); `encode(v, {schema: 0xdeadbeef})` throws `Codec2:`; decode-side behavior unchanged.

## Reads

- src/sbc/schema.ts — inferAndRegister/computeShapeHash, the inference path declared schemas must pre-empt
- src/sbc/registry.ts — serialization invariants the single-entry rule must respect
- src/sbc/types.ts — Schema/StoredSchema shapes

## Acceptance

- Declared widths/nullable drive emitted bytes (measured repro flips to `honored? true`); one entry per logical type; unknown encode hint throws.
- All 450 currently-passing SBC behaviors covered by this suite stay green (full runtime round-trip fidelity is baseline-verified).
- 0 regressions in test/sbc/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/index.test.ts
- npx tsc --noEmit

## Notes

sbc-encode-safety layers field-level error handling ON the hint path this item repairs — land this first.
