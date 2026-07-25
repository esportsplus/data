---
type: feature
recommended-model: opus
status: PENDING
priority: P1
source: audit section G (settled API redesign) + Q1 answer
api-impact: breaking
awaiting-approval: public-API break
depends-on: [annotated-validator-types, repair-validator-config-compilation]
files-own: [src/compiler/index.ts, src/compiler/json-schema-constraints.ts, src/compiler/validator.ts, src/types.ts, test/compiler/annotations.test.ts, test/utils.ts]
tests: [test/compiler/annotations.test.ts]
---

# Compiler strips annotation chains, folds schema, fills defaults

## Rationale

The redesign's compiler half (section G, settled): the compiler strips `.describe(…)/.default(…)/.meta(…)` chains and folds the annotations into the emitted schema/validator — `src/compiler/json-schema-constraints.ts` already walks the config and resolves builtin callees against the import surface, and peeling chain calls off the outside is the same AST walk. `.default()` is REQUIRED with a parse-time effect (ai-orchestrator's `z.array(z.string()).default([])` both emits `default: []` AND fills at parse). `description`/`title`/`examples` are NOT required for parity — build the capability, scope it optional, emit nothing when unused, never retro-annotate. Return shape: Q1 was ANSWERED against the callable recommendation — the user's words: "build() should just return a pojo with the inlined validate, toJsonSchema". `build<T>()` therefore returns a PLAIN OBJECT, a BREAKING change to today's callable `ValidatorFn<T>` return (every `v(input)` call site becomes `v.validate(input)`), carried by this item's `api-impact: breaking` + `awaiting-approval` gate.

## Changes

Config extraction, JSON-schema folding, validator emission for defaults, and build's return shape.

## Design

Settled decisions:

- **Chain peel.** In the config walk, unwrap trailing `.describe(arg)/.default(arg)/.meta(arg)` call chains from the OUTSIDE in, collecting annotations per property; the BASE expression (builtin factory call, identifier, or inline arrow) flows into the hoisted-validator pipeline repair-validator-config-compilation built. Chain calls never reach emitted code (the runtime no-ops exist only for the unconfigured-plugin path). Peeling handles chains on array-config ELEMENTS too (annotations attach per-entry; schema folding merges per property).
- **Schema folding.** Annotations land in the property's emitted JSON schema: `describe` → `description`, `default` → `default`, `meta` → shallow-merged extra members (title/examples/whatever the object literal carries — static object literals only; a non-literal meta argument is a compile error naming file+line). Emit NOTHING when unused (parity constraint).
- **Parse-time default fill (settled YES).** A property with a `.default(v)` annotation whose input value is ABSENT (`undefined`/missing key) writes the default into `data` and SKIPS that property's structural checks and config validators — matching zod `.default()`. The default expression is hoisted to module scope; a per-call fresh copy is required for mutable defaults (arrays/objects) — emit a factory-style hoist (`() => ([])` invocation) for array/object literals so callers never share one instance; primitives hoist as plain consts.
- **Plain-object return (Q1 ANSWERED — overrules the callable recommendation).** The build call site is replaced by a hoisted module-level plain object literal — everything inlined, no wrapper allocation beyond the literal itself: `{ toJsonSchema: () => _schema_N, validate: <the generated validator function> }`. Settled member set: exactly `validate` and `toJsonSchema`, nothing else; `toJsonSchema` is a METHOD (arrow property) returning the hoisted schema const — a method, not an eager property, so schema emission stays lazy and the hoisted-const dedup built by compiler-import-detection survives untouched (two identical `build<D>()` calls share `_schema_N` and the validator body; the second call site references the same hoisted object). `src/types.ts`: `Schema<T> = { toJsonSchema(): JsonSchema; validate: ValidatorFn<T> }`, declared as `build<T>`'s return type. BREAKING consequence carried here: `v(input)` → `v.validate(input)`.
- **In-repo call-site sweep (breaking-change carriage).** Suites reach built validators through `test/utils.ts`'s `createValidator` — update that helper to return the POJO's `validate` member, so every pre-existing suite's `v(input)` call shape survives unchanged; the annotation suite (and build-pipeline-e2e-tests after it) asserts the POJO surface directly. The implementer sweeps the repo for any remaining direct caller of a `build` result (none are expected outside test/utils.ts and the suites this spec already rewrites); a caller found outside the declared surface is flagged as a deviation, never silently edited.
- **Standalone `validator.toJsonSchema<T>()` is KEPT** as a shorthand: removing it would be a second, gratuitous public-API break, and runtime-tojsonschema's parity vectors consume it. `build<T>().toJsonSchema()` and the standalone form must emit identical schemas (one hoisted-const pipeline serves both).
- Discretion point: whether annotation collection lives inside json-schema-constraints.ts's existing walker or a sibling function in the same module; criterion — ONE walk over the config AST total (no second pass), and the constraint extractor's existing outputs stay byte-stable for annotation-free configs.

Test plan (new `test/compiler/annotations.test.ts`, transform + execute): `.describe` lands as `description` in `v.toJsonSchema()`; `.default([])` emits `default: []` AND fills a missing property at parse with a FRESH array per call (two calls, mutate one, assert isolation); `.meta({title:'x'})` merges; no `.describe(`/`.default(`/`.meta(` text survives in emitted output; chain on an array-config element works; an annotation-free config emits schema byte-identical to pre-change; the returned value is a PLAIN OBJECT (`typeof v === 'object'`, not callable) exposing exactly `validate` + `toJsonSchema`, `v.validate(input)` validates, `v.toJsonSchema()` returns the hoisted schema, and two identical builds share one hoisted schema const; async-config chains still produce async `validate` members.

## Reads

- src/compiler/json-schema.ts — generateJsonSchema, the emitter the folded annotations flow through
- src/compiler/error.ts — emitString for annotation literals embedded in generated code
- test/utils.ts — transform harness

## Acceptance

- The G target snippet (min chain + range + inline arrow) compiles and behaves: custom messages fire, description/default present in schema, absent `name` fills `'anon'`.
- 0 regressions in test/compiler/annotations.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/annotations.test.ts
- npx tsc --noEmit

## Directives

1. src/types.ts — add the plain-object Schema<T> ({ toJsonSchema(): JsonSchema; validate: ValidatorFn<T> }) and the annotation-payload types the extractor emits.
2. src/compiler/json-schema-constraints.ts — chain-peeling extraction producing per-property {base expression, annotations}.
3. src/compiler/index.ts, src/compiler/validator.ts — wire annotations into schema emission, default-fill emission, and the hoisted plain-object-literal return.
4. test/utils.ts, test/compiler/annotations.test.ts — createValidator unwraps `.validate` (pre-existing suites keep their call shape); the transform+execute suite per the test plan asserts the POJO surface.

## Notes

Q1 is ANSWERED (plain object) and applied throughout — no open alternative remains. test/utils.ts is files-own for the `.validate` unwrap only; 15 suites consume it (ownership map), so the change must keep every existing helper signature intact. readme-accuracy folds the call-site documentation change (`v(input)` → `v.validate(input)`) into its correction list. `describe`/`meta` are OPTIONAL capability — ai-orchestrator parity does not use them (its per-field meaning rides in catalog.vocabulary); never bulk-annotate anything.
