---
type: chore
recommended-model: sonnet
status: PENDING
depends-on: none
files-shared: package.json
tests: [tests/primitives.ts]
api-impact: none
---

# Add agent:test script to package.json

## Rationale
The repo exposes no `agent:test` script (S10 — `package.json` scripts are build/build:test/prepare/prepublishOnly/bench/test only) and the workflow engine invokes exactly that name, appending each item's `tests` file paths as trailing arguments. Without it, no other item in this spec can be validated or executed by spec:implement, which is why every other item depends on this one.

## Changes
Package manifest scripts: add an agent-facing test entry that routes to the existing vitest runner and accepts trailing test-file path filters. No behavior of any existing script changes.

## Design
1. In `package.json` `scripts`, add `"agent:test": "vitest run"` in the bottom script group (beside `bench` and `test`, after the `"--"` separator key — preserve the existing separator-key layout exactly as-is).
2. Nothing else: `vitest run <paths...>` already treats trailing arguments as file filters, which is precisely the engine's calling convention. No `agent:bench` (this spec has zero `type: perf` items). No project CLAUDE.md — the engine only needs the script name, so authoring one is unnecessary scope.
3. The repo is pnpm-only (`pnpm-lock.yaml`); never invoke npm.

## Reads
- vitest.config.ts — confirms the flat `tests/**/*.ts` include and exclude list the script's filters run against
- tests/primitives.ts — the green suite used to prove trailing-path filtering works

## Acceptance
`pnpm agent:test tests/primitives.ts` exits 0 and runs only the filtered file; 0 regressions in tests/primitives.ts, run scoped.

## Checks
- pnpm agent:test tests/primitives.ts

## Notes
The full suite carries one pre-existing failure (`tests/namespace-imports.ts:140`, see index Baseline) — this item's evidence is the scoped run above, never a bare `pnpm agent:test` with no filter.
