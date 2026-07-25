# validator.toJsonSchema Feature Spec

## Clarifying Questions

### Answered
- **Q0a** · constraint sources — parity target is type structure AND config-arg validators; the exact zod keyword table is UNVERIFIED in-session, so verifying the mapping against the consuming package's zod version is an explicit acceptance criterion on config-constraint-extractor, never an assumed fact.
- **Q0b** · dedup scope — per-file hoist via the existing `TransformResult.prepend` hook: one module-level `const` per unique schema per transformed file; NO cross-file virtual module (the tsc plugin cannot emit files).
- **Q0c** · dialect — JSON Schema Draft 2020-12 only; no draft-07, no `target` option.
- **Q1** · builtin-validator import surface — `"./validators"` subpath export in `package.json`; consumers use `import { email, min, max } from '@esportsplus/data/validators'`. Root-barrel re-export rejected (the `integer` value/type collision never arises).
- **Q2** · additionalProperties policy — every emitted object schema carries `additionalProperties: false`, not configurable, no options argument; the assumed default stands.
- **Q3** · zod parity baseline — pinned to `zod@4.4.3` (npm `dist-tags.latest`, verified 2026-07-25), installed only as a throwaway dev-only check; where zod's choice is demonstrably not the best for a new Draft 2020-12 consumer, published Draft 2020-12 keyword semantics win and the deviation is recorded in the changelog Deviations entry.

## Metadata
- **Generated**: 2026-07-25
- **Synthesizer**: claude-fable-5 · seat roles.synthesizer · router HARD
- **Research sources**: Mode 4 in-context dispatch evidence (E1–E15) re-verified by direct reads against d:\data at ff0a621; S-registry anchors (file:line) cited inline in feature files. Corrections found during verification: the vitest config is `vitest.config.ts` (E11 named `vite.config.ts`); `tests/utils.ts` exports `createProgram, createValidator, mightNeedTransform, transformCode` (no `transformRaw`); builtin validators are not importable by consumers (Q1).
- **Threshold**: 10% (default — no perf items in this spec)
- **Total features**: 7
- **Model mix**: opus 3 · sonnet 4

## Baseline
- **Commit**: ff0a621
- **Suite**: 1 failed (PRE-EXISTING: `tests/namespace-imports.ts:140`, red since d16707d — out of scope, no item may fix it and no item's acceptance may depend on it) | 1360 passed; `npx tsc --noEmit` clean. Every item carries a scoped `tests` entry so per-item gates never run the bare (red) full suite; merge-boundary full-suite gates WILL report the one pre-existing failure — that is baseline state, not a regression introduced by this spec.
- **Benchmark**: none (no `type: perf` items; `agent:bench` not required)

## Features

- agent-test-script
- json-schema-public-surface
- analyzer-root-entry
- json-schema-emitter
- config-constraint-extractor
- json-schema-transform-wiring
- validators-subpath-export

## Feed
run,scope,unit,ordinal,slug,event,state,detail,elapsed_ms,ts
