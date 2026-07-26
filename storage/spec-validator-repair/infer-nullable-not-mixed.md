---
type: fix
recommended-model: opus
status: PENDING
priority: P1
depends-on: [relocate-tests-and-benches]
files-own: [src/sbc/schema.ts, src/sbc/types.ts, test/sbc/schema.test.ts]
files-shared: [src/sbc/index.ts, src/sbc/codegen.ts]
tests: [test/sbc/schema.test.ts, test/sbc/index.test.ts]
---

# Nullable fields defer their base type instead of collapsing to mixed

## Rationale

inferType returns the catch-all mixed for null and undefined (src/sbc/schema.ts:110-113) and inference samples one record, so the first record permanently decides. A field typed number-or-null whose first sample is null is tag-encoded on every later record instead of taking its fixed-width slot, and because rawType feeds computeShapeHash the same logical shape yields two different schema hashes depending on sample order — a registry split, not just a throughput loss. FieldSpec.nullable already exists to carry this (src/sbc/types.ts:31) but is hardcoded false at src/sbc/schema.ts:209.

## Changes

A `null` or `undefined` sample no longer collapses a field to `mixed`: `src/sbc/schema.ts` records the field nullable with its base type deferred until the first non-null observation, `src/sbc/types.ts`'s `FieldSpec.nullable` stops being inert, and `computeShapeHash` becomes sample-order independent so one logical shape yields one hash. `mixed` survives as the genuine escape hatch for heterogeneous fields. Public API break: schema hashes shift for shapes containing nullable fields.

## Design

Settled decisions. Root cause: `inferType` returns the catch-all `'mixed'` for `null`/`undefined` (`src/sbc/schema.ts:110-113`), and schema inference samples ONE record, so the first record permanently decides the field's type.

- **The defect.** A field `count: number | null` whose first sampled record carries `null` is typed `'mixed'` forever. `'mixed'` is the codegen bail group (`src/sbc/codegen.ts:865`, `:1187`), so that field is tag-encoded on every subsequent record instead of taking its fixed-width slot — and because the field's `rawType` feeds `computeShapeHash` (`src/sbc/schema.ts:11-36`), the SAME logical shape produces TWO different schema hashes depending on which record was sampled first. That is both a silent throughput loss and a registry-splitting correctness problem.
- **`FieldSpec.nullable` is the mechanism and it is currently inert.** `src/sbc/types.ts:31` declares `nullable?: boolean`, and `src/sbc/schema.ts:209` hardcodes `nullable: false` in the constructed field. Wire it: a field whose sampled value is `null`/`undefined` is recorded as nullable with its base type UNRESOLVED, and the first non-null observation of that field resolves the base type in place.
- **Resolution rule.** `inferType` keeps returning `'mixed'` ONLY for a value it genuinely cannot classify — `'mixed'` stays the escape hatch and is NOT removed (it is the `default:` at `src/sbc/schema.ts:165` and the codegen fallback, and deleting it would leave no path for a heterogeneous field). What changes is that `null`/`undefined` no longer ENTER it: they set nullable and defer the base type.
- **Hash stability is the acceptance bar.** `computeShapeHash` must produce the SAME hash for a shape regardless of which record was sampled first. That means the nullable flag participates in the hash deterministically (a nullable `number` field hashes differently from a non-nullable `number` field, but identically to itself no matter the sample order) and an unresolved field cannot be hashed at all — a schema is not registered until every field's base type resolves, with the tagged path carrying records until then.
- **`undefined` does not round-trip and this item does not fix it.** Tag 0 covers both `null` and `undefined` on encode, and `src/sbc/tagged.ts:47` decodes tag 0 as `null`, so `{a: undefined}` returns `{a: null}`. Distinguishing them would need a fourteenth tag for one JS wart; it is recorded as a follow-up and deliberately NOT built here. Assert the current collapse in the suite so it is documented behavior rather than an accident.

Test plan (`test/sbc/schema.test.ts`, the mirror for `src/sbc/schema.ts`, plus hash cases in `test/sbc/index.test.ts`):

1. Sample-order independence: encoding `[{count: null}, {count: 7}]` and `[{count: 7}, {count: null}]` through two fresh codecs yields the SAME schema hash for the `count` field's shape. This is the repro and it must fail before the fix.
2. A field first seen as `null` and later as a number takes the fixed-width slot on the later record — assert the encoded length matches the all-numbers case, not the tag-encoded case.
3. A nullable `number` field and a non-nullable `number` field produce DIFFERENT hashes (the flag is in the hash) and each is stable across repeated inference.
4. A genuinely heterogeneous field (`{v: 1}` then `{v: 'x'}`) still resolves to `'mixed'` and still round-trips — the escape hatch survives.
5. `{a: undefined}` round-trips to `{a: null}`, asserted explicitly as known behavior with the follow-up referenced in the test name.

## Reads

- src/sbc/tagged.ts — tag 0 decode (:47), the null/undefined collapse asserted as known behavior
- src/sbc/constants.ts — FIELD_SIZES / KNOWN_TYPES, the vocabulary a resolved nullable field lands in

## Acceptance

- Encoding `[{count: null}, {count: 7}]` and `[{count: 7}, {count: null}]` through two fresh codecs yields the SAME schema hash — the repro fails before the fix and passes after.
- A field first seen `null` takes its fixed-width slot once resolved; a nullable and a non-nullable field of the same base type hash differently but each hashes stably.
- A genuinely heterogeneous field still resolves to `mixed` and still round-trips; `{a: undefined}` round-trips to `{a: null}`, asserted as documented behavior.
- 0 regressions in test/sbc/schema.test.ts and test/sbc/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/schema.test.ts test/sbc/index.test.ts
- npx tsc --noEmit

## Notes

DEFERRED 2026-07-26T08:28:15.294Z run=f177cf28 class=dependency reason="dependency validator-boolean-coercion did not land — reverted" salvage=none
