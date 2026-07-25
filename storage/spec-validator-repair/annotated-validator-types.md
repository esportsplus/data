---
type: feature
recommended-model: opus
status: PENDING
priority: P1
source: audit section G (settled API redesign)
depends-on: relocate-tests-and-benches
files-own: [src/types.ts, src/validators/index.ts, src/validators/annotate.ts, test/validators/annotations.test.ts, tsconfig.test.json]
tests: [test/validators/annotations.test.ts]
---

# Annotated validator types and chainable no-op builtins

## Rationale

The settled redesign (section G): `validator.build<User>({name: min(2, '…').describe('display name').default('anon'), …})` with the COMPILER doing the heavy lifting. Measured ground: declaring `min` to return `Annotated<T>` typechecks the full chain cleanly; only a bare inline arrow chain fails (TS2339 — an arrow's type is its call signature; `Function.prototype` augmentation is rejected), so an identity-wrapper helper is the sanctioned spelling. Failure-mode requirement (G, measured): with type-ONLY methods, `min(2,'m').describe('x')` would throw `TypeError: min(...).describe is not a function` BEFORE `build()`'s actionable "must be transformed at compile-time" error, because arguments evaluate first — so the builtins need REAL no-op methods returning `this` (G mitigation 1).

## Changes

The type layer and validator barrel: an Annotated function type, a runtime annotate wrapper attaching no-op chain methods, and an identity helper for inline arrows. Builtins' validation behavior unchanged — annotations are carried by types plus compile-time extraction.

## Design

Settled decisions:

- **Types (src/types.ts).** `Annotated<T> = ValidatorFn<T> & { default(value: T): Annotated<T>; describe(text: string): Annotated<T>; meta(values: Record<string, unknown>): Annotated<T> }` (exact member set: default/describe/meta — the set compiler-annotation-extraction peels). `fn<T>(f: ValidatorFn<T>): Annotated<T>` is the identity wrapper for inline arrows wanting chains (measured-sanctioned spelling); implemented in src/validators/annotate.ts and exported through the `./validators` barrel, beside the builtins users already import.
- **Runtime no-ops (src/validators/annotate.ts, new).** `annotate` wraps a validator FACTORY: the wrapped factory's RETURN value gets `default`/`describe`/`meta` methods attached that return `this` (real no-ops — under a missing/unregistered plugin the chain evaluates harmlessly and `build()` still dies with its actionable message). Attachment mutates the returned function object in place (no proxy, no per-call closure allocation beyond the three shared method references — define them once at module level and assign).
- **Application point: the barrel (src/validators/index.ts).** Each of the 56 exports wraps through `annotate` at re-export time — one file, and the package's only public path to the builtins is the `./validators` subpath, so barrel wrapping covers every consumer. Property bags survive: `annotate` recursively wraps own function-valued properties (`email.html5`, `trim.start`, `uuid.v4`, `words.min`, …) so sub-variants chain too.
- **`fn` doubles as the runtime arm of annotate** — one attachment helper, two entry points (factory wrapping at the barrel; direct value wrapping for user arrows).
- Discretion point: whether `annotate` preserves factory arity/typing via generics or per-export explicit types in the barrel; criterion — zero `any`, no signature widening visible to consumers (`tsc` must catch a wrong-typed default exactly as before), erasable-syntax-only.

Test plan (new `test/validators/annotations.test.ts`): runtime — `min(2,'m').describe('x').default('y')` returns a callable that still validates identically to bare `min(2,'m')` (twin-run over pass/fail vectors) and each method returns the same function identity; sub-variant chains (`email.html5(…).describe('x')`) work; `fn((v, e) => {}).describe('x')` compiles and runs; type-level — `@ts-expect-error` on a bare arrow chain (the TS2339 case stays an error) and on `default(123)` against a string validator.

**Type-assertion mechanism (settled — the repo tsc gate cannot see it).** The base tsconfig includes ONLY `src/**/*` (verified: `npx tsc --noEmit --listFiles` compiles zero test files), so a `@ts-expect-error` in the test tree is inert under the repo gate, and vitest transpiles via esbuild without typechecking. This item therefore AUTHORS `tsconfig.test.json`: extends the root tsconfig, overrides `include` to cover `test/**/*` alongside `src/**/*` (so cross-imports resolve), neutralizes the base's src-pinned `rootDir`, `noEmit: true`. Invoked as a distinct `npx tsc --noEmit -p tsconfig.test.json` — the exact typecheck shape ai-orchestrator already ships, chosen over vitest `--typecheck`/`expectTypeOf` because it exercises real tsc semantics with no new dependency or runner config, and it is directly admissible as a Checks line. Acceptance criterion for the config itself: the command compiles the whole test tree, exits 0 at HEAD-of-item, and flipping any `@ts-expect-error` case (deleting the directive or making the expression legal) flips it non-zero.

## Reads

- src/validators/min.ts — representative factory shape being wrapped (36-LOC template for the family)
- src/validators/email.ts — property-bag factory (html5/rfc5322/unicode variants) the recursive wrap must preserve
- tsconfig.json — the root config tsconfig.test.json extends; its base pins include/rootDir to src, which the new config must override

## Acceptance

- Chains typecheck and run as no-ops on all 56 builtins including sub-variants; validation behavior byte-identical to pre-change (twin-run assertions); the unconfigured-plugin failure mode is `build()`'s actionable error, not a TypeError.
- The type-level assertions EXECUTE: `npx tsc --noEmit -p tsconfig.test.json` exits 0 over the test tree, and removing any `@ts-expect-error` case's directive flips it non-zero (spot-verified during implementation).
- 0 regressions in test/validators/annotations.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/validators/annotations.test.ts
- npx tsc --noEmit -p tsconfig.test.json
- npx tsc --noEmit

## Notes

The compiler-side chain peeling is compiler-annotation-extraction's scope — nothing in this item touches emitted code. `Annotated<T>` is a type (src/types.ts); `fn`/`annotate` are values (src/validators/annotate.ts) — the root entry point is deliberately untouched.
