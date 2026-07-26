---
type: refactor
recommended-model: sonnet
status: PENDING
priority: P2
depends-on: none
files-own: [src/compiler/sbc/index.ts, src/sbc/constants.ts, src/sbc/schema.ts, test/compiler/sbc/index.test.ts, test/sbc/index.test.ts]
files-shared: [src/sbc/codegen.ts, src/sbc/index.ts, README.md]
tests: [test/sbc/index.test.ts, test/compiler/sbc/index.test.ts, test/sbc/platform.test.ts, test/sbc/encode-safety.test.ts]
---

# Rename the int64 schema vocabulary; the range behavior already landed

## Rationale

Re-anchored against HEAD: the predecessor's P0 half — one int64 range behavior across Node and
browser — has ALREADY LANDED and must not be re-implemented. Verified: the tagged encoder
range-checks at the call site before `writeBI64` (`src/sbc/tagged.ts:399-406`, constants at
`:14-16`), all compiled arms emit the same check (`src/sbc/codegen.ts:163`, `:229`, `:942`,
`:1113`), the hinted path validates up front (`validateHinted`, `src/sbc/index.ts:63-72`), and
`test/sbc/platform.test.ts:344-365` already exercises the browser `DataView` bindings directly at
the ±2^63 edges, with `test/sbc/encode-safety.test.ts` D3 covering the throw surface. What remains
is the vocabulary half: tag 9 stores exactly 8 bytes, yet the schema type string still says
`bigint` — advertising arbitrary precision it does not have. Priority re-derived P0 → P2: this is
now a pure rename with no behavioral defect behind it.

## Changes

The schema-vocabulary string `bigint` becomes `int64` everywhere a FIELD TYPE is named — constants
tables, inference, field readers, all six codegen switch-arm groups, the hinted validator, the
compiler's SBC hint emission, and the docs — while every use of `bigint` that names the JAVASCRIPT
type (typeof results, TS annotations, error-message wording) stays exactly as it is. Tag 9 and the
wire layout are unchanged. Shape hashes shift for schemas containing the field (the type string
feeds `computeShapeHash`) — version-bump-scoped under the carried no-back-compat directive.

## Design

Settled decisions. This is a mechanical rename with ONE trap: `'bigint'` appears in two distinct
roles — schema-vocabulary string (rename) and `typeof` result / JS type (never touch). Every site
below was verified at HEAD.

RENAME (schema-vocabulary sites):

- `src/sbc/constants.ts` — `FIELD_SIZES` key `bigint: 8` (:14) → `int64: 8`; `KNOWN_TYPES` key
  `bigint` (:28) → `int64` (keep both tables alphabetized).
- `src/sbc/schema.ts` — `inferType` RETURN value at :116: `case 'bigint': return 'int64';` — the
  CASE LABEL matches a `typeof` result and stays `'bigint'`; only the returned string renames.
  `readFixedField` `case 'bigint':` (:273) — this switch is over FIELD TYPE strings → renames.
  `inferAndRegister`'s compressed-fixed-size check `t === 'bigint'` (:226) → `'int64'`.
- `src/sbc/index.ts` — `validateHinted` `case 'bigint':` (:63; f.type switch → renames; the two
  error messages inside KEEP the word bigint — Q6 default); `primitiveMatches` `case 'bigint':`
  (:429; field-type switch → renames; its body `typeof value === 'bigint'` stays); `defineSchema`'s
  compressed-fixed-size check `t === 'bigint'` (:815) → `'int64'`.
- `src/sbc/codegen.ts` — every switch arm over `f.type` / `et.base`: encoder :162, :196, :228;
  decoder :418, :442, :486; compressed decoder :676, :736, :779; compressed encoder :937, :1081,
  :1112. The emitted range-check literals and `_wBI64`/`_rBI64` helper names are untouched.
- `src/compiler/sbc/index.ts` — :92 `return 'bigint'` (for `ts.TypeFlags.BigInt`) → `'int64'`;
  the `'BigInt64Array'` typed-array name at :22 is untouched.
- `README.md` — the schema-type vocabulary mentions only: the types table row at :138 and the
  prose naming the schema string near :339 and :442. The tag-9 wire-table row at :85 keeps its
  8-byte description; reword its name to int64. JS-value mentions of bigint stay.

NEVER TOUCH (JS-type sites, verified so the seat does not over-rename):

- `typeof value` switches/comparisons: `src/sbc/tagged.ts:399` (`case 'bigint':`),
  `src/sbc/size.ts:28` (`case 'bigint': return 9`), `src/sbc/schema.ts:116` case label,
  `src/sbc/index.ts` `typeof value !== 'bigint'` (:64) and `typeof value === 'bigint'` (:429 body).
- All TypeScript `bigint` type annotations, `Encodable`'s `bigint` member, `BigInt64Array` /
  `BigUint64Array` names and TYPED_ARRAY tables.
- Error-message text: `Codec2: bigint out of int64 range` and the validateHinted messages —
  unchanged (Q6 default), which keeps `test/sbc/encode-safety.test.ts` and
  `test/sbc/platform.test.ts` green without edits.

Consequences, settled:

- Shape hashes shift for any shape carrying the field (rawType feeds `computeShapeHash`) —
  acceptable under the no-back-compat directive; hashes are recomputed on both sides at runtime.
- A `PersistentStore`/registry blob carrying `'bigint'` now refuses through the existing
  unknown-type path (`parseFieldType`, `src/sbc/schema.ts:102-104`) — asserted, not shimmed.
  `src/sbc/registry.ts` stores the full type string and revalidates via `parseFieldType` (:85), so
  it needs no code change.
- `src/sbc/extract.ts` uses `FIELD_SIZES` lookups and never names the string — no change.

Test recipe:

1. `test/sbc/index.test.ts` — rewrite the two declared-schema literals: `{ name: 'big', type:
   'bigint' }` (:2260) → `'int64'`; `array<bigint>` (:2585-2590) → `array<int64>`. ADD: (a)
   `defineSchema([{ name: 'x', type: 'bigint' }])` throws `Codec2: unknown field type: bigint`;
   (b) `KNOWN_TYPES` sanity via a hinted `int64` field round-tripping through tagged, compiled,
   compressed, and hinted-validated paths.
2. `test/compiler/sbc/index.test.ts` — :74 expectation `"type":"bigint"` → `"type":"int64"` (the
   fixture's TS type stays `total: bigint`).
3. `test/sbc/platform.test.ts` and `test/sbc/encode-safety.test.ts` — NO edits; listed in `tests`
   so the scoped gate proves the rename did not disturb the landed range behavior.

## Reads

- src/sbc/types.ts — FieldSpec, where the type string is declared (no code change; the string is
  untyped `string`)
- src/sbc/registry.ts — type-string serialization + parseFieldType revalidation (:79-85), the
  refusal path for stale 'bigint' blobs
- src/sbc/extract.ts — FIELD_SIZES-driven, verified no literal
- src/sbc/tagged.ts — NEVER-TOUCH reference site: its only `'bigint'` occurrences are the landed
  range check cited in Rationale (:399-406) and the `typeof value` case label (:399); the file
  carries no field-type strings, so the rename edits nothing here
- src/sbc/size.ts — NEVER-TOUCH reference site: `case 'bigint': return 9` (:28) switches on
  `typeof value`; field widths flow through FIELD_SIZES lookups, renamed at their constants source

## Acceptance

- `KNOWN_TYPES` and `FIELD_SIZES` carry `int64` and not `bigint`; a field typed `'bigint'` is
  refused by the existing unknown-type path.
- A schema containing an int64 field round-trips through the tagged, compiled, compressed, and
  hinted paths; `inferType(1n)` yields `'int64'`; the compiler's SBC hint emits `"type":"int64"`.
- Range-check error messages are byte-identical to HEAD (encode-safety and platform suites green
  without edits).
- 0 regressions in the four `tests` entries, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/index.test.ts test/compiler/sbc/index.test.ts test/sbc/platform.test.ts test/sbc/encode-safety.test.ts
- npx tsc --noEmit

## Notes

Do NOT build a wide-bigint (arbitrary-precision) encoding — carried decision, still a follow-up
feature request, still out of scope. The predecessor authored this as P0 with a hard dependency on
encode-growth-signal because the missing range check plus the RangeError-swallowing loop produced a
hang; both halves of that hazard are closed at HEAD, so this item is now independent
(`depends-on: none`). It shares src/sbc/codegen.ts and src/sbc/index.ts surfaces with
encode-growth-signal — that is same-file contention the engine's weld/merge gate handles, not a
consumed-artifact dependency; index.md `## Features` order still runs encode-growth-signal first.
CRITIC CORRECTION (post-authoring review): the Design's RENAME list names README.md ':339 and :442' as 'prose naming the schema string'. Both were read at HEAD and are JS/TS-TYPE sites that this item's own NEVER TOUCH rule protects — do NOT rename either. README:339 reads '\, \, \, \, \, other typed arrays ... ARE supported hint sources' — a list of TypeScript SOURCE types (siblings Date/Uint8Array/Map/Set/Promise), not schema vocabulary. README:442 is `count: bigint;` inside a ```typescript block under '### Supported Types / #### Primitives' (:434-445) — a TypeScript type annotation in the VALIDATOR docs, unrelated to SBC schemas; renaming it emits invalid TypeScript in the README. The only README schema-vocabulary rename sites verified at HEAD are the tag-9 wire-table row (:85) and the field-type table row (:138). Independently re-swept for Rule D at HEAD and CONFIRMED: the only schema-vocabulary 'bigint' string literals in the whole test tree are test/sbc/index.test.ts:2260/:2585/:2590 and test/compiler/sbc/index.test.ts:74 — all already in files-own. test/sbc/encode-safety.test.ts, test/sbc/platform.test.ts:180 and test/compiler/primitives.test.ts:256 carry only typeof/TS-type uses and need no edit.
CRITIC CORRECTION, excerpt repair (the preceding paragraph quoted README:339 through a shell that ate the code spans; the instruction it carries is unchanged). README.md:339-341 verbatim at HEAD reads: either (they arent encodable - see Wire Format). string, boolean, bigint, Date, / Uint8Array, other typed arrays, nested objects, and branded uint8 numbers ARE supported hint sources. -- each of those names is code-spanned in the source and the list enumerates TypeScript SOURCE types, so its bigint is a JS-type site and STAYS. README.md:442 is the line count: bigint; inside a fenced typescript block under ### Supported Types / #### Primitives (:434-445), i.e. a TypeScript annotation in the VALIDATOR docs. Rename NEITHER :339 nor :442.
