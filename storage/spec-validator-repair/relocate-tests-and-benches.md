---
type: refactor
recommended-model: opus
status: PENDING
priority: P0
source: findings F1, F2 (audit section F)
depends-on: none
files-own: [tests/async-validators.ts, tests/bench/all-codecs.ts, tests/bench/autoresearch-sbc.ts, tests/bench/compile.ts, tests/bench/sbc-standalone.ts, tests/bench/sbc-vs-msgpack.ts, tests/bench/validator.ts, tests/branded-strings.ts, tests/compile-validators.ts, tests/complex.ts, tests/custom-messages.ts, tests/edge-cases.ts, tests/error-paths.ts, tests/json-schema-constraints.ts, tests/json-schema-emitter.ts, tests/json-schema.ts, tests/namespace-imports.ts, tests/plugins.ts, tests/primitives.ts, tests/sbc-decode-interleave.ts, tests/sbc-schema-hints.ts, tests/sbc-schema-store.ts, tests/sbc.ts, tests/transformer.ts, tests/type-analyzer-edge.ts, tests/type-analyzer-root.ts, tests/typed-array-codec.ts, tests/unions.ts, tests/utils.ts, tests/validators-advanced.ts, tests/validators-constraints.ts, tests/validators-format.ts, tests/validators-number-date.ts, tests/validators.ts, test/compiler/async-validators.test.ts, test/compiler/branded-strings.test.ts, test/compiler/compile-validators.ts, test/compiler/complex.test.ts, test/compiler/custom-messages.test.ts, test/compiler/edge-cases.test.ts, test/compiler/error.test.ts, test/compiler/index.test.ts, test/compiler/json-schema-constraints.test.ts, test/compiler/json-schema-e2e.test.ts, test/compiler/json-schema.test.ts, test/compiler/namespace-imports.test.ts, test/compiler/plugins.test.ts, test/compiler/primitives.test.ts, test/compiler/sbc/index.test.ts, test/compiler/type-analyzer-root.test.ts, test/compiler/type-analyzer.test.ts, test/compiler/unions.test.ts, test/sbc/decode-interleave.test.ts, test/sbc/index.test.ts, test/sbc/schema-store.test.ts, test/typed-array-codec.test.ts, test/utils.ts, test/validators/advanced.test.ts, test/validators/constraints.test.ts, test/validators/format.test.ts, test/validators/index.test.ts, test/validators/number-date.test.ts, test/layout.test.ts, bench/compiler/compile.bench.ts, bench/compiler/validator.bench.ts, bench/sbc/all-codecs.bench.ts, bench/sbc/autoresearch-sbc.ts, bench/sbc/sbc-standalone.bench.ts, bench/sbc/sbc-vs-msgpack.bench.ts, vitest.config.ts, package.json]
tests: [test/layout.test.ts]
removes-tests: [tests/async-validators.ts, tests/branded-strings.ts, tests/complex.ts, tests/custom-messages.ts, tests/edge-cases.ts, tests/error-paths.ts, tests/json-schema-constraints.ts, tests/json-schema-emitter.ts, tests/json-schema.ts, tests/namespace-imports.ts, tests/plugins.ts, tests/primitives.ts, tests/sbc-decode-interleave.ts, tests/sbc-schema-hints.ts, tests/sbc-schema-store.ts, tests/sbc.ts, tests/transformer.ts, tests/type-analyzer-edge.ts, tests/type-analyzer-root.ts, tests/typed-array-codec.ts, tests/unions.ts, tests/validators-advanced.ts, tests/validators-constraints.ts, tests/validators-format.ts, tests/validators-number-date.ts, tests/validators.ts]
---

# Relocate the test and bench trees to the coding standard

## Rationale

F1 (P0): `pnpm bench` runs ZERO benchmarks — vitest's benchmark glob matches `**/*.{bench,benchmark}.?(c|m)[jt]s?(x)` and all six files live at `tests/bench/<name>.ts`. Measured: `No benchmark files found, exiting with code 1`. F2: the layout violates the repo coding standard on four axes (`tests/` not `test/`, no `.test.ts` suffix, no source mirroring, bench nested under tests). Every later item in this spec adds or edits test files; relocating FIRST means every subsequent item authors post-move paths once, with zero churn.

## Changes

Whole-tree relocation of the test suite and benchmarks to the standard layout; vitest discovery config updated; an `agent:bench` script added so the validation contract (agent:test + agent:bench names) is complete. No source behavior changes.

## Design

**Ordering decision (stated per spec guidance): this item lands FIRST.** Everything after it declares post-move `tests` paths, so test-adding items never thrash against a later move; the alternative (move last) would strand the mapping table against files other items create mid-run.

**Test mapping — the full 28-row table (old → new · role):**

| old | new | role |
|---|---|---|
| tests/async-validators.ts | test/compiler/async-validators.test.ts | sweep |
| tests/branded-strings.ts | test/compiler/branded-strings.test.ts | sweep |
| tests/compile-validators.ts | test/compiler/compile-validators.ts | HELPER (codegen script, asserts nothing; stays outside discovery; superseded by build-pipeline-e2e-tests) |
| tests/complex.ts | test/compiler/complex.test.ts | sweep |
| tests/custom-messages.ts | test/compiler/custom-messages.test.ts | sweep |
| tests/edge-cases.ts | test/compiler/edge-cases.test.ts | sweep |
| tests/error-paths.ts | test/compiler/error.test.ts | MIRROR of src/compiler/error.ts |
| tests/json-schema-constraints.ts | test/compiler/json-schema-constraints.test.ts | MIRROR of src/compiler/json-schema-constraints.ts |
| tests/json-schema-emitter.ts | test/compiler/json-schema.test.ts | MIRROR of src/compiler/json-schema.ts |
| tests/json-schema.ts | test/compiler/json-schema-e2e.test.ts | sweep |
| tests/namespace-imports.ts | test/compiler/namespace-imports.test.ts | sweep |
| tests/plugins.ts | test/compiler/plugins.test.ts | sweep over src/compiler/plugins/ |
| tests/primitives.ts | test/compiler/primitives.test.ts | sweep |
| tests/sbc-decode-interleave.ts | test/sbc/decode-interleave.test.ts | sweep |
| tests/sbc-schema-hints.ts | test/compiler/sbc/index.test.ts | MIRROR of src/compiler/sbc/index.ts |
| tests/sbc-schema-store.ts | test/sbc/schema-store.test.ts | sweep |
| tests/sbc.ts | test/sbc/index.test.ts | MIRROR of src/sbc/index.ts |
| tests/transformer.ts | test/compiler/index.test.ts | MIRROR of src/compiler/index.ts |
| tests/type-analyzer-edge.ts | test/compiler/type-analyzer.test.ts | MIRROR of src/compiler/type-analyzer.ts |
| tests/type-analyzer-root.ts | test/compiler/type-analyzer-root.test.ts | sweep beside the mirror |
| tests/typed-array-codec.ts | test/typed-array-codec.test.ts | MIRROR of src/typed-array-codec.ts |
| tests/unions.ts | test/compiler/unions.test.ts | sweep |
| tests/utils.ts | test/utils.ts | HELPER (non-`.test.` name; outside discovery, no exclude entry needed) |
| tests/validators.ts | test/validators/index.test.ts | MIRROR of src/validators/index.ts |
| tests/validators-advanced.ts | test/validators/advanced.test.ts | sweep |
| tests/validators-constraints.ts | test/validators/constraints.test.ts | sweep |
| tests/validators-format.ts | test/validators/format.test.ts | sweep |
| tests/validators-number-date.ts | test/validators/number-date.test.ts | sweep |

**Bench mapping — the full 6-row table:**

| old | new | note |
|---|---|---|
| tests/bench/compile.ts | bench/compiler/compile.bench.ts | uses `bench()` — discoverable |
| tests/bench/validator.ts | bench/compiler/validator.bench.ts | uses `bench()` — discoverable |
| tests/bench/sbc-vs-msgpack.ts | bench/sbc/sbc-vs-msgpack.bench.ts | uses `bench()` — discoverable |
| tests/bench/all-codecs.ts | bench/sbc/all-codecs.bench.ts | IS a benchmark (Codec2 vs Proto vs MsgPack ops/sec loops) — CONVERT to the `bench()` API (Q5 answered) |
| tests/bench/autoresearch-sbc.ts | bench/sbc/autoresearch-sbc.ts | NOT a vitest benchmark: it emits labeled stdout metrics for an external autoresearch loop (its own header says so); `bench()` would destroy that output contract — plain script, no `.bench.` infix, outside discovery (Q5 answered) |
| tests/bench/sbc-standalone.ts | bench/sbc/sbc-standalone.bench.ts | IS a benchmark (Codec2 vs MsgPack throughput) — CONVERT to the `bench()` API (Q5 answered) |

Settled decisions:
- Moves are `git mv` + rename; relative imports fixed for the new depth (`../src/...` → `../../src/...` where a file moved one level deeper). The `~` alias (vitest.config.ts) keeps working; prefer switching deep relative source imports to `~/` where a file moved.
- vitest.config.ts: `include: ['test/**/*.test.ts']`; DELETE the entire `exclude` list (bench files no longer match, helpers no longer match `*.test.*`).
- package.json: add `"agent:bench": "vitest bench"` beside `agent:test` (validation contract names both; this spec has no perf items, so it is a contract completion, not a gate).
- Q5 ANSWERED — relocate per coding-standards, deciding per file: `all-codecs` and `sbc-standalone` are real comparative benchmarks, so they take `.bench.ts` names and are PORTED to the `bench()` API (each hand-rolled `benchFn`/`bench` timing loop becomes a `bench()` case per scenario × codec; the correctness-verify guards become setup code that throws on mismatch; the wire-size comparison tables stay as setup-time logging). `autoresearch-sbc` is genuinely not a vitest benchmark — it emits labeled stdout metrics consumed by an external autoresearch loop — so it moves under `bench/` WITHOUT the `.bench.` infix, keeping it out of discovery while living where bench helpers/scripts belong.
- NEW cross-cutting sweep `test/layout.test.ts` (descriptive non-mirror name at the tree root): asserts the standard layout as a permanent regression test — the old `tests/` directory is absent, the helper `test/utils.ts` and the mapped `.test.ts`/`.bench.ts` files exist at their table positions. This replaces an inline gate predicate (gate commands admit no quotes) and outlives the run.
- Known-red carry: `tests/namespace-imports.ts:140` fails at HEAD (finding C9). It moves to `test/compiler/namespace-imports.test.ts` and STAYS red until `compiler-import-detection` lands — this is the baseline's 1 known failure, not a regression introduced here.
- Verify `npx tsc --noEmit` after the move; tsconfig.json extends the `@esportsplus/typescript` package's shared base tsconfig — if that base config globs the old tests directory explicitly (implementer verifies inside the dependency), the move must stay type-clean under the resolved include set.

## Reads

- tsconfig.json — extends the shared package config; confirms tsc's include scope for moved files
- src/compiler/error.ts — mirror source for test/compiler/error.test.ts (mapping-table reference only; this item never edits src/)
- src/compiler/index.ts — mirror source for test/compiler/index.test.ts (reference only)
- src/compiler/json-schema-constraints.ts — mirror source for test/compiler/json-schema-constraints.test.ts (reference only)
- src/compiler/json-schema.ts — mirror source for test/compiler/json-schema.test.ts (reference only)
- src/compiler/sbc/index.ts — mirror source for test/compiler/sbc/index.test.ts (reference only)
- src/compiler/type-analyzer.ts — mirror source for test/compiler/type-analyzer.test.ts (reference only)
- src/compiler/validator.ts — mirror source for bench/compiler/validator.bench.ts (reference only)
- src/sbc/index.ts — mirror source for test/sbc/index.test.ts (reference only)
- src/typed-array-codec.ts — mirror source for test/typed-array-codec.test.ts (reference only)
- src/validators/index.ts — mirror source for test/validators/index.test.ts (reference only)

## Acceptance

- `tests/` directory no longer exists; `test/` and `bench/` match the tables above exactly, asserted by the new layout sweep (0 regressions in test/layout.test.ts, run scoped).
- Discovery works: a single moved suite runs scoped (0 regressions in test/validators/format.test.ts, run scoped).
- Benchmark discovery fixed: `vitest bench` (via agent:bench) finds the FIVE `.bench.ts` files instead of exiting `No benchmark files found`; the autoresearch script stays outside discovery by name.
- The single pre-existing namespace-imports failure persists at its new path (known baseline red, finding C9); no NEW failures anywhere in the moved tree.
- `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/layout.test.ts
- pnpm agent:test test/validators/format.test.ts
- npx tsc --noEmit

## Directives

1. tests/validators.ts, tests/validators-advanced.ts, tests/validators-constraints.ts, tests/validators-format.ts, tests/validators-number-date.ts, test/validators/index.test.ts, test/validators/advanced.test.ts, test/validators/constraints.test.ts, test/validators/format.test.ts, test/validators/number-date.test.ts — move the five validator suites per the mapping table, fixing imports for the new depth.
2. tests/async-validators.ts, tests/branded-strings.ts, tests/compile-validators.ts, tests/complex.ts, tests/custom-messages.ts, tests/edge-cases.ts, tests/error-paths.ts, tests/json-schema-constraints.ts, tests/json-schema-emitter.ts, tests/json-schema.ts, tests/namespace-imports.ts, tests/plugins.ts, tests/primitives.ts, tests/transformer.ts, tests/type-analyzer-edge.ts, tests/type-analyzer-root.ts, tests/unions.ts, tests/utils.ts, test/compiler/async-validators.test.ts, test/compiler/branded-strings.test.ts, test/compiler/compile-validators.ts, test/compiler/complex.test.ts, test/compiler/custom-messages.test.ts, test/compiler/edge-cases.test.ts, test/compiler/error.test.ts, test/compiler/index.test.ts, test/compiler/json-schema-constraints.test.ts, test/compiler/json-schema.test.ts, test/compiler/json-schema-e2e.test.ts, test/compiler/namespace-imports.test.ts, test/compiler/plugins.test.ts, test/compiler/primitives.test.ts, test/compiler/type-analyzer.test.ts, test/compiler/type-analyzer-root.test.ts, test/compiler/unions.test.ts, test/utils.ts — move the compiler-facing suites and the shared helper per the mapping table.
3. tests/sbc.ts, tests/sbc-decode-interleave.ts, tests/sbc-schema-hints.ts, tests/sbc-schema-store.ts, tests/typed-array-codec.ts, test/sbc/index.test.ts, test/sbc/decode-interleave.test.ts, test/compiler/sbc/index.test.ts, test/sbc/schema-store.test.ts, test/typed-array-codec.test.ts — move the SBC suites and the typed-array mirror per the mapping table.
4. vitest.config.ts, test/layout.test.ts — set include to test/**/*.test.ts, delete the exclude list, and author the layout sweep asserting the mapped tree (old tests directory absent, helpers and mapped files present).
5. tests/bench/compile.ts, tests/bench/validator.ts, tests/bench/sbc-vs-msgpack.ts, tests/bench/all-codecs.ts, tests/bench/autoresearch-sbc.ts, tests/bench/sbc-standalone.ts, bench/compiler/compile.bench.ts, bench/compiler/validator.bench.ts, bench/sbc/sbc-vs-msgpack.bench.ts, bench/sbc/all-codecs.bench.ts, bench/sbc/autoresearch-sbc.ts, bench/sbc/sbc-standalone.bench.ts, package.json — move the six bench files per the bench table, porting all-codecs and sbc-standalone to the `bench()` API, and add the agent:bench script.

## Notes

Every later item in this spec references the POST-move paths. The `removes-tests` list is the declared shrink at the OLD paths — every case moves rather than disappears; net repo-wide test count is unchanged.

Typecheck boundary disclosure: the repo's `npx tsc --noEmit` gate compiles ONLY `src/**/*` (the extended base tsconfig pins include/rootDir to src — verified via `--listFiles`, zero test files before or after this move), so a green tsc means type-checked SOURCES, never type-checked tests; the test tree is type-checked only by `npx tsc --noEmit -p tsconfig.test.json` once annotated-validator-types authors that config.
