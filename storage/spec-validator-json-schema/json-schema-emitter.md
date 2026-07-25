---
type: feature
recommended-model: opus
status: PENDING
depends-on: [agent-test-script, analyzer-root-entry, json-schema-public-surface]
files-own: [src/compiler/json-schema.ts, tests/json-schema-emitter.ts]
tests: [tests/json-schema-emitter.ts]
api-impact: none
---

# JSON Schema emitter: AnalyzedProperty IR → canonical Draft 2020-12 text

## Rationale
The core of the feature: a pure compile-time function that turns the analyzer IR into JSON Schema Draft 2020-12 text. It mirrors the structural precedent of `generateValidator`'s per-type table dispatch (S5 — src/compiler/validator.ts:26-40) but emits data, not code, so it builds plain objects and serializes them canonically instead of using the `code` template tag. The canonical text doubles as the per-file dedup key in json-schema-transform-wiring, so determinism is a hard contract, not a nicety.

## Changes
New compiler module: converts a root `AnalyzedProperty` (plus optional per-property constraint fragments from the extractor) into a single-line, key-sorted JSON text whose parse is a valid Draft 2020-12 schema.

## Design

**Public contract** (the only export):

```ts
const generateJsonSchema = (root: AnalyzedProperty, constraints?: Map<string, JsonSchema>): string
```

- Returns single-line canonical JSON text. `$schema: 'https://json-schema.org/draft/2020-12/schema'` appears on the ROOT object only.
- Canonical = every object's keys serialized in sorted order at every depth via an internal recursive stringifier using the analyzer's own comparator idiom (`a < b ? -1 : a > b ? 1 : 0`, S4 line 344) — never bare `JSON.stringify` on the whole tree (V8 reorders integer-like keys such as a `'0'` property name). Identical (IR, constraints) input MUST produce byte-identical output.
- The IR is READ-ONLY (memoized + mutated-in-place upstream, S4 lines 306-312): never mutate `root` or any nested property.

**Emission table** — internal `function` per IR type, dispatched through a module-level `Record<string, ...>` mirroring TYPE_VALIDATORS (S5); IR type → schema:

| IR `type` | Emission |
|---|---|
| any, unknown | `{}` (empty schema; also for Function/Promise which the analyzer folds to unknown) |
| never | `{ not: {} }` |
| null | `{ type: 'null' }` |
| boolean | `{ type: 'boolean' }` |
| number | brand `integer` → `{ type: 'integer' }`; else (incl. brand `float`, user brands) `{ type: 'number' }` |
| bigint | `{ type: 'integer' }` — JSON numbers are arbitrary-precision by grammar, so integer is lossless at the schema level |
| string | `{ type: 'string' }` — brand `template` and user-registered brands add NOTHING (brand bodies are arbitrary user code, S6 — src/compiler/validators.ts; no keyword is derivable) |
| date | `{ format: 'date-time', type: 'string' }` (zod precedent per the dispatch's E15) |
| literal, enum | 1 literal → `{ const: value }`; >1 → `{ enum: [...] }` with values sorted by (literal type, then String(value)) for canonical identity — enum order is semantically irrelevant in 2020-12 |
| array | `{ items: <emit(itemType)>, type: 'array' }` (missing itemType → `items: {}`) |
| tuple | `{ items: false, minItems: <required count>, prefixItems: [<emit each>], type: 'array' }` — `items: false` caps length at prefixItems.length, `minItems` enforces the lower bound (optional trailing elements) |
| record | `{ additionalProperties: <emit(indexType)>, type: 'object' }` |
| object | `{ additionalProperties: false, properties: {...}, required: [...], type: 'object' }`; `required` = names of non-optional properties (already alphabetical, S4 line 344), OMITTED when empty; `properties` omitted when the IR carries none (the analyzer's circular-reference fallback, S4 lines 217-219, emits bare `{ type: 'object' }`); `never`-typed properties are skipped entirely (mirrors generateValidator) |
| union | `anyOf: [...]` = (literal batch as one const/enum member when `literals` non-empty) + each `unionTypes` branch emitted recursively |

**Constraint merge** (root object's top-level properties only — config mirrors `ValidatorConfig<T>`): for each property name present in `constraints`, shallow-merge the fragment's keywords into the structural schema BEFORE the nullable wrap. `fragment.type === 'integer'` replaces a structural `'number'` (the only type override); every other fragment keyword copies over. Fragments arrive intra-conflict-resolved from config-constraint-extractor (its job, not this module's).

**Nullable wrap** (after merge): `nullable` property → if the merged schema is EXACTLY `{ type: <single string> }` with no other keys, collapse to `{ type: [<t>, 'null'] }`; otherwise `{ anyOf: [<schema>, { type: 'null' }] }`. Assertion keywords like `minLength` are type-scoped in 2020-12, so both forms are sound; the collapse just keeps the common case compact. `optional` never reaches emission — it is consumed by the parent object's `required` computation; root-level `optional` is ignored.

**Discretion points**: internal function decomposition and naming; the exact stringifier implementation; whether the emission table returns objects or text fragments internally — criterion for all three: the public contract (byte-determinism, table semantics above) holds and the file mirrors the repo's layout standards (module-level constants, internal `function` declarations, exported const arrow at bottom).

**Tests** (`tests/json-schema-emitter.ts`, flat convention): build IR through `analyzeRootType` + `createProgram` from tests/utils.ts; `JSON.parse` the returned text and deep-equal against expected schemas for: E15's User shape, every table row above (incl. bigint, Date, tuple with optional element, record, circular object fallback, mixed union, pure literal union, single literal), nullable collapse vs anyOf form, constraint merge incl. the integer type-override, determinism (two calls byte-equal), and required-omission on all-optional objects.

## Reads

- src/compiler/type-analyzer.ts — the AnalyzedProperty IR contract, union folding, sort and circular-ref behavior the table consumes
- src/compiler/validator.ts — the table-dispatch precedent and repo codegen layout to mirror
- src/compiler/validators.ts — proof that user-registered brand bodies are arbitrary code, so the string/number rows emit no brand-derived keyword
- src/types.ts — the JsonSchema type the signature and fragments use
- tests/utils.ts — createProgram harness for IR construction in tests

## Acceptance
0 regressions in tests/json-schema-emitter.ts, run scoped; every emission-table row above has at least one asserting test; output is byte-deterministic across repeated calls on the same IR; `JSON.parse(generateJsonSchema(...))` succeeds for every test case.

## Checks
- npx tsc --noEmit
- pnpm agent:test tests/json-schema-emitter.ts

## Notes
- The emitted value is a plain mutable object at runtime (no `Object.freeze`, no `as const` — transform output must stay valid in both TS and JS contexts, and freeze adds startup cost for no consumer contract); consumers treat schemas as immutable, same as every other generated artifact in this package.
- Known parity limitations vs zod, documented not solved: recursive types emit bare `{ type: 'object' }` (the analyzer already loses the cycle — no `$ref` in v1); objects mixing declared properties WITH an index signature lose the index part (analyzer drops it; consistent with `build()`'s own extraction behavior).
- `pattern` on AnalyzedProperty is declared but never written by the analyzer today (verified: src/compiler/type-analyzer.ts:42 has no assignment anywhere) — the emitter must not read it.
