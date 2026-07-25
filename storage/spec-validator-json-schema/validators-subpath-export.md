---
type: feature
recommended-model: sonnet
status: PENDING
depends-on: agent-test-script
files-own: [package.json]
tests: [tests/validators.ts]
api-impact: none
---

# Expose builtin validators via a ./validators subpath export

## Rationale
`toJsonSchema<T>(config)`'s constraint half is unusable outside this repo today: `src/index.ts` re-exports none of the 56 builtins and the `exports` map carries only `.`, `./compiler/tsc`, `./compiler/vite` (S10), so the consuming sibling package cannot legally import `min`/`email`/... to put in a config. The only by-name consumer is the suite-excluded `tests/compile-validators.ts` script — no shipped surface exists. Q1 (answered — index.md Answered log) chose this surface; this item implements it.

## Changes
Package manifest: one additive subpath export routing to the already-built validators barrel. No source file changes — `src/validators/index.ts` already exports all 56 names and `tsc` already emits `build/validators/index.js` + `.d.ts` (the build compiles all of `src/` with declarations to `build/`, same layout the existing `./compiler/*` export entries rely on).

## Design
1. In `package.json` `exports`, add (after the `.` entry, matching the existing conditional-export shape):

```json
"./validators": {
    "types": "./build/validators/index.d.ts",
    "default": "./build/validators/index.js"
}
```

2. Nothing else. The subpath deliberately avoids the root barrel: re-exporting from `src/index.ts` would put the `integer` VALUE beside the `integer` TYPE from `./types` (collision-check burden for zero gain), and config-constraint-extractor already recognizes the `@esportsplus/data/validators` specifier.

## Reads
- build/validators/index.d.ts — the emitted declaration file the `types` condition resolves to (present on disk; gitignored build output)
- build/validators/index.js — the emitted barrel the `default` condition resolves to (present on disk; gitignored build output)
- package.json — the exports map being extended and the ./compiler/* entry shape being mirrored
- src/index.ts — the root barrel this item deliberately does NOT extend (the rejected option-2 surface)
- src/validators/index.ts — the barrel the subpath exposes (56 default re-exports, verified)

## Acceptance
After `pnpm build`, `build/validators/index.js` and `build/validators/index.d.ts` exist and the exports map resolves `./validators` to them; 0 regressions in tests/validators.ts, run scoped.

## Checks
- npx tsc --noEmit
- pnpm agent:test tests/validators.ts

## Notes
Additive public API (a new subpath) — approved by Q1's answer (subpath export; root re-export rejected). package.json is this item's SOLE substantive edit target, so it is `files-own`; safety against agent-test-script's scripts hook comes from the disjoint keys (scripts vs exports) plus the `depends-on: agent-test-script` edge that serializes the two edits — not from the field choice.
