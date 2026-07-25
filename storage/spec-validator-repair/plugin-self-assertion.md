---
type: feature
recommended-model: opus
status: PENDING
priority: P1
source: audit section G (mitigations 2 and 3, settled)
depends-on: [compiler-annotation-extraction, compiler-import-detection, repair-brand-registration]
files-own: [src/compiler/index.ts, src/compiler/residue.ts, test/compiler/self-assertion.test.ts, test/compiler/fixtures/residue-clean.js, test/compiler/fixtures/residue-dirty.js, package.json]
tests: [test/compiler/self-assertion.test.ts]
---

# Plugin self-assertion and post-build residue check

## Rationale

Settled failure-mode hardening (section G): (2) a plugin SELF-ASSERTION that, after transforming a file, checks its own output for `validator.*` call sites it should have consumed and throws a build error naming file+line — this is the guard that catches C9-class silently-missed call sites structurally, instead of by luck; (3) a post-build residue check consumers wire into `build`/`prepublishOnly`, because an UNREGISTERED plugin processes nothing and asserts nothing — the self-assertion alone cannot see a file it never visited. The hook belongs in the data plugin's own transform return — `src/compiler/plugins/tsc.ts` is just `plugin.tsc([data, sbc])`.

## Changes

The data plugin's transform gains an output audit; a new residue-scan utility ships for consumer build pipelines.

## Design

Settled decisions:

- **Self-assertion (in-transform).** After producing output for a file, scan the transformed AST/text for surviving consumable call sites — `build`/`set`/`toJsonSchema` reached through the local names in compiler-import-detection's alias map (plain, aliased, and namespace forms). Any survivor throws `Error('@esportsplus/data: untransformed <method> call at <file>:<line>:<col> — …')` at BUILD time. The assertion runs only on files the plugin actually transformed or detected candidates in (zero cost on pre-filtered-out files).
- **Residue scan (post-build).** New `src/compiler/residue.ts` exporting `scanBuildOutput(dir: string): ResidueFinding[]` — walks emitted `.js` under `dir` and reports (a) surviving `validator.<method>(` call-site text reached via `@esportsplus/data` imports and (b) imports of the package root whose only purpose was the compile-time API (the runtime-stub-will-throw signature). A findings array return (never process.exit inside the library) plus a tiny assert wrapper `assertNoResidue(dir)` that throws listing every finding. Exposed through the EXISTING `./compiler/tsc`-adjacent surface: re-export from both plugin entry modules is NOT needed — a named export from `./compiler/tsc` would drag plugin deps into a check script, so the settled shape is a dedicated subpath-free deep import documented as `@esportsplus/data/compiler/residue`… which requires an exports entry. NAMED DISCRETION POINT: package.json `exports` gains `./compiler/residue` OR the scan ships as a `bin` script; criterion — a consumer wires it with ONE line in `build`/`prepublishOnly` without importing typescript/vite plugin machinery; whichever shape is chosen, runtime-tojsonschema also edits package.json exports — coordinate orderings via the spec's document order (this item lands first in Features order… it does not — runtime-tojsonschema follows; the weld on package.json serializes them safely if the exports entry is chosen).
- **This repo does NOT wire the scan into its own build** — the library's own build never runs the plugin; consumer wiring is documentation (readme-accuracy).

Test plan (new `test/compiler/self-assertion.test.ts`): a transformable file with a detectable call the transform consumed passes silently; a crafted output containing a surviving aliased `v.build` call triggers the named error with file+line (drive the scanner directly for determinism); `scanBuildOutput` over the colocated fixtures (`test/compiler/fixtures/residue-dirty.js`, `test/compiler/fixtures/residue-clean.js` — outside discovery per the fixtures convention) reports the surviving-call and stub-import classes on the dirty fixture and returns empty on the clean one; `assertNoResidue` throws with every finding listed.

## Reads

- src/compiler/plugins/tsc.ts — plugin composition point (unchanged; confirms the hook belongs in the data plugin's transform)
- src/constants.ts — PACKAGE_NAME for import matching
- package.json — exports map (touched ONLY if the exports-entry branch of the discretion point is chosen)

## Acceptance

- A silently-missed call site class (C9 shape) now fails the BUILD with file+line instead of shipping dead config; the residue scanner classifies clean vs dirty build output correctly on fixtures.
- 0 regressions in test/compiler/self-assertion.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/self-assertion.test.ts
- npx tsc --noEmit

## Notes

package.json is declared files-own because BOTH branches of the discretion point (an `exports` entry or a `bin` entry) edit it; the planner's weld with relocate-tests-and-benches and runtime-tojsonschema on that file is deliberate.
