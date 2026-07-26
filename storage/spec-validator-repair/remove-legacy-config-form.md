---
type: refactor
recommended-model: sonnet
status: RUN_THROUGH_SPEC_CREATE
priority: P2
depends-on: [relocate-tests-and-benches]
files-own: [src/compiler/index.ts, src/types.ts, test/compiler/index.test.ts]
tests: [test/compiler/index.test.ts]
blocked-reason: The item's own verify-dead gate passes (confirmed via `tsc --noEmit` on a scratch file: `Validator.build`'s declared `_config?: ValidatorConfig<T>` already rejects any function argument today with TS2559 'has no properties in common' — a weak-type error — so no type-checked caller can reach the arrow/function branch of parseConfig), but deleting that branch and tightening the type as instructed empirically breaks 4 tests in test/compiler/async-validators.test.ts (verified by implementing the change and running `npx vitest run test/compiler/async-validators.test.ts test/compiler/edge-cases.test.ts`: 45/45 pass before, 41/45 pass after — the 4 failures are exactly the async-detection assertions for a raw-function config argument). That file's test harness imports `validator` from the unresolvable `@esportsplus/data` specifier (no node_modules entry, no build/ output), so `validator` types as implicit `any` there and the public-type rejection never applies — the harness exercises the compiler's AST-level branch directly, bypassing the type gate the Design relies on as its sole liveness check. async-validators.test.ts is not in this item's files-own and Test targets list (only test/compiler/index.test.ts), so I cannot update or remove its now-obsolete assertions, and the Design's verify step never accounts for tests that reach the branch through an untyped/unresolvable import. This needs a decision the spec doesn't settle: either widen files-own to include test/compiler/async-validators.test.ts (and edge-cases.test.ts) so its raw-function-config assertions can be deleted/rewritten alongside the branch removal, or descope the deletion. All edits were reverted; the working tree is clean (git status/diff empty) and no commit was made.
---

# Delete the never-invoked raw-function validator config form

## Rationale

src/compiler/index.ts:100 documents its own dead branch: a raw-function config is the legacy (never-invoked) form kept only for async detection. Under the no-back-compat directive that is exactly the bloat to delete, together with isAsyncFunction if it loses its last caller and hasAsync if the removal makes it constantly false. Tightening build's config parameter type in the same pass turns a function argument into a compile error rather than a silently-ignored no-op, matching the rule encodable-type-constraint applies to encode.

## Changes

The never-invoked raw-function branch of `parseConfig` leaves `src/compiler/index.ts`, together with `isAsyncFunction` and the `hasAsync` field if the removal orphans them, and `src/types.ts` narrows `build`'s config parameter to the object-literal shape so a function argument becomes a compile error instead of a silently-ignored no-op. Public API break: a function config is no longer accepted by the type.

## Design


Settled decisions. This is a dead-branch removal, self-documented as dead in the source.

- **The branch.** `src/compiler/index.ts:105` carries the comment "A raw-function config is the legacy (never-invoked) form kept only for async detection", and `parseConfig` (`:101-104`) opens with `if (ts.isArrowFunction(configArg) || ts.isFunctionExpression(configArg)) { return { hasAsync: isAsyncFunction(configArg), hoisted: [] }; }`. Under this spec's no-back-compat directive a never-invoked legacy form is exactly the bloat to delete.
- **Verify dead before deleting — this is a gate, not a formality.** The branch is reachable only if `validator.build<T>(config)` is ever called with a function rather than an object literal. Before removing it, grep the repo (`src/`, `test/`, `README.md`) for a `build<...>(` call whose argument is an arrow or function expression, and confirm the public type of `build`'s config parameter in `src/types.ts` does not admit a function. If the type DOES admit a function, the branch is live and this item stops and reports instead of deleting — narrowing that public type would be a separate decision.
- **On confirmed-dead, delete the branch and the now-unreachable helper.** Remove the arrow/function arm from `parseConfig`, then check whether `isAsyncFunction` retains any other caller; if it does not, delete it too. `hasAsync` remains in `ParsedConfig` only if the object-literal path still sets it — if the removal makes the field constantly `false`, delete the field and simplify every consumer rather than leaving an always-false flag. Dead code left behind is a failure of this item.
- **Tighten the config type in the same pass.** With the function form gone, `build`'s config parameter type should name the object-literal shape exactly, so a function argument becomes a TypeScript error at the call site rather than a silently-ignored no-op. This is the same principle `encodable-type-constraint` applies to `encode`: reject at compile time, never absorb at runtime.
- **Coordinate with compiler-annotation-extraction.** That item rewrites `build<T>()`'s emitted shape to a plain object literal (answered question Q1) and also owns `src/compiler/index.ts`. This item is ordered BEFORE it so the annotation work starts from the smaller surface; if the two collide in the same region, this item's removal wins and the other rebases.

Test plan (`test/compiler/index.test.ts`, the mirror for `src/compiler/index.ts`):

1. A compile assertion (`@ts-expect-error`) that `validator.build<T>(() => {})` and `validator.build<T>(async () => {})` are type errors after the parameter type tightens.
2. The object-literal config path transforms exactly as at baseline — take an existing passing transform case and assert byte-identical emitted output before and after this item, proving the deletion touched nothing live.
3. An async validator inside an OBJECT-literal config is still detected and still produces the async emission path — this is the capability the dead branch was nominally protecting, and it must be proven to live elsewhere.
4. `isAsyncFunction` is either still referenced by a live caller or absent from the module — asserted by a source-level check in the suite so a half-removal cannot pass.

## Reads

- src/compiler/validator.ts — the generator consuming ParsedConfig.hasAsync, the deletion's only downstream
- README.md — any documented function-config form, corrected later by readme-accuracy

## Acceptance

- The arrow/function arm is gone from `parseConfig`; `isAsyncFunction` is either still called by live code or deleted; `hasAsync` is either still meaningfully set or deleted with every consumer simplified.
- An existing object-literal transform case emits BYTE-IDENTICAL output to baseline, proving the deletion touched nothing live.
- Async detection inside an object-literal config still produces the async emission path.
- 0 regressions in test/compiler/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/index.test.ts
- npx tsc --noEmit

## Notes

TS7 migration (landed after authoring): this repo now compiles on typescript 7.0.2 through @esportsplus/typescript, whose root vends the TS surface as `ts`. Deleted APIs — `ts.TypeChecker` is `ts.Checker`; `ts.forEachChild(n, cb)` is `n.forEachChild(cb)`; `ts.getCombinedModifierFlags` and `ts.IndexKind` are gone (use a node's `modifierFlags` field and `checker.getIndexInfosOfType`); `type.isUnion/isStringLiteral/isIntersection()` are `isUnionType/isStringLiteralType/isIntersectionType()`; `symbol.getName()` is `symbol.name` and `symbol.declarations` holds NodeHandles needing `.resolve()`; `checker.getTypeAtLocation`/`getTypeOfSymbol` now return `Type | undefined`. Never import `typescript` directly — the surface is vended centrally.
Compiler test harness (rebuilt for TS7): test/utils.ts no longer exposes `createProgram`. Use `compile(code)` → `{ checker, program, sourceFile }` (backed by `languageService.scratch`), `transformRaw(code)` for the data plugin, or `transformWith(plugins, code)` for any plugin set. `ts.createProgram`/`createCompilerHost`/`createSourceFile`/`ts.sys` no longer exist. Fixture types must not be named after DOM globals (`Node`, `Document`, `Range`): a scratch file is a script, not a module, so the name collides with the global instead of shadowing it — the harness pins `lib: ['es2020']` to keep that off the DOM type graph.
