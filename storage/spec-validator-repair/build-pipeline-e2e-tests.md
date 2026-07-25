---
type: test
recommended-model: opus
status: PENDING
priority: P1
source: audit section A (the three coverage mechanisms)
depends-on: [relocate-tests-and-benches, repair-validator-config-compilation, compiler-annotation-extraction, repair-brand-registration, compiler-import-detection, analyzer-structural-types, output-construction-safety, error-path-fidelity]
files-own: [test/compiler/e2e-build.test.ts, test/compiler/compile-validators.ts, test/utils.ts]
tests: [test/compiler/e2e-build.test.ts]
---

# End-to-end coverage through validator.build

## Rationale

This is the item that closes the systemic cause (section A): all 12 P0s hid behind a green 1,464-test suite because (1) coverage was isolation-only — every validator suite imports `../src/validators/*` directly and NONE goes through `validator.build`; the single file that passed a config to `build` (`tests/compile-validators.ts:140`) was a codegen script that `writeFileSync`s output, asserts NOTHING, and sat in the vitest exclude list; (2) tests were written against the implementation, not the spec; (3) assertions were blind to the features they name. Mechanisms 2 and 3 are closed per-item by the spec-vector rewrites; this item closes mechanism 1 structurally: a standing end-to-end suite where every case compiles THROUGH `validator.build` and executes the emitted module.

## Changes

A new e2e suite over the full transform pipeline; the assert-nothing codegen script retired.

## Design

Settled decisions:

- **The suite (test/compiler/e2e-build.test.ts).** A matrix of representative types × configs, each case: source text → `transformCode` (test/utils.ts) → execute the emitted module → assert BEHAVIOR (ok flag AND data/errors content — never `toContain` on emitted text as the sole assertion; that is the A3 anti-pattern). Matrix rows (minimum): plain object type with builtin config (min/range), inline arrow config, array config, async config, annotation chain (`describe`+`default`), branded type via `validator.set`, nullable + optional properties, union type, array-of-objects with element error paths, record type, non-object root, Map/Set property, `toJsonSchema` alongside `build` in one file, aliased import form. Each row runs a pass vector and a fail vector with exact error path+message assertions.
- **Emitted-module execution mechanism**: dynamic `import()` of the transformed source via an in-memory data: URL or a temp file under the OS temp dir (never inside the project tree) — whichever `test/utils.ts`'s existing `createValidator` already supports; extend the helper in place if a gap exists (helper lives at test/utils.ts — relocation already owns the move; this item may extend its API surface additively).
- **Retire the codegen script.** Delete `test/compiler/compile-validators.ts` (the excluded writeFileSync-and-assert-nothing script) — its only value (eyeballing output) is superseded by cases that EXECUTE output.
- Discretion point: matrix data-driven (table of {source, vectors}) vs per-case tests; criterion — a new pipeline feature must be addable as ONE table row, and failure output must name the row.

Test plan: the suite itself is the deliverable; its own gate is that deliberately re-introducing finding B's raw-text embed (locally, as a sanity mutation during development) fails at least one row — the "would this suite have caught the P0s" question is answerable YES by construction for B, C1/C2 (brand row), C9 (aliased row), C7 (null vector), C12 (non-object root row).

## Reads

- src/compiler/index.ts — the pipeline under test (read-only)
- src/types.ts — Schema/ValidatorFn types the assertions type against

## Acceptance

- Every matrix row listed in the Design exists and executes emitted code with behavior assertions; the codegen script is gone; no e2e case asserts on emitted text alone.
- 0 regressions in test/compiler/e2e-build.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/e2e-build.test.ts
- npx tsc --noEmit

## Notes

test/compiler/compile-validators.ts is a helper (non-.test name), so its deletion removes zero discovered test cases — no removes-tests declaration is owed. test/utils.ts is files-own for the additive helper extension only; 15 suites consume it (ownership map), so extensions must be purely additive. If a row exposes a NEW pipeline defect, file it as a follow-up rather than patching sources under this test-only item (files-own carries no src/ surface by design).
