---
type: feature
recommended-model: sonnet
status: PENDING
depends-on: agent-test-script
files-own: [src/compiler/type-analyzer.ts, tests/type-analyzer-root.ts]
tests: [tests/type-analyzer-root.ts, tests/type-analyzer-edge.ts]
api-impact: none
---

# analyzeRootType: root-level type analysis entry point

## Rationale
`analyzeType` only ever returns the ROOT type's object properties: it calls `checker.getTypeAtLocation` then `extractProperties`, so a non-object root (`string[]`, `'a' | 'b'`, `Record<string, number>`, a primitive) yields `properties: []` and the root's own shape is lost (S4 — src/compiler/type-analyzer.ts:350-366). `build()` tolerates this because it always validates object payloads; `toJsonSchema<string[]>()` cannot. The emitter needs a root-level entry that returns the full `AnalyzedProperty` IR for ANY root type, without touching `analyzeType`'s behavior.

## Changes
Type analyzer module gains a second exported entry point that analyzes the root type through the existing per-property machinery. `analyzeType`, its cache, and every existing internal function are byte-identical in behavior.

## Design
1. In `src/compiler/type-analyzer.ts`, add a second module-level cache beside the existing one: `let rootCache = new WeakMap<ts.TypeNode, AnalyzedProperty>();` — NEVER share the `analyzeType` WeakMap (different value shapes).
2. Add the exported const arrow (beside `analyzeType`, alphabetical within the export group):

```ts
const analyzeRootType = (typeNode: ts.TypeNode, checker: ts.TypeChecker): AnalyzedProperty => {
    let cached = rootCache.get(typeNode);

    if (cached) {
        return cached;
    }

    let type = checker.getTypeAtLocation(typeNode),
        result = analyzePropertyType(type, checker.typeToString(type), false, checker, new Set<ts.Type>());

    rootCache.set(typeNode, result);

    return result;
};
```

3. Add `analyzeRootType` to the export statement.
4. Tests (`tests/type-analyzer-root.ts`, flat vitest convention, built on `createProgram` from `tests/utils.ts`): object root (properties match `analyzeType`'s for the same node), `string[]` root → `type: 'array'` with string itemType, pure literal-union root → `type: 'literal'` with both literals, `Record<string, number>` root → `type: 'record'` with number indexType, primitive root, `string | null` root → string with `nullable: true`, tuple root, and cache identity (second call returns the SAME object reference).

## Reads
- src/compiler/type-analyzer.ts — analyzePropertyType/analyzeUnionType internals the new entry reuses; the existing WeakMap pattern being mirrored (lines 55, 350-366)
- tests/utils.ts — createProgram harness for building a checker in tests
- tests/type-analyzer-edge.ts — existing analyzer test idiom to match

## Acceptance
0 regressions in tests/type-analyzer-edge.ts and tests/type-analyzer-root.ts, run scoped; `analyzeType`'s observable behavior unchanged (the existing edge suite is the evidence); non-object roots return their own shape rather than `properties: []`.

## Checks
- npx tsc --noEmit
- pnpm agent:test tests/type-analyzer-root.ts tests/type-analyzer-edge.ts

## Notes
The returned IR must be treated READ-ONLY by every consumer: `analyzeUnionType` mutates the single-constituent result in place when folding null/undefined (S4 — lines 306-312) and both caches memoize, so a consumer mutation would poison later reads. A root union with `undefined` sets `optional: true` on the root — meaningless in JSON (documents no key); the emitter ignores root-level `optional`.
