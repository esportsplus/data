---
type: fix
recommended-model: sonnet
status: PENDING
priority: P1
source: findings C9, C20, C21 (audit section C)
depends-on: relocate-tests-and-benches
files-own: [src/compiler/index.ts, test/compiler/namespace-imports.test.ts, test/compiler/index.test.ts]
tests: [test/compiler/namespace-imports.test.ts, test/compiler/index.test.ts]
---

# Fix aliased-import detection, pre-filter, and build dedup

## Rationale

C9 (P1): `import { validator as v } from '@esportsplus/data'` is never transformed — `src/compiler/index.ts:96` passes the literal `'validator'` as `symbolName` and the `imports.includes` check compares `node.text !== symbolName`, while the comment at `:97` claims aliased support. This is the root cause of the baseline's one failing test (`test/compiler/namespace-imports.test.ts`, formerly `tests/namespace-imports.ts:140`). C21 (P2): the pre-filter `patterns: ['validator.build','validator','.build','.toJsonSchema']` (`:142`) — bare `'validator'` matches almost any file. C20 (P2): two identical `validator.build<D>()` calls emit two full duplicate bodies, while `toJsonSchema` already dedups via the `hoisted` map (`:171-177`).

## Changes

Import detection in the compiler entry: alias-aware symbol resolution, a tighter textual pre-filter, and hoisted-map dedup for `build` mirroring the existing `toJsonSchema` dedup.

## Design

Exact recipe:

1. **Alias map (C9).** Build `propertyName → localName` from `imports.all(...).specifiers` for the `@esportsplus/data` import: for each named specifier, the exported name is `specifier.propertyName?.text ?? specifier.name.text` and the local binding is `specifier.name.text`. Detection compares call-site identifiers against the LOCAL name; namespace imports (`import * as ns`) match `ns.validator.build` member chains. Fixes the failing namespace-imports test at its assertion of transformed output.
2. **Pre-filter (C21).** Replace the patterns array with `['.build', '.set', '.toJsonSchema']` — drop bare `'validator'` and the redundant `'validator.build'`. The pre-filter stays a cheap over-approximation (aliases make exact textual matching impossible); false positives cost one parse, false negatives are forbidden.
3. **Dedup (C20).** Introduce a `hoisted`-style map for `build` keyed by the resolved type identity plus the config argument's canonical text (empty string when absent), mirroring `:171-177`: the first occurrence emits the validator const; later identical occurrences reference it. Two builds of the SAME type with DIFFERENT configs stay distinct.

Test plan: namespace-imports suite goes green (baseline red retired); `test/compiler/index.test.ts` gains cases — aliased named import transforms identically to the plain import; two identical `build<D>()` calls emit exactly one validator body (assert one occurrence in output AND both references validate identically at runtime); two builds with different configs stay separate.

## Reads

- src/constants.ts — PACKAGE_NAME the import matcher keys on
- test/utils.ts — transform harness
- src/compiler/validator.ts — generateValidator call sites the dedup wraps (read-only here)

## Acceptance

- The pre-existing namespace-imports failure (baseline's 1 known red) passes.
- Aliased `import { validator as v }` transforms; output no longer identical to input.
- Identical duplicate builds emit one body; different-config builds do not merge.
- 0 regressions in test/compiler/namespace-imports.test.ts and test/compiler/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/namespace-imports.test.ts test/compiler/index.test.ts
- npx tsc --noEmit

## Notes

The alias map this item builds is also the roster plugin-self-assertion later scans against — keep it accessible on the transform context rather than a local.
