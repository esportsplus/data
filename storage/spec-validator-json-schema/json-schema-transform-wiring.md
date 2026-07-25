---
type: feature
recommended-model: opus
status: PENDING
depends-on: [agent-test-script, analyzer-root-entry, config-constraint-extractor, json-schema-emitter, json-schema-public-surface]
files-own: [tests/json-schema.ts]
files-shared: [src/compiler/index.ts]
tests: [tests/json-schema.ts, tests/transformer.ts]
api-impact: none
---

# Transform wiring: detect toJsonSchema calls, hoist per-file schema consts

## Rationale
The user's mandated output shape (E15): a `toJsonSchema<T>(config?)` call compiles to a reference to a module-level hoisted `const` holding the schema, one const per unique schema per file, so N call sites share one object identity (answered Q0b). The plugin entry already detects `build` calls through `visit()` (S3 — src/compiler/index.ts:79-129); this item extends the same machinery and uses the coordinator's existing-but-unused `prepend` hook (S8) for the hoist. Neither build-tool plugin file changes: `prepend` is applied entirely inside `coordinator.transform` (verified — coordinator.js applyPrepend inserts after the last leading import, and the plugins just pass the plugin object through).

## Changes
Compiler plugin entry: detection accepts a second method name; transform gains a toJsonSchema branch that emits prepend + identifier replacements with per-file text-keyed dedup. Build's transform path is byte-identical in behavior.

## Design
1. **DetectedCall** gains `method: 'build' | 'toJsonSchema'`.
2. **visit()**: both accepted shapes (`validator.<m><T>()` incl. aliased import, and `ns.validator.<m><T>()`) match when `methodName === 'build' || methodName === 'toJsonSchema'`, under the SAME `imports.includes(checker, ..., PACKAGE_NAME, 'validator')` guards — toJsonSchema follows build's namespace rules exactly, including the currently-disputed behavior tests/namespace-imports.ts:140 asserts against (that pre-existing failure is out of scope; do not change namespace semantics). `typeArguments.length > 0` stays required — an untyped call is not transformed and hits the runtime stub, same as build. A second type argument on a toJsonSchema call is ignored.
3. **patterns**: append `'.toJsonSchema'` to the `patterns` array (cheap pre-filter self-documentation; the existing `'validator'` entry already matches via import text).
4. **transform()**, per file: `let hoisted = new Map<string, string>()` (canonical text → const name; function-local, which IS the per-file scope). For each detected call with `method === 'toJsonSchema'`, compute EAGERLY inside transform() — not inside the replacement's `generate` callback:
   - `root = analyzeRootType(call.typeArg, ctx.checker)`
   - `fragments = call.configArg ? extractConstraints(call.configArg, root, ctx.sourceFile, ctx.checker) : undefined`
   - `text = generateJsonSchema(root, fragments)`
   - dedup: existing `hoisted` entry → reuse its name; else `name = uid('schema')`, `hoisted.set(text, name)`, and push `` `const ${name} = ${text};` `` onto a `prepend: string[]` accumulator.
   - `replacements.push({ generate: () => name, node: call.node })`
   The eager ordering is load-bearing: the returned TransformResult must already carry `prepend`, while `generate` callbacks run later in `applyIntents` (S8 — coordinator.js:36-45, 150-188); the coordinator applies replacements first, then prepend, re-parsing between stages, so const declarations land after the leading imports of the already-replaced code.
5. **ImportIntent**: unchanged mechanism — any detected call (either method) pushes `remove: ['validator']` once, exactly as today. Validator-builtin imports left dangling by a removed config expression are NOT removed: the package is `sideEffects: false`, bundlers tree-shake them, and tsc output importing them is benign (implementer must not attempt reference-scanning removal in v1).
6. **Return contract**: `{ imports, prepend, replacements }`; `prepend` omitted when no toJsonSchema call was found (build-only files return the exact shape they return today).
7. **Tests** (`tests/json-schema.ts`, using `transformCode`/`createProgram` from tests/utils.ts):
   - E15 shape end-to-end: transformed code contains one hoisted const whose extracted initializer `JSON.parse`s to the expected schema ($schema root-only, additionalProperties false, required, format/minLength/maxLength from config);
   - dedup: two `toJsonSchema<User>()` calls in one file → exactly ONE `const` + both call sites replaced by the same identifier; two DIFFERENT types → two consts;
   - optional/nullable property mapping visible in output;
   - namespace form `data.validator.toJsonSchema<T>()` transforms (mirror only the GREEN namespace-imports cases — never the :140 expectation);
   - mixed file: `build` + `toJsonSchema` both transform, build output unchanged in shape;
   - non-static config arg (identifier) → schema still hoisted, constraint keywords absent;
   - runtime stub: `validator.toJsonSchema()` from src/index.ts throws the must-be-transformed error (message asserted).

Discretion point: whether the toJsonSchema branch lives inline in `transform()` or in a small internal `function` beside `transform` — criterion: `visit`/`trace`/build-path code stays untouched and the file keeps its existing layout order.

## Reads
- src/compiler/index.ts — detection, guards, transform flow, ImportIntent handling being extended
- src/compiler/type-analyzer.ts — analyzeRootType entry
- src/compiler/json-schema.ts — generateJsonSchema contract
- src/compiler/json-schema-constraints.ts — extractConstraints contract
- node_modules/@esportsplus/typescript/build/compiler/coordinator.js — applyPrepend/applyIntents ordering the eager-computation rule depends on
- node_modules/@esportsplus/typescript/build/compiler/types.d.ts — TransformResult.prepend shape
- tests/utils.ts — transformCode/createProgram harness (exports: createProgram, createValidator, mightNeedTransform, transformCode — there is no transformRaw)
- tests/namespace-imports.ts — the green namespace cases to mirror and the :140 case to avoid
- src/index.ts — stub error message asserted by the stub test

## Acceptance
0 regressions in tests/json-schema.ts and tests/transformer.ts, run scoped; per-file dedup produces exactly one const per unique schema text; build-only files produce byte-identical transform output to pre-change behavior (tests/transformer.ts is the evidence); the pre-existing tests/namespace-imports.ts:140 failure neither blocks nor is fixed by this item.

## Checks
- npx tsc --noEmit
- pnpm agent:test tests/json-schema.ts tests/transformer.ts

## Verify
pnpm agent:test tests/json-schema.ts

## Notes

- tests/utils.ts `transformCode` passes `shared` in the coordinator's `root` parameter position; harmless for single-plugin runs (root is only touched between chained plugins) — do not "fix" it here and do not rely on `ctx.shared` (cross-file state was explicitly rejected, Q0b).
- New test files are auto-discovered by vitest's `tests/**/*.ts` include; vitest.config.ts needs a change ONLY if a non-suite helper file is added — this item adds none.
- CRITIC (regression exposure): this item rewrites `visit()`s property-access branches and appends to `patterns` — the exact code `tests/namespace-imports.ts` covers (its green cases at :78-95 and its namespace-transform cases) — yet that suite appears only in `## Reads` and in NO scoped gate, because its baseline red at :140 would block the item. A regression in its GREEN cases is therefore invisible to `tests/json-schema.ts` and `tests/transformer.ts`. Before completing, run `pnpm agent:test tests/namespace-imports.ts` manually and confirm the failure count is STILL exactly 1 (the :140 case); a second failure is a regression this item introduced, not baseline state.
