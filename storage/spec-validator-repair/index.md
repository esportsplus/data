# @esportsplus/data Validator + Codec Repair Spec

## Clarifying Questions

> Answer inline under each **A:**, then tell me you're done. Blocking questions gate the feature
> files they list (those items sit `BLOCKED` until answered); answered entries below are settled
> and will not be re-asked.

### Open — Blocking
- **Q3** · orphan typed-array codec (deferred: "wait on sbc related features I need to read") · blocks: [remove-typed-array-codec, sbc-browser-platform-tests, sbc-cache-isolation, sbc-compile-time-parity, sbc-compute-size, sbc-encode-safety, sbc-schema-preregistration, readme-accuracy]
  Delete the orphan module (recommended: undocumented, wire-incompatible with SBC's tag-17 path, rejects Node Buffer; `awaiting-approval: public-API break` remains the human gate), or wire it into SBC instead?
  1. Delete (Recommended)
  2. Wire into SBC
  **A:**
- **Q4** · hinted-encode mismatch behavior (deferred: same pending SBC review) · blocks: [remove-typed-array-codec, sbc-browser-platform-tests, sbc-cache-isolation, sbc-compile-time-parity, sbc-compute-size, sbc-encode-safety, sbc-schema-preregistration, readme-accuracy]
  With an EXPLICIT schema hint, should out-of-range/type-mismatch/missing-non-nullable values throw named `Codec2:` errors (one check per field, hinted path only), or keep silent truncation (`{v:300}`→`{v:44}`) for raw speed?
  1. Check-and-throw on the hinted path (Recommended)
  2. Keep silent truncation
  **A:**

  (The whole SBC block is held per the user's request to read the SBC findings first; readme-accuracy is a dependency cascade — it documents the SBC items' landed behavior.)

### Answered
- **Q1** · build() return shape — PLAIN OBJECT, user overruled the callable recommendation: "build() should just return a pojo with the inlined validate, toJsonSchema". `build<T>()` emits a hoisted object literal `{ toJsonSchema, validate }`; BREAKING (`v(input)` → `v.validate(input)`), carried by compiler-annotation-extraction (`api-impact: breaking` + `awaiting-approval`); standalone `validator.toJsonSchema<T>()` KEPT as shorthand.
- **Q2** · trim/normalize naming — "leave names": keep `trim()`/`normalize()`, document as assertions (readme-accuracy).
- **Q5** · bench scripts — "relocate following coding-standards": `all-codecs` and `sbc-standalone` are real benchmarks → `.bench.ts` + ported to the `bench()` API; `autoresearch-sbc` emits labeled stdout metrics for an external autoresearch loop → plain script under `bench/sbc/` without the `.bench.` infix (outside discovery). Verdicts recorded in the relocation mapping table.
- **Q0a** · toJsonSchema return — returns `JsonSchema` directly, not a result payload.
- **Q0b** · catch-all index signatures — OUT of scope; pure `Record<string,T>` stays supported.
- **Q0c** · readonly — WANTED; `ts.ModifierFlags.Readonly`, read from a declaration's own `modifierFlags` field behind `ts.isPropertySignatureDeclaration`/`ts.isPropertyDeclaration` (typescript 7.0.2 deleted `ts.getCombinedModifierFlags`). Mechanism superseded 2026-07-25 by the TS7 migration and already landed in `src/compiler/type-analyzer.ts`; the ANSWER (readonly is wanted) is unchanged.
- **Q0d** · description/title/examples — NOT required for ai-orchestrator parity; capability built, optional, emits nothing when unused; no retro-annotation.
- **Q0e** · .default() — REQUIRED, with BOTH schema emission and parse-time fill (ai-orchestrator plan-ir.ts:55 relies on it).
- **Q0f** · oneOf/allOf — `anyOf` is already correct for every TS union; intersections FLATTEN (allOf reserved for non-object constituents); oneOf remains an unspecced optional optimization.
- **Q0g** · runtime toJsonSchema — necessary for exactly one reason: ai-orchestrator builds `z.enum(skillIds)` from `registry.ids()` at runtime; value-level AnalyzedProperty builder is the mechanism.
- **Q0h** · zod parity baseline — zod@4.4.3.
- **Q0i** · inline arrows — cannot chain annotations (measured TS2339); the identity-wrapper helper is the sanctioned spelling; `Function.prototype` augmentation rejected.
- **Q0j** · unconfigured-plugin failure mode — real no-op methods on builtins + plugin self-assertion + post-build residue check (all three wanted).

## Metadata
- **Generated**: 2026-07-25
- **Synthesizer**: claude-fable-5 · seat roles.synthesizer · router HARD
- **Research sources**: Mode 4 in-context evidence, execution-proven this session (dispatch sections A–J: ~68 findings, 12 P0, with file:line anchors and pasted command output) · ownership map `storage/runtime/d--data/ownership.md` (config root, generated 2026-07-25) · repo snapshot `.claude/CONTEXT.md` (generated 2026-07-25) · repo files verified on disk at authoring (tests/, src/, vitest.config.ts, package.json, tsconfig.json, README.md)
- **Threshold**: 10% minimum improvement (default; this spec carries no `type: perf` items)
- **Total features**: 25
- **Model mix**: opus 20 · sonnet 5
- **Path convention**: every `tests` entry uses POST-relocation paths; each is created either by `relocate-tests-and-benches` (which lands first and declares them `files-own`) or by the item that lists it.
- **Toolchain**: typescript **7.0.2**, vended by `@esportsplus/typescript` ^0.29.6 — this package never depends on `typescript` directly, so every compiler item imports the TS surface as `ts` from `@esportsplus/typescript`. While this spec executes, that dependency resolves through a LOCAL LINK (`overrides: { '@esportsplus/typescript': link:../typescript }` in `pnpm-workspace.yaml` → `D:\typescript`): `node_modules/@esportsplus/typescript` is a symlink, and any change made there must be rebuilt with `pnpm build` in that repo before this repo consumes it. Dropping the override for the published 0.29.6 is a release step, not a spec item.
- **Spec UUID**: 38a9a1b8-7f20-4f9b-a88a-7a0ddf7373f1

## Baseline
- **Commit**: HEAD at authoring, clean tree (sha unrecorded — the synthesizer seat runs without CLIs; the engine captures the sha at first plan)
- **Suite (at authoring)**: 1 failed (`tests/namespace-imports.ts:140` — finding C9, fixed by compiler-import-detection) / 1464 passed / 1 expected-fail; `npx tsc --noEmit` clean
- **Suite (re-baselined 2026-07-25 at `a5be285`, after the TS7 migration)**: 34 files / 1775 passed / 0 failed / 1 expected-fail, `pnpm test` in 5.9s; `npx tsc --noEmit` clean across `src/`, `test/` and `bench/`. Compare regressions against THIS row — the authoring row predates both the test relocation and the toolchain change.
- **Benchmark**:
  | Metric | Value | Unit |
  |--------|-------|------|
  | bench discovery (at authoring) | 0 files found, exit 1 (finding F1) | — |
  | bench discovery (2026-07-25) | 5 | files |

## Public API Changes

- [remove-typed-array-codec.md](./remove-typed-array-codec.md) — Remove the orphan typed-array codec · Awaiting-approval: public-API break
- [compiler-annotation-extraction.md](./compiler-annotation-extraction.md) — Compiler strips annotation chains, folds schema, fills defaults · Awaiting-approval: public-API break

## Out of Scope

- **ai-orchestrator migration (section J)** — a DIFFERENT repository (`D:\ai-orchestrator`); the engine's file-bounds check refuses paths outside this repo, and the migration's design depends on the API this spec lands. Decision: a separate follow-up spec, authored after this spec completes. It must confront: the return-shape change (`.parse()` throws vs `{ok,data,errors}` — user-acknowledged), the COERCION divergence (zod 4.4.3 coerces NOTHING by default; this package coerces `'30'`→30 even after output-construction-safety tightens it — a plan node with `{"age":"30"}` flips from rejected to accepted), the `S extends z.ZodType` generic inversion in actions/types.ts, and the `@esportsplus/typescript` version skew (^0.27.3 vs ^0.29.6 — now spanning a typescript 5→7 jump, so that repo's own compiler plugins must migrate before it can consume this one).
- **Catch-all index signatures** (declared properties + index signature together) — settled out of scope.
- **draft-07 emission** and any **cross-file/virtual-module schema registry** — constraint-excluded.
- **oneOf optimization** — optional per the answered log; not specced.
- **Publishing/release** — version bump noted in remove-typed-array-codec; the release itself is not an item.

## Features

- relocate-tests-and-benches
- repair-validator-config-compilation
- repair-brand-registration
- compiler-import-detection
- emitted-code-escaping
- output-construction-safety
- error-path-fidelity
- validator-recursive-types
- validator-container-fidelity
- validator-proto-property-reads
- validator-boolean-coercion
- validator-body-ast-rewrite
- remove-legacy-config-form
- analyzer-structural-types
- analyzer-schema-gaps
- format-validators-p0
- format-validators-correctness
- numeric-constraint-validators
- encode-growth-signal
- sbc-key-enumeration-parity
- residue-codec-false-positive
- decoder-count-limits
- registry-hash-validation
- codegen-uint16-hoist
- remove-map-set-tags
- unify-packed-numeric-tags
- encodable-type-constraint
- infer-nullable-not-mixed
- bigint-int64-parity
- sbc-compile-time-parity
- sbc-schema-preregistration
- sbc-encode-safety
- sbc-cache-isolation
- sbc-compute-size
- remove-typed-array-codec
- sbc-browser-platform-tests
- annotated-validator-types
- compiler-annotation-extraction
- plugin-self-assertion
- runtime-tojsonschema
- build-pipeline-e2e-tests
- readme-accuracy

## Feed
run,scope,unit,ordinal,slug,event,state,detail,elapsed_ms,ts
aa871fa6,item,u1,1.1,relocate-tests-and-benches,blocked,BLOCKED,,,2026-07-25T10:10:48-07:00
aa871fa6,item,u1,1.2,repair-validator-config-compilation,blocked,BLOCKED,,,2026-07-25T10:10:48-07:00
aa871fa6,item,u1,1.3,output-construction-safety,blocked,BLOCKED,,,2026-07-25T10:10:48-07:00
aa871fa6,item,u1,1.4,analyzer-structural-types,blocked,BLOCKED,,,2026-07-25T10:10:48-07:00
aa871fa6,item,u1,1.5,analyzer-schema-gaps,blocked,BLOCKED,,,2026-07-25T10:10:48-07:00
aa871fa6,item,u1,1.6,format-validators-correctness,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.7,numeric-constraint-validators,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.8,annotated-validator-types,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.9,compiler-annotation-extraction,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.10,runtime-tojsonschema,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.11,compiler-import-detection,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.14,repair-brand-registration,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.15,error-path-fidelity,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.16,plugin-self-assertion,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.17,build-pipeline-e2e-tests,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.12,emitted-code-escaping,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,item,u1,1.13,format-validators-p0,blocked,BLOCKED,,,2026-07-25T10:10:49-07:00
aa871fa6,run,,,,run-end,RUN END,"applied: 0 completed, 17 rejected, 34 status-actions, 3 changelog-rows",,2026-07-25T10:10:50-07:00
,item,mutator,,relocate-tests-and-benches,requeued,REQUEUED,,,2026-07-25T16:07:03-07:00
,item,mutator,,repair-validator-config-compilation,requeued,REQUEUED,,,2026-07-25T16:07:03-07:00
,item,mutator,,repair-brand-registration,requeued,REQUEUED,,,2026-07-25T16:07:04-07:00
,item,mutator,,compiler-import-detection,requeued,REQUEUED,,,2026-07-25T16:07:04-07:00
,item,mutator,,emitted-code-escaping,requeued,REQUEUED,,,2026-07-25T16:07:04-07:00
,item,mutator,,analyzer-structural-types,requeued,REQUEUED,,,2026-07-25T16:07:04-07:00
,item,mutator,,analyzer-schema-gaps,requeued,REQUEUED,,,2026-07-25T16:07:04-07:00
,item,mutator,,format-validators-p0,requeued,REQUEUED,,,2026-07-25T16:07:05-07:00
,item,mutator,,format-validators-correctness,requeued,REQUEUED,,,2026-07-25T16:07:05-07:00
,item,mutator,,annotated-validator-types,requeued,REQUEUED,,,2026-07-25T16:07:05-07:00
,item,mutator,,compiler-annotation-extraction,requeued,REQUEUED,,,2026-07-25T16:07:06-07:00
,item,mutator,,plugin-self-assertion,requeued,REQUEUED,,,2026-07-25T16:07:06-07:00
,item,mutator,,runtime-tojsonschema,requeued,REQUEUED,,,2026-07-25T16:07:06-07:00
,item,mutator,,output-construction-safety,requeued,REQUEUED,,,2026-07-25T16:19:24-07:00
,item,mutator,,numeric-constraint-validators,requeued,REQUEUED,,,2026-07-25T16:19:25-07:00
,item,mutator,,error-path-fidelity,requeued,REQUEUED,,,2026-07-25T16:19:25-07:00
,item,mutator,,build-pipeline-e2e-tests,requeued,REQUEUED,,,2026-07-25T16:19:25-07:00
5e01222d,item,u2,2.1,numeric-constraint-validators,reverted,REVERTED,,,2026-07-25T16:31:23-07:00
5e01222d,item,u1,1.2,error-path-fidelity,deferred,DEFERRED,,,2026-07-25T17:08:30-07:00
5e01222d,item,u1,1.1,output-construction-safety,reverted,REVERTED,,,2026-07-25T17:08:30-07:00
5e01222d,item,u3,3.1,build-pipeline-e2e-tests,deferred,DEFERRED,"DEFERRED 2026-07-26T00:08:30.781Z run=5e01222d class=dependency reason=""dependency output-construction-safety did not land — reverted"" salvage=none",,2026-07-25T17:08:30-07:00
5e01222d,run,,,,run-end,RUN END,"applied: 0 completed, 3 rejected, 3 status-actions, 3 changelog-rows",,2026-07-25T17:08:31-07:00
,item,mutator,,output-construction-safety,requeued,REQUEUED,,,2026-07-25T17:18:59-07:00
,item,mutator,,numeric-constraint-validators,requeued,REQUEUED,,,2026-07-25T17:19:00-07:00
,item,mutator,,error-path-fidelity,requeued,REQUEUED,,,2026-07-25T17:19:00-07:00
,item,mutator,,remove-typed-array-codec,requeued,REQUEUED,,,2026-07-25T18:43:24-07:00
,item,mutator,,sbc-cache-isolation,requeued,REQUEUED,,,2026-07-25T18:43:24-07:00
,item,mutator,,sbc-compile-time-parity,requeued,REQUEUED,,,2026-07-25T18:43:24-07:00
,item,mutator,,sbc-compute-size,requeued,REQUEUED,,,2026-07-25T18:43:24-07:00
,item,mutator,,sbc-encode-safety,requeued,REQUEUED,,,2026-07-25T18:43:24-07:00
,item,mutator,,sbc-schema-preregistration,requeued,REQUEUED,,,2026-07-25T18:43:24-07:00
,item,mutator,,sbc-browser-platform-tests,requeued,REQUEUED,,,2026-07-25T18:43:24-07:00
,item,mutator,,readme-accuracy,requeued,REQUEUED,,,2026-07-25T18:43:24-07:00
