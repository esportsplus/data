---
type: feature
recommended-model: opus
status: PENDING
depends-on: [agent-test-script, json-schema-public-surface]
files-own: [src/compiler/json-schema-constraints.ts, tests/json-schema-constraints.ts]
tests: [tests/json-schema-constraints.ts]
api-impact: none
---

# Config-arg constraint extractor: builtin validator calls → keyword fragments

## Rationale
Type-only output would be strictly less than zod produces (answered Q0a): zod derives `format`/`minLength`/`minimum`/... from attached checks, and this package's structural analogue is the `config` argument — an object literal mapping property name → builtin validator call(s) (S14 — tests/compile-validators.ts:140-143 is the intended shape). The extractor statically recognizes those calls in the `configArg` AST and maps them to Draft 2020-12 keywords; everything it cannot prove degrades to the structural schema.

## Changes
New compiler module: walks a config object-literal expression, resolves each callee to this package's builtin validator surface, extracts static arguments, and produces one conflict-resolved `JsonSchema` fragment per top-level property.

## Design

**Public contract**:

```ts
const extractConstraints = (configArg: ts.Expression, root: AnalyzedProperty, sourceFile: ts.SourceFile, checker: ts.TypeChecker): Map<string, JsonSchema>
```

Returns a fragment per recognized top-level property. `configArg` not an ObjectLiteralExpression (e.g. the whole-object custom-function form, or an identifier referencing a config) → empty Map. `root.type !== 'object'` → empty Map (ValidatorConfig keys are meaningless on non-object roots).

**Recognition** — a config entry's value is one CallExpression or an ArrayLiteralExpression of CallExpressions; anything else degrades that entry. Callee shapes accepted, all verified against the import tables built ONCE per call from `imports.all(sourceFile, PACKAGE_NAME)` and `imports.all(sourceFile, PACKAGE_NAME + '/validators')` (S16 — ImportInfo.specifiers maps name→alias, so aliased named imports resolve to their canonical exported name):

1. `min(0)` — Identifier whose alias resolves in the named-import table
2. `email.rfc5322()` — PropertyAccess variant on shape 1's identifier
3. `v.min(0)` / `v.email.rfc5322()` — base Identifier whose symbol declaration is a NamespaceImport (`checker.getSymbolAtLocation` → declaration → `ts.isNamespaceImport`) from either module specifier; the first property name is the canonical validator name, a second is the variant

Shape 3 is required, not optional: the plugin already commits to namespace-qualified detection for `ns.validator.build` (S3 — src/compiler/index.ts:97-106, exercised by tests/namespace-imports.ts), so config extraction must not silently drop constraints for the same import style. Recognition is by module-specifier TEXT + exported name, mirroring how `imports.includes` guards `build` detection (S3) — it must work in the test harness where `@esportsplus/data` never resolves to a real module.

**Static arguments**: NumericLiteral, `-`-prefixed NumericLiteral, StringLiteral, NoSubstitutionTemplateLiteral, RegularExpressionLiteral. Any other argument node → degrade that validator call.

**Mapping table** (module-level; keyed by canonical name + variant, then by the property's IR type from `root.properties`) — the settled MINIMUM set; sources verified in this session:

| Builtin | number | bigint | string | array |
|---|---|---|---|---|
| min(n) | minimum: n | minimum: n | minLength: n | minItems: n |
| max(n) | maximum: n | maximum: n | maxLength: n | maxItems: n |
| range(a,b) | minimum+maximum | minimum+maximum | minLength+maxLength | minItems+maxItems |
| length(n) | — | — | minLength: n, maxLength: n | — |
| multipleOf(n) | multipleOf: n | — | — | — |
| integer() | type: 'integer' | — | — | — |
| safeInteger() | type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 | — | — | — |
| positive() | exclusiveMinimum: 0 | — | — | — |
| negative() | exclusiveMaximum: 0 | — | — | — |
| nonNegative() | minimum: 0 | — | — | — |
| nonPositive() | maximum: 0 | — | — | — |
| matches(/re/) | — | — | pattern: re.source (regex literal with ZERO flags only; any flag → degrade, JSON Schema patterns carry no flags) | — |
| startsWith(s) | — | — | pattern: '^' + esc(s) | — |
| endsWith(s) | — | — | pattern: esc(s) + '$' | — |
| includes(s) | — | — | pattern: esc(s) | — |
| email() / .html5 / .rfc5322 | — | — | format: 'email' | — |
| email.unicode | — | — | format: 'idn-email' | — |
| uuid() / .v1–.v8 | — | — | format: 'uuid' | — |
| url() | — | — | format: 'uri' | — |
| url.http | — | — | format: 'uri', pattern: '^https?://' | — |
| url.https | — | — | format: 'uri', pattern: '^https://' | — |

`esc()` = a module-level regex-escape helper (module-level constant regex, per repo standards). A `—` cell, an unlisted builtin (trim, iso, hex, phone, ...), an unknown property name, a spread/computed config key, or a property whose IR type row is absent → DEGRADE. Governing principle for the table and any extension of it: `format` keywords are annotation-only in 2020-12's default vocabulary, so they map on intent; assertion keywords (`pattern`, `min*`, `max*`, `multipleOf`, `exclusive*`, `type`) are emitted ONLY where they exactly match the runtime validator's semantics (this is why `dateString` — looser than `format: 'date-time'` — is deliberately unmapped).

**Degrade policy (settled)**: degrade is SILENT and per-call — drop that validator's keywords, keep the structural schema and every other recognized constraint. Never throw, never warn, never emit an approximate keyword. Document the policy in the module's top JSDoc.

**Intra-property conflict resolution** (multiple validators on one property, resolved INSIDE the fragment before return): lower bounds (`minimum`/`minLength`/`minItems`/`exclusiveMinimum`) take the MAX of contributed values; upper bounds take the MIN (matches runtime AND-composition); duplicate `pattern` contributions compose as `allOf: [{ pattern }, ...]` on the fragment (single pattern stays a bare `pattern` keyword); conflicting `format` values → drop ALL formats for that property; conflicting `multipleOf` → drop both (LCM would over-claim); duplicate `type: 'integer'` is idempotent.

**Discretion points**: internal walk/table decomposition; exact escape-helper regex — criterion: output table above holds and `tsc` stays green. Whether `imports.all` surfaces namespace imports is NOT assumed — shape 3 resolves through the checker as specified, independent of ImportInfo's shape.

**Tests** (`tests/json-schema-constraints.ts`): drive via `createProgram` on source strings importing from both `'@esportsplus/data'` and `'@esportsplus/data/validators'`; assert every table row, aliased named import, namespace form (both depths), array-of-calls composition, each conflict rule, each degrade path (unknown builtin, non-static arg, flagged regex, spread key, function-form config, non-object root), and that fragments for untouched properties are absent.

## Reads
- src/compiler/index.ts — the imports.includes/trace guard idiom being mirrored (lines 40-58, 79-129)
- src/validators/min.ts — the polymorphic min/max/range family whose keyword depends on the property's IR type
- src/validators/email.ts — the Object.assign variant surface (html5/rfc5322/unicode)
- src/validators/uuid.ts — the factory-built .v1–.v8 variant surface
- src/validators/url.ts — the http/https variant surface
- src/validators/matches.ts — the RegExp-argument shape
- src/compiler/type-analyzer.ts — AnalyzedProperty, the type rows the table keys on
- src/types.ts — the JsonSchema fragment type
- tests/namespace-imports.ts — existing coverage of the `ns.validator.build` namespace-detection branch this item's shape-3 recognition mirrors (reference only; its `:140` case is the out-of-scope pre-existing failure)
- tests/utils.ts — createProgram harness
- node_modules/@esportsplus/typescript/build/compiler/imports.d.ts — imports.all/includes signatures

## Acceptance
0 regressions in tests/json-schema-constraints.ts, run scoped; every mapping-table row and every degrade path above has an asserting test. Zod parity gate (answered Q3): (1) Baseline — verify each mapping-table row's emitted keywords against `z.toJSONSchema()` output of `zod@4.4.3` (npm `dist-tags.latest`, verified 2026-07-25), installed as a throwaway dev-only check under ~/.claude/storage/ — never a temp file in this repo, never a dependency of this package. (2) Override — where zod's choice is demonstrably NOT the best for a new package consuming Draft 2020-12, prefer the published Draft 2020-12 keyword semantics and RECORD the deviation with its one-line justification in the item's changelog Deviations entry. Zod parity is the default, not a straitjacket.

## Checks
- npx tsc --noEmit
- pnpm agent:test tests/json-schema-constraints.ts

## Notes
- Consumers import builtins from `@esportsplus/data/validators` (Q1 answered; validators-subpath-export ships the exports-map entry) — extraction recognizes the specifier textually, so this item does not depend on that item landing first.
- User-registered brand validators (`validator.set`) contribute nothing here by design: their bodies are arbitrary user TypeScript (S6) with no derivable keyword.
- The object-literal config is today effectively inert in `build()`'s generated runtime output; the extractor gives it compile-time meaning for `toJsonSchema` only — `build()`'s handling of config is untouched (scope boundary).
