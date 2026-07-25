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
- **Q0c** · readonly — WANTED; `ts.ModifierFlags.Readonly` via `ts.getCombinedModifierFlags` (typescript 5.9.3).
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

## Baseline
- **Commit**: HEAD at authoring, clean tree (sha unrecorded — the synthesizer seat runs without CLIs; the engine captures the sha at first plan)
- **Suite**: 1 failed (`tests/namespace-imports.ts:140` — finding C9, fixed by compiler-import-detection) / 1464 passed / 1 expected-fail; `npx tsc --noEmit` clean
- **Benchmark**:
  | Metric | Value | Unit |
  |--------|-------|------|
  | bench discovery | 0 files found, exit 1 (finding F1) | — |

## Public API Changes

- [remove-typed-array-codec.md](./remove-typed-array-codec.md) — Remove the orphan typed-array codec · Awaiting-approval: public-API break
- [compiler-annotation-extraction.md](./compiler-annotation-extraction.md) — Compiler strips annotation chains, folds schema, fills defaults · Awaiting-approval: public-API break

## Out of Scope

- **ai-orchestrator migration (section J)** — a DIFFERENT repository (`D:\ai-orchestrator`); the engine's file-bounds check refuses paths outside this repo, and the migration's design depends on the API this spec lands. Decision: a separate follow-up spec, authored after this spec completes. It must confront: the return-shape change (`.parse()` throws vs `{ok,data,errors}` — user-acknowledged), the COERCION divergence (zod 4.4.3 coerces NOTHING by default; this package coerces `'30'`→30 even after output-construction-safety tightens it — a plan node with `{"age":"30"}` flips from rejected to accepted), the `S extends z.ZodType` generic inversion in actions/types.ts, and the `@esportsplus/typescript` version skew (^0.27.3 vs ^0.29.5).
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
- analyzer-structural-types
- analyzer-schema-gaps
- format-validators-p0
- format-validators-correctness
- numeric-constraint-validators
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
