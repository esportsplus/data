---
type: fix
recommended-model: opus
status: PENDING
priority: P0
source: finding B (audit section B)
depends-on: relocate-tests-and-benches
files-own: [src/compiler/index.ts, src/compiler/validator.ts, test/compiler/config.test.ts]
tests: [test/compiler/config.test.ts]
---

# Repair the dead validator.build config pipeline

## Rationale

P0: the entire per-property config feature is dead code. `src/compiler/index.ts:61` passes `call.configArg?.getText(ctx.sourceFile)` as raw text and `src/compiler/validator.ts:601-607` embeds it as `if (!_errors) { ${customValidatorCode} }` — in statement position the object literal becomes a BLOCK containing a LABELED statement, so `min(5, 'too short')` is evaluated once at validation time and its returned validator DISCARDED. Execution-proven: `{name: min(5,'too short')}` returns `ok: true` for `"ab"`; all four config forms (single fn, array of fns, inline arrow, async arrow) measured `deadConfigBlock = true`. Additionally `ASYNC_PATTERN.test(source)` at `src/compiler/index.ts:73` matches the config TEXT, so an async config mints a pointless `async` validator. README lines 535, 557, 566 document this feature as working.

## Changes

The compiler's config handling: the config object literal is parsed as AST, per-property validator expressions are hoisted and INVOKED in the generated validator, and asyncness is derived from the config AST instead of a text regex.

## Design

Settled decisions:

- **Parse, never embed raw text.** `src/compiler/index.ts` parses `configArg` as a `ts.ObjectLiteralExpression` and produces a per-property map `propertyName → validatorExpr[]` (a single expression or the elements of an array literal). Non-object configs and computed keys are compile errors naming file+line.
- **Hoist factory calls to module scope.** Each config expression is emitted ONCE as a module-level const (`const _v0 = min(5, 'too short');`) beside the generated validator, so factories run at module evaluation, never per validation call (the measured contract: factory calls = 1). Inline arrows/function expressions hoist identically.
- **Invoke per property, gated per property.** Inside the generated validator, after a property's structural checks pass with no error recorded for THAT property, emit `_v0(<propertyAccess>, _errors)` for each configured validator, in declaration order (arrays run in order). Contract stays `(value, errors) => void` — validators push, never throw and never return.
- **Async from AST, not regex.** The generated validator is `async` iff (a) any config expression is an async function/arrow, or (b) the brand machinery requires it (see repair-brand-registration). Replace the `ASYNC_PATTERN` text test's config contribution with this AST-derived flag; when async, each async config validator's invocation is awaited.
- **Error attribution.** Errors pushed by a config validator attribute to the property's path via the existing `_errors` plumbing; the custom validator receives the property VALUE (post-coercion), matching README's examples.
- Discretion point: the exact hoisted-name scheme and whether the per-property gate reuses an existing per-property error-count local or introduces one; criterion — no behavior change to structural validation and no per-call allocation added to the hot path.

Test plan (new `test/compiler/config.test.ts`, transform via `test/utils.ts` and EXECUTE the emitted module — never text-assertions alone): single-fn config rejects short input with the custom message; array config runs both validators in order; inline arrow config pushes its error; async arrow config yields an async validator that awaits and fails; factory-call count at module eval is exactly 1 per config entry; a config-free build emits a NON-async validator (ASYNC_PATTERN no longer misfires on config text).

## Reads

- src/compiler/type-analyzer.ts — AnalyzedProperty shape the generator consumes
- src/types.ts — ValidatorFn and ErrorMessages contracts the config invocations must respect
- test/utils.ts — transformCode/createValidator harness the new suite drives

## Acceptance

- `validator.build<T>({prop: min(...)})` compiled output INVOKES the configured validators; invalid input yields `ok: false` with the custom message (the measured `deadConfigBlock` repro now fails validation).
- All four config forms work: single fn, array, inline arrow, async arrow.
- A config-free type emits no `async` keyword unless brands demand it.
- 0 regressions in test/compiler/config.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/config.test.ts
- npx tsc --noEmit

## Notes

This is the foundation the annotation redesign builds on (compiler-annotation-extraction peels `.describe()/.default()` chains off these same config expressions) — the chain-peel is NOT in scope here; only the base pipeline. Finding C13 (messages for array elements) is error-path-fidelity's scope.
