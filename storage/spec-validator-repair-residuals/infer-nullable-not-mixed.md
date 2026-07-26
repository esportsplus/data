---
type: fix
recommended-model: opus
status: REVERTED
priority: P1
depends-on: none
files-own: [src/sbc/codegen.ts, src/sbc/schema.ts, test/sbc/index.test.ts, test/sbc/schema.test.ts]
files-shared: [src/sbc/index.ts, src/sbc/types.ts]
tests: [test/sbc/schema.test.ts, test/sbc/index.test.ts, test/sbc/schema-store.test.ts, test/sbc/registry.test.ts]
blocked-reason: merge refused: reverted — salvage red — the narrowed selection cherry-picks onto a commit an excluded sibling owns — infeasible, nothing landed; salvage ref salvage/8f60bc49-u1 @ 7990c423d65b517dd3503d95126e14bffa958b2e — the unit branch tip survives as this tag; cherry-pick the item's [infer-nullable-not-mixed] commits to recover
---

# Nullable fields defer their base type instead of collapsing to mixed

## Rationale

Verified current at HEAD: `inferType` returns the catch-all `'mixed'` for `null`/`undefined`
(`src/sbc/schema.ts:110-113`), inference samples ONE record so the first record permanently
decides, and the constructed field hardcodes `nullable: false` with `nullIndex: -1` while the
inferred schema hardcodes `bitmapBytes: 0` / `nullableCount: 0` (`src/sbc/schema.ts:201`, `:235`,
`:249`) — `FieldSpec.nullable` (`src/sbc/types.ts:65`) is fully wired on the DECLARED path
(`defineSchema`, registry round-trip via the flags byte) and fully inert on the INFERENCE path. A
field `count: number | null` whose first sample is null is `'mixed'` forever — tag-encoded per
record (the codegen bail arm) — and because `rawType` feeds `computeShapeHash`, the same logical
shape yields TWO schema hashes depending on sample order: a registry split, not just a throughput
loss. Bonus defect found while re-anchoring: NEITHER hash call site includes nullability, so two
DECLARED schemas differing only in a `nullable` flag collide on one hash and the second silently
binds to the first's layout (`src/sbc/index.ts:767` + `registry.schemas.has(hash)` early-return).

## Changes

A `null`/`undefined` sample no longer decides a field's type: schema inference records the field
nullable with its base type deferred to the first non-null observation, upgrading the registered
schema in place of splitting the registry; nullability joins the shape-hash input on BOTH the
inference and declared paths, so a nullable and a non-nullable field of the same base type hash
apart while one logical shape hashes identically regardless of sample order. `mixed` survives
strictly as the heterogeneous-value escape hatch. Schema hashes shift for shapes with nullable
fields — version-bump-scoped under the carried no-back-compat directive.

## Design

Settled decisions. Root cause: null carries no base-type information, and single-record sampling
forces a permanent decision at the moment that information is absent.

- **Observable contract (the acceptance bar).** (1) The FINAL schema hash for a logical shape is
  identical whichever sample order produced it. (2) A nullable and a non-nullable field of the same
  base type hash differently, and each hashes stably. (3) A field first seen null takes its
  fixed-width slot once resolved. (4) Every buffer encoded at any point — before or after
  resolution — remains decodable by the same codec. (5) `'mixed'` is still inferred for genuinely
  heterogeneous values and still round-trips.
- **Mechanism — PROVISIONAL-THEN-UPGRADE.** Recorded deviation from the predecessor design, which
  said "a schema is not registered until every field's base type resolves": that is unimplementable
  as stated — tag-8 buffers carry the schema hash and decode resolves it through the registry, so
  an unregistered schema makes its own just-encoded buffers undecodable. Instead:
  - A null/undefined sample infers the field as nullable with base UNRESOLVED. The record still
    encodes: a PROVISIONAL schema is compiled and registered (decodable) but is NOT persisted to
    the `PersistentStore` and is never treated as final.
  - The first record showing a non-null value for that field (it misses `revalidateCached` /
    `matchSchema`, both of which already accept null only for `nullable` fields —
    `src/sbc/index.ts:377-380`) registers the RESOLVED schema — nullable:true plus the inferred
    base type — under its own hash, rebinds the weak/ring caches, and persists THAT one. The
    provisional stays registered so earlier buffers keep decoding.
  - Symmetrically, a null observed for a field of an existing non-nullable INFERRED schema upgrades
    to the nullable variant. Both orders therefore converge on the same final hash.
- **Hash input, not stored vocabulary.** Nullability folds into the HASH INPUT only — hash
  `types[i] + (nullable ? '?' : '')` at both `computeShapeHash` call sites
  (`inferAndRegister`, `src/sbc/schema.ts:170`; `defineSchema`, `src/sbc/index.ts:767`) — never
  into stored `rawType`/`FieldSpec.type` (`parseFieldType` must keep receiving clean strings).
  This also fixes the declared-path nullable hash collision. `src/sbc/registry.ts` already
  serializes the nullable flag (flags byte, `:96`/`:191`) — no registry change.
- **Inference path grows the nullable machinery defineSchema already has:** nullIndex assignment,
  `nullableCount`, `bitmapBytes = ceil(count/8)`, the 16-nullable cap — mirror
  `src/sbc/index.ts:779-796`; codegen consumes these fields already and needs no change.
- **`mixed` survives.** `inferType`'s `default:` (:157) and heterogeneous re-inference keep
  producing `'mixed'`; only null/undefined stop entering it.
- **`undefined` does not round-trip and this item does not fix it.** Tag 0 decodes to `null`
  (`src/sbc/tagged.ts:54`); asserted as documented behavior, follow-up not built.
- **Discretion points:** (1) how the provisional state is carried (a flag on `Schema` vs a
  side-set) — criterion: zero added cost on the resolved-schema hot path; (2) where the upgrade
  triggers (inside `inferAndRegister` on refinement vs the matchSchema-miss call site) —
  criterion: exactly one added branch, on the cache-miss path only.

Test plan (`test/sbc/schema.test.ts` — NEW mirror for `src/sbc/schema.ts`; the dropped
test(author) commit 76dd754 on tag `salvage/5776b305-u1` is the seed corpus — recover with
`git show 76dd754` from the repo root and re-verify each case against this design before adopting it):

1. Sample-order independence (THE repro): `[{count: null}, {count: 7}]` vs `[{count: 7},
   {count: null}]` through two fresh codecs — identical FINAL schema hash. Fails before the fix.
2. A field first seen null takes the fixed-width slot after resolution — encoded length of the
   post-resolution record equals the all-numbers case, not the tag-encoded case.
3. Nullable vs non-nullable same-base fields hash differently; each is stable across repeated
   inference; the DECLARED-path collision is fixed (two `defineSchema` calls differing only in
   `nullable` yield two hashes).
4. Transitional decodability: a buffer encoded under the provisional schema still decodes after
   the upgrade, alongside buffers encoded under the resolved schema, same codec.
5. Heterogeneous `{v: 1}` then `{v: 'x'}` still resolves `'mixed'` and round-trips.
6. `{a: undefined}` round-trips to `{a: null}` — asserted as documented behavior.
7. The provisional schema is absent from the `PersistentStore`; the resolved schema is present.

## Reads

- src/sbc/tagged.ts — tag 0 decode (:54), the null/undefined collapse asserted as known behavior
- src/sbc/codegen.ts — the nullable bitmap machinery the inferred schemas now exercise
- src/sbc/registry.ts — nullable flag persistence (:96, :191), verified no change needed
- src/sbc/constants.ts — FIELD_SIZES/KNOWN_TYPES (post-rename vocabulary a resolved field lands in)

## Acceptance

- The sample-order repro passes; both transitional buffers decode; the resolved schema, not the
  provisional, reaches the PersistentStore.
- Nullable/non-nullable hash separation holds on both the inference and declared paths.
- `computeSize({data: null, id: 1})` returns the EXACT encoded length — `9 + schema.bitmapBytes +
  <fixed sizes of the non-null fields>`, 11 for this shape, equal to `encode(...).length`: the
  provisional field is nullable, so the `f.nullable && v == null` short-circuit at
  `src/sbc/size.ts:77` skips it before the `-1` default arm can fire. The old assertion at
  `test/sbc/index.test.ts:1916-1919` ('returns -1 for object with mixed field') encodes the
  contract this item intentionally breaks and MUST be rewritten BY THIS ITEM to assert
  `computeSize(obj) === c.encode(obj).length` — a form that also survives sbc-compute-size. The
  rest of that file's scoped run stays green without edits.
- 0 regressions in the four `tests` entries, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/schema.test.ts test/sbc/index.test.ts test/sbc/schema-store.test.ts test/sbc/registry.test.ts
- npx tsc --noEmit

## Directives

1. src/sbc/schema.ts, src/sbc/index.ts, src/sbc/types.ts — nullable-aware inference (provisional registration, upgrade-on-observation, nullIndex/nullableCount/bitmapBytes on the inference path) plus nullability folded into the hash input at both computeShapeHash call sites
2. test/sbc/schema.test.ts — the seven-case corpus above, seeded from salvage commit 76dd754

## Notes

test/sbc/schema-store.test.ts and test/sbc/registry.test.ts are listed in `tests` purely as scoped
regression protection — hash VALUES shift under this item, and those suites are the closest
consumers of persisted hashes; they recompute hashes at runtime and are expected to pass unedited.
If either fails, the failure is a defect in the mechanism (a persisted provisional, or an
inconsistent hash input between paths), never a test to update.
`depends-on: none` — this item shares src/sbc/schema.ts (files-own) with bigint-int64-parity, so
the engine's files-own weld serializes them; index.md `## Features` order runs the rename first,
and nothing here consumes an artifact that rename produces (the hash suffix applies to whichever
vocabulary strings are current).
CRITIC CORRECTION (post-authoring review, supersedes the stale Acceptance bullet): the Acceptance clause claiming `computeSize({data: null, id: 1})` "still returns -1 here" is FALSE under this item's own settled mechanism. src/sbc/size.ts:77 short-circuits with `if (f.nullable && v == null) { continue; }` BEFORE the switch whose `default:` (:171) is the only source of -1. Once a first-sample-null field is recorded nullable with bitmapBytes counted (this Design's provisional-then-upgrade step), that continue fires and computeSize returns 9 + bitmapBytes + the fixed sizes — never -1. test/sbc/index.test.ts:1916-1919 ('returns -1 for object with mixed field') therefore asserts the OLD contract this item intentionally changes, and it is in this item's own `tests` and `## Checks` command, so leaving it unedited reds this item's own scoped gate. test/sbc/index.test.ts has been added to files-own for exactly this rewrite: replace that case with the exact-equality expectation for the first-sample-null shape and update its comment to the nullable-inference reality. Do NOT follow the 'do not touch it here' instruction in Acceptance. src/sbc/codegen.ts has also been added to files-own: `interface Schema` is declared there (src/sbc/codegen.ts:27), so Discretion point (1)'s 'a flag on Schema' option requires writing that file — undeclared, it would have hit a bounds.ts refusal at runtime (the option is named only inside a discretion bullet, so verifyPlan's design-target-unwritable scan could not see it).
