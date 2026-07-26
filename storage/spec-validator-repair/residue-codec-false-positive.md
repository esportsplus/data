---
type: fix
recommended-model: sonnet
status: PENDING
priority: P1
files-own: [src/compiler/residue.ts, test/compiler/residue.test.ts, test/compiler/fixtures/residue-codec-root.js]
tests: [test/compiler/residue.test.ts]
---

# Residue gate stops rejecting legitimate codec imports

## Rationale

COMPILE_TIME_SYMBOLS (src/compiler/residue.ts:22) lists codec alongside validator under a comment claiming the runtime stub for each throws when reached. That holds for validator, whose three methods throw at src/index.ts:5-24, and is false for codec, which src/index.ts:27 re-exports as an ordinary runtime factory needing no transform. scanFile sets bound for either symbol and pushes an import finding for the whole statement (:99-118), and assertNoResidue throws on any finding — so a project using the codec without the validator fails the post-build gate on a correct build. Only validator is pushed into validatorLocals for the call-site scan, which is the tell that codec was added with no matching behavior.

## Changes

`COMPILE_TIME_SYMBOLS` in `src/compiler/residue.ts` drops `codec`, keeping only `validator`, and its comment is corrected to say so; with one member the redundant `bound` flag collapses into the existing `validatorLocals` push rather than being left as dead structure. A build importing `codec` from the package root therefore passes `assertNoResidue`, while a surviving `validator` import or call site is still reported exactly as before.

## Design

Settled decisions. Root cause: a symbol that resolves perfectly well at runtime is listed as compile-time-only, so the residue gate rejects builds that are correct.

- **The defect.** `COMPILE_TIME_SYMBOLS` (`src/compiler/residue.ts:22`) holds `['codec', 'validator']` under a comment asserting "the runtime stub for each throws when reached, so their presence in emitted output is the signature of a plugin that never ran". That is true of `validator` and FALSE of `codec`. `src/index.ts:5-24` shows `validator`'s three methods each throwing the "must be transformed at compile-time" error, while `src/index.ts:27` re-exports `codec` from `./sbc/index` as an ordinary runtime factory that needs no transform and works standalone.
- **The consequence.** `scanFile` sets `bound = true` for either symbol (`:99-100`) and then pushes an `import`-kind finding for the whole import statement (`:108-118`). `assertNoResidue` (`:166`) throws on any finding. So a project that imports `codec` from the package root and never touches `validator` FAILS the post-build residue gate — the gate rejects a correct build. Note the asymmetry already present in the code: only `validator` is pushed into `validatorLocals` (`:102-104`) for the call-site scan, because only `validator` HAS compile-time-only call sites. `codec` was added to the set with no corresponding behavior, which is the tell.
- **Fix — remove `codec` from the set and correct the comment.** The set becomes `['validator']`. With one member, `bound` collapses to the same condition as the `validatorLocals` push, so simplify the loop accordingly rather than leaving a one-element Set and a redundant flag — leaving dead structure behind is a failure of this item.
- **Do NOT weaken the gate for `validator`.** The import-kind finding for `validator` is correct and stays: a `validator` import surviving in build output genuinely means the plugin never ran. This item narrows a false positive, it does not relax the real check.
- **Verify the fixture set matches the corrected semantics.** `test/compiler/fixtures/` carries residue fixtures; `residue-clean.js` currently imports from the `/runtime` subpath rather than the root, which sidesteps the root-import path entirely. Add a fixture importing `codec` from the package ROOT and assert it is CLEAN — that is the case this item exists to unbreak, and its absence is why the bug survived.

Test plan (`test/compiler/residue.test.ts`, the mirror for `src/compiler/residue.ts`):

1. The repro: build output importing `codec` from the package root and calling `codec()` produces ZERO findings and `assertNoResidue` does not throw. This fails today.
2. Build output importing `validator` from the root still produces an `import` finding, and `assertNoResidue` throws — the real check is intact.
3. Build output importing BOTH still reports the `validator` import and nothing attributable to `codec`.
4. A `validator.build(...)` call site and a namespace-form `ns.validator.build(...)` call site are each still detected, covering both scan regexes.
5. `COMPILE_TIME_SYMBOLS` contains exactly `validator`, asserted by a source-level check so `codec` cannot be reinstated silently.

## Reads

- src/index.ts — the root export list showing codec as a runtime factory (:27) and validator's three throwing stubs (:5-24)
- src/constants.ts — PACKAGE_NAME, the module specifier the import scan matches against
- test/compiler/fixtures/residue-clean.js — the existing clean fixture, which imports from the /runtime subpath and so never exercised the root-import path

## Acceptance

- Build output importing `codec` from the package ROOT and calling `codec()` produces ZERO findings and `assertNoResidue` does not throw — this fails today and is the reason the item exists.
- Build output importing `validator` from the root still produces an `import` finding and still throws; output importing BOTH reports the `validator` import and nothing attributable to `codec`.
- A `validator.build(...)` call site and a namespace-form `ns.validator.build(...)` call site are each still detected, covering both scan regexes.
- `COMPILE_TIME_SYMBOLS` contains exactly `validator`, asserted by a source-level check so `codec` cannot be reinstated silently; no unused `bound` flag survives.
- 0 regressions in test/compiler/residue.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/residue.test.ts
- npx tsc --noEmit

## Notes

Compiler test harness (rebuilt for TS7): test/utils.ts no longer exposes `createProgram`. Use `compile(code)` → `{ checker, program, sourceFile }` (backed by `languageService.scratch`), `transformRaw(code)` for the data plugin, or `transformWith(plugins, code)` for any plugin set. `ts.createProgram`/`createCompilerHost`/`createSourceFile`/`ts.sys` no longer exist. Fixture types must not be named after DOM globals (`Node`, `Document`, `Range`): a scratch file is a script, not a module, so the name collides with the global instead of shadowing it — the harness pins `lib: ['es2020']` to keep that off the DOM type graph.
