---
type: feature
recommended-model: opus
status: PENDING
priority: P1
source: audit section H (measured emitted schemas)
depends-on: [relocate-tests-and-benches, analyzer-structural-types]
files-own: [src/compiler/type-analyzer.ts, src/compiler/json-schema.ts, test/compiler/json-schema.test.ts]
tests: [test/compiler/json-schema.test.ts, test/compiler/type-analyzer.test.ts]
---

# Intersections flatten, readonly emits, recursion refs

## Rationale

Measured schema gaps (section H): nested intersection `{both: A&B}` emits `{"properties":{"both":{}}}` — accepts anything; root intersection `type Target = A&B` emits `{"$schema":"…"}` ONLY; recursive `Cat{name, kids:Cat[]}` loses the cycle (`kids.items` degrades to bare `{"type":"object"}` where zod emits `{"$ref":"#"}`); `readonly id: string` is ignored where zod emits `readOnly: true`. Settled with the user: intersections FLATTEN (a single flat object schema via `checker.getPropertiesOfType` beats `allOf`; reserve `allOf` for intersections whose constituents are not all objects); `readonly` support is WANTED (`ts.ModifierFlags.Readonly` = 8 and `ts.getCombinedModifierFlags` are available in typescript 5.9.3).

## Changes

Analyzer support for intersection flattening, readonly modifiers, and cycle detection; JSON-schema emission for readOnly and $ref.

## Design

Settled decisions:

- **Intersections flatten.** For an intersection whose constituents are all object-like, analyze via `checker.getPropertiesOfType(intersectionType)` — one flat property set (already merged by the checker), producing a normal object schema AND a normal object validator. Non-all-object intersections (e.g. `string & {brand}` beyond the existing brand path) emit `allOf` of the constituent schemas — the reserved case. Root intersections flow through the same path (analyzeRootType), never the bare-`$schema` output.
- **readonly.** Property analysis reads `ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Readonly` into a new `readonly` flag on `AnalyzedProperty`; `src/compiler/json-schema.ts` emits `readOnly: true` for it. Validator behavior UNCHANGED (readonly is a compile-time-only contract; verified working `readonly string[]` validation stays as-is).
- **Recursion.** Analysis carries a seen-map keyed by type identity. A cycle back to the ROOT type emits `{"$ref": "#"}` at the recursion point (zod parity, measured); a cycle to a non-root named type emits a `$defs` entry keyed by the type name with `{"$ref": "#/$defs/<name>"}` at use sites. Validator generation keeps its existing (verified terminating) recursion handling.
- Discretion point: anonymous non-root cycle naming; criterion — deterministic keys (stable across two identical compiles, no counters leaking unrelated state), and any unsupported cycle shape is a COMPILE error naming the type, never a silently-wrong schema.

Test plan: `test/compiler/json-schema.test.ts`: `{both: A&B}` emits merged `properties` with both sides' fields and correct `required`; root `A&B` emits `type: object` + full `properties`; `Cat` emits `$ref` for `kids`; `readonly id` emits `readOnly: true`; already-correct outputs (literal unions → `enum`, tuples → `prefixItems`+`items:false`+`minItems`, discriminated unions → `anyOf` with `const`) asserted unchanged. `test/compiler/type-analyzer.test.ts`: flattened intersection validates (both sides' properties enforced) and readonly flag lands in the IR.

## Reads

- src/compiler/json-schema-constraints.ts — the constraint extractor composes with the emitter this item extends (folded annotations must not collide with readOnly emission)
- test/utils.ts — transform harness

## Acceptance

- The four measured gap repros emit the schemas above; the three confirmed-correct emissions stay byte-stable.
- Flattened intersections VALIDATE both constituents' properties at runtime.
- 0 regressions in test/compiler/json-schema.test.ts and test/compiler/type-analyzer.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/json-schema.test.ts test/compiler/type-analyzer.test.ts
- npx tsc --noEmit

## Notes

Do NOT emit draft-07 (constraint). Catch-all index signatures (declared properties + index signature together) stay OUT of scope — pure `Record<string,T>` support is unchanged. runtime-tojsonschema later MOVES src/compiler/json-schema.ts to a neutral home; land this first so the move carries the finished emitter.
