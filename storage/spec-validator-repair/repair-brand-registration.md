---
type: fix
recommended-model: opus
status: PENDING
priority: P0
source: findings C1, C2 (audit section C)
depends-on: [relocate-tests-and-benches, compiler-import-detection]
files-own: [src/compiler/index.ts, src/compiler/validators.ts, src/compiler/validator.ts, test/compiler/branded-strings.test.ts]
tests: [test/compiler/branded-strings.test.ts]
---

# Repair validator.set brand registration and consumption

## Rationale

Two P0s with one subsystem. C1: `src/compiler/index.ts:119` traces the `validator` identifier through its import alias to the package's own `index.d.ts`, and `src/compiler/validators.ts:98-116` scans THAT declaration file for `validator.set(...)` — `ctx.sourceFile` is never scanned, so every brand registration is dead (re-verified: brand check emitted = false; string/number/async brands, two brands, outer-scope regex ref all return `ok: true` on invalid input). The entire inline/sentinel machinery, `DISALLOWED_BODY_REGEX`, and brand-driven `hasAsync` promotion are unreachable. C2: the plugin never removes `validator.set(...)` — a set+build file crashes with `ReferenceError: validator is not defined` after `remove: ['validator']` (`src/compiler/index.ts:195-197`), and a set-only file (README:597-618's own example) early-returns at `:154-156`, ships verbatim, and throws at module load via the runtime stub (`src/index.ts:12`).

## Changes

Brand registration collection reads real user source; consumed registrations are stripped from output; set-only modules transform cleanly; brand-driven async promotion works.

## Design

Settled decisions:

- **Scan real source, never the traced declaration file.** Registration collection starts from `ctx.sourceFile`: every top-level `validator.set(name, fn)` (through the local alias name — see compiler-import-detection's alias map) is parsed into the existing registry shape `src/compiler/validators.ts` already consumes (inline body, sentinel checks, async flag via `DISALLOWED_BODY_REGEX`).
- **Registration scope is a NAMED discretion point.** Implementer decides between (a) plugin-instance accumulation: every file the plugin processes contributes its `validator.set` calls to shared plugin state consumed by later `build` sites, and (b) current-file + directly-imported-files resolution via ts module resolution. Criterion: README:597-618's set-in-a-separate-`validation.ts` example must work under BOTH the tsc and vite plugins, without a cross-file/virtual-module schema registry (explicitly out of scope per constraints), and a build site must fail LOUDLY (compile error naming the brand and file) when a brand it needs is not yet registered — never silently skip the brand check.
- **Strip consumed calls.** After collection, `validator.set(...)` statements are REMOVED from the transformed output (C2a); a file left with no remaining `validator` references also drops the import (the existing `remove: ['validator']` path then stays correct). A set-ONLY file no longer early-returns: `detected` must include `set` so the file is transformed to (typically) an empty statement list plus its other exports — the runtime stub is never reached under the plugin.
- **Async promotion.** A brand whose registered body is async promotes the consuming validator to async (the existing `hasAsync` intent), combined with config asyncness from repair-validator-config-compilation.
- **Runtime behavior without the plugin is unchanged**: `validator.set` still throws the actionable stub error (README:308 text updated by readme-accuracy).

Test plan (rewrite `test/compiler/branded-strings.test.ts` — its current `code.toContain('invalid value length')` assertions pass only because the UNtransformed `validator.set` source survives in output, finding A3): assert (a) emitted code contains the inlined brand check against `_input` (e.g. the length check), (b) `validator.set` is ABSENT from output, (c) executed behavior: invalid branded values return `ok: false` for string brand, number brand, async brand, two brands in one file, and a brand referencing an outer-scope regex; (d) a set+build file transforms and RUNS without ReferenceError; (e) a set-only file transforms to output that imports/executes cleanly.

## Reads

- src/index.ts — the runtime stub whose throw the set-only fix makes unreachable under the plugin
- src/constants.ts — PACKAGE_NAME used by detection/messages
- test/utils.ts — transform harness

## Acceptance

- A brand registered in the user file changes emitted code (brand check present) and runtime behavior (invalid input rejected) for all five re-verified scenarios.
- set+build and set-only files both transform and execute without ReferenceError or stub throw.
- 0 regressions in test/compiler/branded-strings.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/branded-strings.test.ts
- npx tsc --noEmit

## Notes

C1's fix makes `src/compiler/validators.ts`'s previously unreachable machinery live for the first time — expect latent defects inside it; fixing those discovered in-scope is authorized within this item's files.
