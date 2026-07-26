---
type: fix
recommended-model: opus
status: PENDING
priority: P0
files-own: [src/compiler/validator.ts, test/compiler/recursive-types.test.ts]
files-shared: [src/compiler/type-analyzer.ts]
tests: [test/compiler/recursive-types.test.ts]
---

# Generated validator recurses through named functions instead of dropping ref nodes

## Rationale

The analyzer cuts recursive back-edges into ref nodes carrying no properties (src/compiler/type-analyzer.ts:116, :126). src/json-schema.ts:142-145 honours ref and emits an anchor; src/compiler/validator.ts never reads the field — a grep returns zero hits — so generateObjectValidation builds an empty container from an empty properties list and assigns it (:417-421). A recursive sub-object is therefore not merely unvalidated, its data is replaced by an empty object: Node with next set to a real value validates ok:true and returns next as an empty object. No recursive-type test exists in any validator suite.

## Changes

The generated validator gains named recursive functions — one per `$defs` entry plus one for the root — so a `ref` node emits a CALL rather than an inline body, and each carries a depth ceiling that pushes a named error on a cyclic INPUT instead of spinning. `src/compiler/validator.ts` stops silently replacing recursive sub-objects with `{}`; `src/compiler/type-analyzer.ts` supplies the stable `$defs` keys the emitted function names derive from. `src/json-schema.ts` is unchanged and is the reference behavior being matched.

## Design


Settled decisions. Root cause: the analyzer emits a `ref` node for every recursive back-edge and only ONE of the two downstream emitters knows what a `ref` is.

- **The defect.** `analyzeObjectShape` returns `{ name, optional, ref: '#', type: 'object' }` for a back-edge to the root (`src/compiler/type-analyzer.ts:116`) and `{ …, ref: '#/$defs/<key>', type: 'object' }` for a non-root recursive type (`:126`). Neither carries `properties`. `src/json-schema.ts:142-145` honours this and emits `$ref`. `src/compiler/validator.ts` never reads the field — a repo grep for `ref` in that file returns ZERO hits — so `generateObjectValidation` falls through to `prop.properties || []` (`:388`), produces an empty `parts`, and then executes `let o = {}; ${parts}; ${target} = o;` (`:417-421`). The recursive sub-object is therefore not merely unvalidated: its DATA IS REPLACED BY AN EMPTY OBJECT. For `type Node = { value: number; next?: Node }`, input `{value: 1, next: {value: 2}}` validates to `{value: 1, next: {}}`, ok:true, no error.
- **Decision — the generated validator recurses through a named function, one per `$defs` entry plus one for the root.** Emit each recursive shape as a hoisted local function taking `(source, target-slot, path)` and have a `ref` node emit a CALL to it instead of an inline body. The root ref (`'#'`) calls the top-level validator's own body, which therefore must also be a named function rather than an anonymous arrow. This is the only shape that terminates: inlining a recursive type is by definition non-terminating, which is why the analyzer cut the edge in the first place.
- **Guard the recursion at runtime.** A cyclic INPUT value (an object whose property points back at itself) would otherwise spin forever in the emitted validator even though the TYPE graph is finite. The generated recursive functions carry a depth parameter with a fixed ceiling, pushing a named error on exhaustion rather than throwing. The ceiling is a constant in `src/compiler/validator.ts`, not a magic number at each call site.
- **`$defs` naming is the analyzer's, not the generator's.** `defName`/`defSchema` (`src/compiler/type-analyzer.ts:449-474`) already mint stable keys and the emitted function names derive from them via `uid`, so a type appearing in both `$defs` and the validator gets one definition in each emitter with no third naming scheme.
- **Do NOT change `src/json-schema.ts`.** Its `ref` handling is correct and is the reference behaviour this item brings the validator into line with. It is a read, not an edit target.

Test plan (`test/compiler/recursive-types.test.ts`, a new suite — there is currently NO recursive-type coverage in any validator suite):

1. The repro: `type Node = { value: number; next?: Node }` with input `{value: 1, next: {value: 2}}` returns `ok: true` and data DEEP-EQUAL to the input. This fails before the fix, returning `{value: 1, next: {}}`.
2. Nested three deep round-trips with every level's data intact.
3. A recursive type with an INVALID leaf (`{value: 1, next: {value: 'x'}}`) returns `ok: false` with the error path pointing at `next.value` — proving the back-edge validates rather than merely copying.
4. Mutual recursion (`type A = { b?: B }`, `type B = { a?: A }`) round-trips both directions, covering the `$defs` path as distinct from the root `'#'` path.
5. A cyclic INPUT (`let o = {value: 1}; o.next = o;`) terminates with a named depth error instead of hanging — asserted under a vitest timeout.
6. The JSON Schema emitted for the same recursive type still carries `$ref`/`$defs` exactly as at baseline, proving src/json-schema.ts was untouched.

## Reads

- src/json-schema.ts — the `ref` handling at :142-145, the correct behavior this item brings the validator into line with
- src/compiler/types.ts — GeneratorContext / PathMode, threaded through the new recursive functions

## Acceptance

- `type Node = { value: number; next?: Node }` fed `{value: 1, next: {value: 2}}` returns `ok: true` with data DEEP-EQUAL to the input — it returns `{value: 1, next: {}}` before the fix.
- An invalid recursive leaf reports `ok: false` with the error path pointing at `next.value`; mutual recursion round-trips both directions, covering the `$defs` path as well as the root `'#'` path.
- A cyclic INPUT terminates with a named depth error, asserted under a vitest timeout rather than hanging the suite.
- The JSON Schema emitted for the same recursive type still carries `$ref`/`$defs` exactly as at baseline.
- 0 regressions in test/compiler/recursive-types.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/recursive-types.test.ts
- npx tsc --noEmit

## Notes

Compiler test harness (rebuilt for TS7): test/utils.ts no longer exposes `createProgram`. Use `compile(code)` → `{ checker, program, sourceFile }` (backed by `languageService.scratch`), `transformRaw(code)` for the data plugin, or `transformWith(plugins, code)` for any plugin set. `ts.createProgram`/`createCompilerHost`/`createSourceFile`/`ts.sys` no longer exist. Fixture types must not be named after DOM globals (`Node`, `Document`, `Range`): a scratch file is a script, not a module, so the name collides with the global instead of shadowing it — the harness pins `lib: ['es2020']` to keep that off the DOM type graph.
