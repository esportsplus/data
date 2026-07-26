# @esportsplus/data Codec Residuals Spec

## Clarifying Questions

> Answer inline under each **A:**, then tell me you're done. There are no blocking questions —
> every fork was settled from HEAD evidence. The optional question has its default applied;
> fill it in only to override.

### Open — Optional
- **Q6** · range-error message wording · affects: [bigint-int64-parity] · assumed: messages unchanged
  After the `bigint` → `int64` schema-vocabulary rename, should the runtime error messages
  (`Codec2: bigint out of int64 range`, `Codec2: field 'x' expected bigint, …`) also rename?
  Default applied: NO — the messages name the JavaScript value type (`typeof value === 'bigint'`),
  which does not change; renaming them would also break `test/sbc/encode-safety.test.ts` D3 for
  zero information gain.
  **A:**

### Answered
Carried from the predecessor `spec-validator-repair` (settled — never re-asked):
- **No-back-compat directive** — wire-layout and schema-hash changes are version-bump-scoped; no
  compatibility shims. Applies to bigint-int64-parity (hash shift), infer-nullable-not-mixed
  (hash shift), unify-packed-numeric-tags (packed wire layout).
- **Q3** · orphan typed-array codec — DELETED (landed as remove-typed-array-codec).
- **Q4** · hinted-encode mismatch — check-and-throw LANDED (`validateHinted`, `src/sbc/index.ts`).
- **remove-map-set-tags** — LANDED: tags 15/16 retired; Map/Set are NON-ENCODABLE, encode throws
  `Codec2:`; sbc-compute-size's domain follows encode's, so its predecessor Map-sizing acceptance
  clause is void.
- **Q1/Q2/Q0a–Q0j/Q5** — compiler/validator decisions, all landed; none touch these six items.

## Metadata
- **Generated**: 2026-07-26
- **Synthesizer**: claude-fable-5 · seat roles.synthesizer · router HARD
- **Research sources**: RSC-v1 Mode 4 in-context dispatch evidence (predecessor terminal
  annotations, run journals f177cf28/5776b305, measured HEAD baseline) · all six predecessor
  feature files + index.md Answered log (`storage/spec-validator-repair/`, read in full) ·
  HEAD sources re-verified on disk at authoring (src/sbc/{index,tagged,codegen,platform,schema,
  size,constants,types,extract,registry}.ts, src/compiler/index.ts, src/compiler/sbc/index.ts,
  src/types.ts, README.md, test/sbc/*, test/compiler/*) · ownership map
  `C:/Users/ICJR/.claude/storage/runtime/d--data/ownership.md` (140 files, 21 hubs) · repo
  snapshot `.claude/CONTEXT.md`
- **Supersession**: successor of `storage/spec-validator-repair/` for its six
  RUN_THROUGH_SPEC_CREATE slugs (same slug names, re-anchored designs). Salvage refs: tag
  `salvage/5776b305-u1` @ b080c13005ca81adf40c4a9ec7cf7669978fe189 carries dropped test(author)
  commits 76dd754 (schema tests) and aab73c1 (size tests), referenced per item.
- **Threshold**: 10% minimum improvement (default; this spec carries no `type: perf` items)
- **Total features**: 6
- **Model mix**: opus 5 · sonnet 1
- **Sequencing note (reviewer: read this before questioning the graph)**: `depends-on` carries
  ONLY consumed-artifact edges — sbc-compute-size's three (the int64 vocabulary from
  bigint-int64-parity, the nullable-inference sizes from infer-nullable-not-mixed, the
  classifyPackedArray export + tag-12 layout from unify-packed-numeric-tags). Every other
  ordering constraint among the sbc items is same-file contention (src/sbc/tagged.ts,
  src/sbc/codegen.ts, src/sbc/schema.ts, test/sbc/index.test.ts appear in multiple items'
  files-own), which the engine handles by files-own weld — all FIVE sbc items union into ONE
  planner unit (encode-growth-signal welds in via the src/sbc/codegen.ts + src/sbc/tagged.ts
  files-own it shares with unify-packed-numeric-tags). The emitted plan (`node src/graph.ts
  plan`) places that unit at stage 0, executing its items in `## Features` order, in parallel
  with a second stage-0 unit carrying remove-legacy-config-form. That weld is DELIBERATE, not an
  accident; do not re-slice the items to break it, and do not re-add depends-on edges for it.
  remove-legacy-config-form is fully parallel-safe.
- **Toolchain**: typescript 7.0.2, vended by `@esportsplus/typescript` ^0.29.6 — never import
  `typescript` directly; compiler items import the TS surface as `ts` from `@esportsplus/typescript`.
  The dependency currently resolves through a LOCAL LINK (`pnpm-workspace.yaml` override →
  `D:\typescript`); changes there need `pnpm build` in that repo before this repo consumes them.
- **Spec UUID**: 857a0e51-f3be-4acb-8f64-5b39cc7b4eb4

## Baseline
- **Commit**: HEAD at authoring, clean tree (sha unrecorded — the synthesizer seat runs without
  CLIs; the engine captures the sha at first plan)
- **Suite**: `pnpm agent:test` — 43 files / 1848 passed / 0 failed (measured 2026-07-26,
  post-predecessor runs f177cf28 + 5776b305 + session salvage)
- **Types**: `npx tsc --noEmit` clean; `npx tsc -p tsconfig.build.json --noEmit` clean
- **Benchmark**: none required (no `type: perf` items); bench discovery healthy at 5 files

## Out of Scope

Carried from the predecessor `spec-validator-repair` (its directory is deleted on supersession),
updated to landed truth:

- **ai-orchestrator migration (predecessor audit section J)** — a DIFFERENT repository
  (`D:\ai-orchestrator`); the engine's file-bounds check refuses paths outside this repo. A
  separate follow-up spec, authored after these residuals land (durable record: the matching
  `followups.md` line). It must confront: the return-shape change (`.parse()` throws vs
  `{ok, data, errors}` — user-acknowledged), the COERCION divergence (zod 4.4.3 coerces NOTHING
  by default while this package coerces `'30'` → 30 — a plan node with `{"age":"30"}` flips from
  rejected to accepted), the `S extends z.ZodType` generic inversion in actions/types.ts, and the
  `@esportsplus/typescript` version skew (^0.27.3 vs ^0.29.6, spanning a typescript 5→7 jump, so
  that repo's own compiler plugins must migrate before it can consume this one). It now ALSO
  inherits this spec's wire-format changes (unified packed tag 12, retired 13/14) and schema-hash
  changes (int64 vocabulary, nullable-in-hash).
- **Catch-all index signatures** (declared properties + index signature together) — settled out
  of scope; pure `Record<string, T>` stays supported.
- **draft-07 emission** and any **cross-file/virtual-module schema registry** —
  constraint-excluded.
- **oneOf optimization** — optional per the answered log; not specced.
- **Publishing/release** — the version bump this spec's wire-format and hash changes require is
  noted; the release itself is not an item.

## Features

- encode-growth-signal
- bigint-int64-parity
- infer-nullable-not-mixed
- unify-packed-numeric-tags
- sbc-compute-size
- remove-legacy-config-form

## Feed
run,scope,unit,ordinal,slug,event,state,detail,elapsed_ms,ts
8f60bc49,item,u2,2.1,remove-legacy-config-form,complete,COMPLETE,,,2026-07-26T13:41:56-07:00
8f60bc49,item,u1,1.1,encode-growth-signal,complete,COMPLETE,,,2026-07-26T15:24:35-07:00
8f60bc49,item,u1,1.2,bigint-int64-parity,complete,COMPLETE,,,2026-07-26T15:24:35-07:00
8f60bc49,item,u1,1.4,unify-packed-numeric-tags,complete,COMPLETE,,,2026-07-26T15:24:35-07:00
8f60bc49,item,u1,1.3,infer-nullable-not-mixed,reverted,REVERTED,,,2026-07-26T15:24:35-07:00
8f60bc49,item,u1,1.5,sbc-compute-size,complete,COMPLETE,,,2026-07-26T15:24:35-07:00
8f60bc49,run,,,,run-end,RUN END,"applied: 5 completed, 1 rejected, 1 status-actions, 8 changelog-rows",,2026-07-26T15:24:36-07:00
,item,mutator,,infer-nullable-not-mixed,requeued,REQUEUED,,,2026-07-26T15:26:10-07:00
