---
type: refactor
recommended-model: opus
status: PENDING
priority: P2
depends-on: none
files-own: [src/compiler/index.ts, test/compiler/async-validators.test.ts, test/compiler/edge-cases.test.ts, test/compiler/index.test.ts]
tests: [test/compiler/index.test.ts, test/compiler/async-validators.test.ts, test/compiler/edge-cases.test.ts]
removes-tests: [test/compiler/async-validators.test.ts, test/compiler/edge-cases.test.ts]
---

# Delete the never-invoked raw-function validator config form

## Rationale

`src/compiler/index.ts:105` documents its own dead branch — "A raw-function config is the legacy
(never-invoked) form kept only for async detection" — and `parseConfig` opens with the arrow/
function-expression arm at `:107-109`. The predecessor attempt PROVED the liveness picture (its
terminal annotation, carried forward as the settled evidence): the branch is dead to every
TYPE-CHECKED caller — `Validator.build`'s `_config?: ValidatorConfig<T>` (`src/types.ts:50-52`,
`:66-70`) is a weak type, so a function argument already fails with TS2559 — but LIVE to the test
harness, because `test/utils.ts` compiles code strings whose `validator` import resolves as
implicit `any`, reaching the AST branch with no type gate. Deleting the branch without owning
those tests broke exactly 4 async-detection assertions (45/45 → 41/45) that the item's declared
surface forbade it from touching. That fork is settled HERE, not handed back to the seat.

## Changes

The compiler's config parser drops its legacy raw-function arm; a raw-function config argument
(reachable only from untyped call sites) is thereafter treated as an absent config — sync
emission, no hoisting — while async detection lives exclusively where it is actually used, the
object-literal path. The affected test suites are rewritten IN the same item to exercise async
detection through the live form, plus type-level assertions pinning the compile-time rejection.
`isAsyncFunction` is retained — verified live at the object-literal path — and no public type
changes: the predecessor's "tighten the config type" step is DROPPED as a no-op, since the weak
type already rejects functions.

## Design

Settled decisions, including the fork from the predecessor's failure: WIDEN the surface (own the
test rewrites), do not descope the deletion. Reasoning: the raw-function `build` calls in the tree
are all in tests. Seven reach `parseConfig` and are the branch's only live callers —
`test/compiler/async-validators.test.ts:10, :21, :32, :56, :70, :85` and
`test/compiler/edge-cases.test.ts:461` (sweep verified at HEAD; no source or README caller). An
eighth exists at `test/compiler/json-schema-constraints.test.ts:404` ('returns an empty map for a
function-form config') and is VERIFIED HARMLESS — it feeds `extract()` → `extractConstraints`
directly (:23-27), never routing through `parseConfig`, so the deletion cannot break it and it
needs no rewrite (named here so no reader mistakes it for a missed site). So the tests ARE the
liveness, and rewriting the seven to the live form both unblocks the deletion and improves what
they assert (the raw-function form never shipped as a usable API).

Ordered recipe — the order is load-bearing, each step leaves the tree green:

1. **Rewrite the tests FIRST, against unmodified source.** Convert each raw-function config to an
   object-literal config exercising the same emission property through the live path
   (`isAsyncFunction(base)` at `src/compiler/index.ts:154`):
   - "generates async function when async config is provided" → `validator.build<User>({ email:
     async (value, errors) => { ... } })` asserting the async emission;
   - "await keyword in config body" → a property validator whose body carries an await
     expression without the `async` modifier keyword spelled on it, so the AST body-scan half of
     `isAsyncFunction` (:68) is exercised — mirroring the original modifier-vs-body detection
     pair;
   - "sync when no async/await" and "no config argument" → object-literal sync config / absent
     config asserting sync emission;
   - the extraction/behavior cases (:56, :70, :85) and `edge-cases.test.ts:461` → same
     transformation, assertions preserved.
   Object-literal async detection is already live today, so the rewritten files pass BEFORE the
   deletion — commit this state (directive 1).
2. **Delete the branch:** remove `:107-109` and the `:105` comment from `parseConfig`. A
   raw-function argument then falls through the `!ts.isObjectLiteralExpression` arm (:111-113) and
   compiles as if no config was passed. `isAsyncFunction` (:62-72) KEEPS its live caller at :154 —
   it is NOT deleted; `hasAsync` stays meaningfully set by the object path — NOT deleted. (The
   predecessor's conditional-deletion clauses resolve to "retain" on verified evidence; leaving
   this explicit prevents a seat from hunting phantom dead code.)
3. **Pin the contract in `test/compiler/index.test.ts`:** (a) a TYPE-level block — `declare const
   v: Validator;` (import the type from `src/types.ts`) with `// @ts-expect-error` on
   `v.build<{ a: string }>(() => {})` and on the `async () => {}` form — the string-compiling
   harness cannot carry this assertion, so it lives as real typed code gated by `tsc --noEmit`;
   (b) a runtime assertion that a raw-function config argument now emits byte-identical output to
   the no-config form (the "silently ignored for untyped callers" contract, documented as
   deliberate); (c) an existing object-literal transform case asserted byte-identical to its
   pre-item output, proving the deletion touched nothing live.

Discretion point: the exact object-literal bodies used in the rewritten async tests — criterion:
each rewritten test must fail if the emission property it originally guarded regresses (async
prefix presence/absence, custom validation code inclusion, Promise-vs-plain return).

## Reads

- src/types.ts — Validator.build (:50-52) and ValidatorConfig (:66-70), the weak-type gate that
  makes the branch unreachable from typed code (read, not modified)
- src/compiler/validator.ts — the generator consuming ParsedConfig.hasAsync, the emission the
  rewritten tests assert
- test/utils.ts — compile()/transformRaw(), the implicit-any harness that made the branch live
- test/compiler/json-schema-constraints.test.ts — the 8th raw-function call site (:404),
  VERIFIED-HARMLESS and NEVER-EDITED: it feeds `extract()` → `extractConstraints` directly
  (:23-27) and never routes through `parseConfig`, so the deletion cannot break it; Directive 1
  rewrites exactly the seven live callers, not this one

## Acceptance

- The arrow/function arm and its comment are gone from `parseConfig`; `isAsyncFunction` retains
  its object-path caller; `hasAsync` is still meaningfully set.
- Async detection through object-literal configs is proven for both the `async` modifier and the
  await-in-body cases; a raw-function config emits identically to no config; the `@ts-expect-error`
  assertions hold under `npx tsc --noEmit`.
- An existing object-literal transform case emits byte-identical output to baseline.
- 0 regressions in test/compiler/index.test.ts, test/compiler/async-validators.test.ts and
  test/compiler/edge-cases.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/index.test.ts test/compiler/async-validators.test.ts test/compiler/edge-cases.test.ts
- npx tsc --noEmit

## Directives

1. test/compiler/async-validators.test.ts, test/compiler/edge-cases.test.ts — rewrite the 7 raw-function build calls to object-literal configs preserving each test's emission assertion; green against unmodified source
2. src/compiler/index.ts, test/compiler/index.test.ts — delete the legacy branch; add the type-level rejection block, the ignored-raw-function-config assertion, and the byte-identical object-literal baseline case

## Notes

Toolchain (carried from the predecessor, still current): typescript 7.0.2 via
`@esportsplus/typescript` — `ts.Checker` not `ts.TypeChecker`, `n.forEachChild(cb)` not
`ts.forEachChild`, no `ts.getCombinedModifierFlags`/`ts.IndexKind`; never import `typescript`
directly. Harness: `test/utils.ts` exposes `compile(code)` → `{ checker, program, sourceFile }`,
`transformRaw(code)`, `transformWith(plugins, code)`; `ts.createProgram`/`createSourceFile`/
`ts.sys` do not exist; fixture type names must not collide with DOM globals (scratch files are
scripts — harness pins `lib: ['es2020']`).
