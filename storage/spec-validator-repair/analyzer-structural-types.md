---
type: fix
recommended-model: opus
status: PENDING
priority: P1
source: findings C10, C11, C12, C14, C19 (audit section C)
depends-on: relocate-tests-and-benches
files-own: [src/compiler/type-analyzer.ts, src/compiler/validator.ts, test/compiler/type-analyzer.test.ts, test/compiler/type-analyzer-root.test.ts]
tests: [test/compiler/type-analyzer.test.ts, test/compiler/type-analyzer-root.test.ts]
---

# Analyze function, Map/Set, tuple-rest, and non-object root types

## Rationale

C10 (P1): `src/compiler/type-analyzer.ts:199` special-cases only symbols named `Function`/`Promise`; a bare `() => void` has symbol name `__type`, falls to the object branch, and ALWAYS fails (`must be an object`). C11 (P1): `Map`/`Set` fall the same way — prototype methods become required properties (21 errors for `{m:Map,s:Set}` including `m.__@iterator@268`). C14 (P1): `:250-256` consults only `ElementFlags.Optional`, so `[number, ...string[]]` emits `length !== N` and rejects both `[1]` and `[1,'a','b']`. C12 (P1): `:366-382` unconditionally calls `extractProperties` — `type D = string[]` yields 33 errors over `Array.prototype` and REJECTS `['a']`; `type D = string` yields 47 errors; a root union yields an EMPTY validator accepting anything. `analyzeRootType` (added for toJsonSchema) already handles roots correctly — reuse it. C19 (P2): dead code — `PropertyType 'enum'` (`:22`), `generateEnumValidation` (`validator.ts:162-173`), the `enum:` entry in `TYPE_VALIDATORS` (`validator.ts:30`), `AnalyzedProperty.pattern` (`:42`), and the empty `if (prop.brand === 'template') {}` (`validator.ts:374-375`).

## Changes

Type analysis and its validator emission for structural kinds the analyzer currently misclassifies; root-type analysis unified on the path toJsonSchema already proved; dead analyzer/emitter code deleted.

## Design

Settled decisions:

- **Callable types (C10).** A type with `getCallSignatures().length > 0` (and no properties of interest) analyzes as kind `function`; emission is a `typeof v === 'function'` check. Promise keeps its existing handling.
- **Map/Set (C11).** Detect via the type's target symbol being the global `Map`/`Set` (checker-resolved, not name-string on `__type`). Emission: `instanceof Map` / `instanceof Set` plus PER-ENTRY validation of the instantiated type args (keys+values for Map, values for Set), consistent with array element handling — these values arrive from in-process data, and validating the container without entries would be a silent hole. Entry errors use error-path-fidelity's segment paths (`m[<key>]`).
- **Tuple rest (C14).** Read `ElementFlags.Rest`/`Variadic`: fixed prefix validates positionally; length check becomes `>= <required prefix count>`; rest elements validate in a loop over the tail with indexed paths.
- **Non-object roots (C12).** `build<T>()` routes root analysis through `analyzeRootType` (the toJsonSchema producer) instead of unconditional `extractProperties`: primitive roots emit the primitive check; array roots validate elements; union roots emit branch validation (never the empty `{}` validator). The no-throw root-guard contract is output-construction-safety's; this item owns WHICH root kinds exist.
- **Dead code (C19).** Delete the five dead artifacts listed in the Rationale; enums keep analyzing as `literal` (verified working).
- Discretion point: whether Map keys of non-primitive type are validated deeply or rejected at ANALYSIS time as unsupported with a compile error; criterion — never emit a validator that silently skips a declared type constraint.

Test plan: extend `test/compiler/type-analyzer.test.ts` (mirror) and `test/compiler/type-analyzer-root.test.ts` (root sweep), transform + execute: `{fn:()=>void}` accepts a function, rejects a string; `{m: Map<string,number>, s: Set<string>}` accepts valid instances, rejects plain objects and wrong entry types; `[number, ...string[]]` accepts `[1]` and `[1,'a','b']`, rejects `[1,2]` and `[]`; root `string[]` accepts `['a']` rejects `[1]`; root `string` accepts `'x'`; root `{a:number}|{b:string}` validates branches (no empty validator); grep-level assertion that `generateEnumValidation` and `'enum'` kind are gone is done via behavior (numeric/string enums still validate — the verified literal path).

## Reads

- src/compiler/json-schema.ts — analyzeRootType's consumer contract on the toJsonSchema side (root reuse must not disturb it)
- test/utils.ts — transform harness

## Acceptance

- All six measured misclassification repros behave per the test plan; enums/literals/recursion (verified working) unchanged.
- 0 regressions in test/compiler/type-analyzer.test.ts and test/compiler/type-analyzer-root.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/type-analyzer.test.ts test/compiler/type-analyzer-root.test.ts
- npx tsc --noEmit

## Notes

sbc-compile-time-parity consumes the Map/Set/typed-array analysis kinds this item introduces — keep the new kind names stable once landed.
