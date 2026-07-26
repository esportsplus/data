---
type: fix
recommended-model: opus
status: PENDING
priority: P0
source: findings D1, D5 (audit section D)
depends-on: [relocate-tests-and-benches, analyzer-structural-types, remove-map-set-tags, unify-packed-numeric-tags]
files-own: [src/compiler/sbc/index.ts, test/compiler/sbc/index.test.ts]
tests: [test/compiler/sbc/index.test.ts]
---

# Compile-time SBC hints match runtime behavior byte-for-byte

## Rationale

D1 (P0): `src/compiler/sbc/index.ts:80-82` `analyzePropertyToFieldSpec` has no case for Map/Set/typed arrays; `src/compiler/type-analyzer.ts:28` only knows `'record'`, so all fall to `case 'object'`, route to `_encObj` (`src/sbc/codegen.ts:301`), and `Object.keys()` over a Map yields an EMPTY schema — re-verified: a Map field encodes to `{"m":{}}` (total data loss); `Uint8Array`/`Float32Array` become plain objects. README:6-9 and :296-304 sell this as a transparent optimization. Zero tests cover `src/compiler/sbc/` (`tests/plugins.ts:5-24` asserts only that the factory returns an array). D5 (P1): the compile-time path emits `float64` for every unbranded `number` (`:53-77`) while runtime `inferType` (`src/sbc/schema.ts:118-136`) narrows — compiled output is 1.78x LARGER (31890B vs 17890B per 1000 rows) with a DIFFERENT schema hash, so a compiled producer's buffer carries a hash a non-compiled consumer never registered. README:304 claims "identical behavior".

## Changes

The compile-time SBC hint generator: hints are emitted only when they provably match what runtime inference produces; types it cannot represent faithfully get NO hint (runtime handles them natively — verified working).

## Design

Settled decisions:

- **Parity-or-omit rule (the core decision, fixes both).** A schema hint is emitted for a type ONLY when every field's FieldSpec is width-determinate at compile time (branded ints/floats, string, boolean, Date, bigint, typed arrays where FieldSpec supports them). Any field whose runtime width depends on the VALUE — the unbranded `number` case — makes the WHOLE type hint-free: the call site falls back to runtime inference, which is byte-identical by construction. This kills the D5 hash divergence class outright rather than chasing width heuristics.
- **Structural kinds (D1).** Map/Set/typed-array fields (using the analyzer kinds analyzer-structural-types introduced) NEVER map to `type: 'object'`. Where `src/sbc/constants.ts` `KNOWN_TYPES` carries a faithful FieldSpec type, emit it; otherwise the field forces the hint-free fallback. An unknown/unsupported kind is a compile-time error only if emitting nothing would change runtime behavior — it never silently emits a wrong spec.
- Discretion point: the exact width-determinate FieldSpec subset emitted statically; criterion — a property test in the suite asserts BYTE-IDENTICAL output and EQUAL schema hash between the compiled-hint path and the pure-runtime path for every emitted hint shape; any shape that cannot meet that assertion is omitted from static emission.

Test plan (new coverage for a package surface with ZERO tests today, in the moved mirror `test/compiler/sbc/index.test.ts`): transform + execute — Map, Set, `Uint8Array`, `Float32Array` fields round-trip losslessly through the compiled path (the `{"m":{}}` repro dies); `{id: number, name: string}` compiled output is byte-identical to runtime `codec().encode` (11B, not 25B) with equal schema hash; a fully-branded type emits a hint and its bytes/hash still match the runtime path; registry state after compiled encodes matches the runtime-only registry.

## Reads

- src/compiler/type-analyzer.ts — the analyzer kinds consumed (Map/Set/typed-array cases from analyzer-structural-types)
- src/sbc/schema.ts — inferType, the runtime-narrowing semantics the parity rule is measured against
- src/sbc/constants.ts — KNOWN_TYPES / FIELD_SIZES, the FieldSpec vocabulary hints may target
- test/utils.ts — transform harness

## Acceptance

- Map/Set/typed-array fields survive the compiled path losslessly; compiled and runtime bytes + hashes are identical for every shape the suite covers.
- 0 regressions in test/compiler/sbc/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/sbc/index.test.ts
- npx tsc --noEmit

## Notes

README:296-304's "identical behavior" claim becomes TRUE under the parity-or-omit rule; readme-accuracy updates the wording about when hints are emitted.
2026-07-25 — SCOPE NARROWED by remove-map-set-tags and unify-packed-numeric-tags, both now hard dependencies. Map and Set cease to exist as value types, so D1's structural-kinds clause covers TYPED ARRAYS ONLY: there is no Map/Set case left to add, and any analyzer kind for them is dead work. The packed-numeric tags also collapse onto one typeId-carrying tag, so any hint the compiler emits for a numeric array field must target the unified layout, not flag=1/2/3. Re-read both items' Design before starting.
2026-07-25 — ADDITIONAL DEFECT found in the deep audit, in scope for this item and NOT covered by D1/D5 as authored. src/compiler/sbc/index.ts:84-86 maps a TypeScript Record to the SBC FieldSpec type 'map'. SBC's 'map' means a Map INSTANCE — src/sbc/schema.ts:151 returns it only for value instanceof Map — while a Record at runtime is a plain object inferring as 'object'. Compile-time and runtime therefore disagree on the same value, producing the exact hash divergence D5 describes. This also COLLIDES with remove-map-set-tags, which deletes 'map' from KNOWN_TYPES: after that item lands, this mapping emits a type the schema vocabulary no longer carries. Under the parity-or-omit rule a Record maps to 'object' or emits no hint at all. Add a test asserting a Record field's compiled hint and its runtime-inferred schema produce the SAME hash.
TS7 migration (landed after authoring): this repo now compiles on typescript 7.0.2 through @esportsplus/typescript, whose root vends the TS surface as `ts`. Deleted APIs — `ts.TypeChecker` is `ts.Checker`; `ts.forEachChild(n, cb)` is `n.forEachChild(cb)`; `ts.getCombinedModifierFlags` and `ts.IndexKind` are gone (use a node's `modifierFlags` field and `checker.getIndexInfosOfType`); `type.isUnion/isStringLiteral/isIntersection()` are `isUnionType/isStringLiteralType/isIntersectionType()`; `symbol.getName()` is `symbol.name` and `symbol.declarations` holds NodeHandles needing `.resolve()`; `checker.getTypeAtLocation`/`getTypeOfSymbol` now return `Type | undefined`. Never import `typescript` directly — the surface is vended centrally.
Compiler test harness (rebuilt for TS7): test/utils.ts no longer exposes `createProgram`. Use `compile(code)` → `{ checker, program, sourceFile }` (backed by `languageService.scratch`), `transformRaw(code)` for the data plugin, or `transformWith(plugins, code)` for any plugin set. `ts.createProgram`/`createCompilerHost`/`createSourceFile`/`ts.sys` no longer exist. Fixture types must not be named after DOM globals (`Node`, `Document`, `Range`): a scratch file is a script, not a module, so the name collides with the global instead of shadowing it — the harness pins `lib: ['es2020']` to keep that off the DOM type graph.
