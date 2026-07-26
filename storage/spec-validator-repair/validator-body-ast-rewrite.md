---
type: fix
recommended-model: opus
status: DEFERRED
priority: P1
depends-on: [validator-boolean-coercion]
files-own: [src/compiler/validators.ts, test/compiler/validators.test.ts]
tests: [test/compiler/validators.test.ts]
blocked-reason: dependency validator-boolean-coercion did not land — reverted
---

# Rewrite validator bodies through the AST, not a regex

## Rationale

One function rewrites user validator bodies two different ways. parse resolves parameter references through the type checker and splices exact spans (src/compiler/validators.ts:126-139) under a comment stating that textual replacement is wrong; inline then rewrites error pushes with ERRORS_PUSH_REGEX (:23), a purely textual match. An escaped quote breaks the emission, a template literal loses its interpolation, and a non-literal argument does not match at all — leaving a free errors identifier in generated code whose scope binds _errors, so validation throws ReferenceError. Every validator.set case in the suite and every README example uses the one shape the regex handles, which is why it survived. The DISALLOWED_BODY_REGEX guard in the same file is separately bypassable and its comment overstates it as a supply-chain mitigation.

## Changes

`src/compiler/validators.ts` rewrites error pushes through the AST instead of `ERRORS_PUSH_REGEX`: `parse` resolves each `<errorsParam>.push(...)` call against the second parameter's symbol and records its span alongside the existing value-parameter spans, and `inline` maps that sentinel to `error.generate(...)` for a static string argument or to a push against the real `_errors` binding for a non-static one. The bypassable `DISALLOWED_BODY_REGEX` guard and its supply-chain-mitigation comment are deleted and replaced with an accurate one-line trust-boundary statement.

## Design


Settled decisions. Root cause: one function rewrites user validator bodies two different ways — parameter references via the AST, error pushes via a regex — and the AST comment in that same function explains exactly why the regex approach is wrong.

- **The inconsistency, in one place.** `parse` (`src/compiler/validators.ts:132-145`) resolves parameter references through `checker.getSymbolAtLocation`, collects their exact spans, and splices a sentinel last-to-first, under a comment stating the rule: "Rename only identifier references bound to the value parameter (AST-resolved), never textual `value` inside string literals or property names." `inline` (`:227-230`) then rewrites error pushes with `ERRORS_PUSH_REGEX` (`:23`), a purely textual `errors\.push\((['"\`])(.+?)\1\)` — the exact class of transform the comment above rejects.
- **Three failure modes, all silent.** (a) An escaped quote — `errors.push('it\'s bad')` — terminates the non-greedy capture at the backslash-escaped quote, so the replacement consumes the wrong span and emits syntactically broken generated code. (b) A template literal with interpolation — `` errors.push(`bad: ${v}`) `` — is captured as literal TEXT, so the interpolation is passed to `error.generate` as part of a static message and the runtime value is lost. (c) A non-literal argument — `errors.push(msg)` — does not match at all, so the text is inlined verbatim and the generated function references a free `errors` identifier. The generated scope binds `_errors` (`src/compiler/error.ts:5`), not `errors`, so that is a ReferenceError thrown from inside validation.
- **Why it survived.** Every `validator.set` case in the suite passes a plain single-quoted string literal — `test/compiler/branded-strings.test.ts:168`, `:198`, `:217`, `:235` — which is precisely the one shape the regex handles. README's examples (`:540`, `:570`, `:606`, `:612`) use the same shape, so the documented happy path masks the rest.
- **Fix — rewrite error pushes through the AST, exactly as parameter references already are.** In `parse`, walk `fn.body` for call expressions whose callee is a property access `<errorsParam>.push`, resolving the receiver against the SECOND parameter's symbol rather than matching the identifier text. Record each call's span alongside the value-parameter spans and splice a distinct sentinel carrying the argument's node. `inline` then maps that sentinel to `error.generate(...)` for a static string argument, and for a non-static argument (template with interpolation, variable, object literal) emits a push against the real `_errors` binding instead of a static message. One splice pass, one ordering rule, both rewrites AST-resolved.
- **Delete `DISALLOWED_BODY_REGEX` and correct its comment.** `:21` tests `/\b(eval|Function)\s*\(/` under a comment (`:211-215`) claiming it mitigates "supply-chain risk (compromised dependency injecting malicious validator bodies)". It does not: `(0,eval)('…')`, `globalThis['ev'+'al']('…')`, `[]['constructor']['constructor']('…')` and `` eval`…` `` all pass it. More fundamentally the threat model does not hold — the body comes from the user's own TypeScript source, and anyone who can edit that already has build-time code execution by a hundred other routes. A guard that cannot be made complete and that the comment claims is a mitigation is worse than none, because it invites reliance. Replace both with an accurate one-line trust-boundary statement: the body is user source, compiled as written.

Test plan (`test/compiler/validators.test.ts`, the mirror for `src/compiler/validators.ts`):

1. `errors.push('it\'s bad')` transforms to valid generated code and reports the message with its apostrophe intact — today this produces a broken or truncated emission.
2. `` errors.push(`bad: ${value.length}`) `` reports a message containing the interpolated value at runtime, not the literal text `${value.length}`.
3. `let msg = 'x'; errors.push(msg)` reports `x` at runtime instead of throwing `ReferenceError: errors is not defined`.
4. A body containing the TEXT `errors.push('a')` inside a string literal — e.g. `errors.push("saw errors.push('a')")` — is not double-rewritten; the inner occurrence survives as data. This is the AST-vs-text assertion.
5. The documented happy path is unchanged: every existing `validator.set` case in test/compiler/branded-strings.test.ts still passes with byte-identical emitted output.
6. A body calling `eval(...)` now compiles rather than throwing `Validator: body contains disallowed pattern`, and `DISALLOWED_BODY_REGEX` is absent from the module — asserted by a source-level check so the guard is not reinstated as theatre.

## Reads

- src/compiler/error.ts — ERRORS_VARIABLE (`_errors`) and error.generate, the binding and emitter the rewritten pushes target
- src/compiler/types.ts — PathMode, threaded into inline() unchanged
- test/compiler/branded-strings.test.ts — the existing validator.set cases whose emitted output must stay byte-identical (reference only, not an edit target)
- README.md — the documented validator.set examples (:540, :570, :606, :612), all of which use the one shape the regex handled

## Acceptance

- `errors.push('it\'s bad')` emits valid code and reports the apostrophe intact; `` errors.push(`bad: ${value.length}`) `` reports the INTERPOLATED value, not the literal `${value.length}`.
- `let msg = 'x'; errors.push(msg)` reports `x` instead of throwing `ReferenceError: errors is not defined`.
- A body whose string literal CONTAINS the text `errors.push('a')` is not double-rewritten — the inner occurrence survives as data. This is the AST-vs-text assertion.
- Every existing `validator.set` case in test/compiler/branded-strings.test.ts still emits BYTE-IDENTICAL output, proving the documented path is untouched.
- A body calling `eval(...)` compiles rather than throwing `Validator: body contains disallowed pattern`, and `DISALLOWED_BODY_REGEX` is absent from the module, asserted by a source-level check.
- 0 regressions in test/compiler/validators.test.ts and test/compiler/branded-strings.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/validators.test.ts test/compiler/branded-strings.test.ts
- npx tsc --noEmit

## Notes

TS7 migration (landed after authoring): this repo now compiles on typescript 7.0.2 through @esportsplus/typescript, whose root vends the TS surface as `ts`. Deleted APIs — `ts.TypeChecker` is `ts.Checker`; `ts.forEachChild(n, cb)` is `n.forEachChild(cb)`; `ts.getCombinedModifierFlags` and `ts.IndexKind` are gone (use a node's `modifierFlags` field and `checker.getIndexInfosOfType`); `type.isUnion/isStringLiteral/isIntersection()` are `isUnionType/isStringLiteralType/isIntersectionType()`; `symbol.getName()` is `symbol.name` and `symbol.declarations` holds NodeHandles needing `.resolve()`; `checker.getTypeAtLocation`/`getTypeOfSymbol` now return `Type | undefined`. Never import `typescript` directly — the surface is vended centrally.
Compiler test harness (rebuilt for TS7): test/utils.ts no longer exposes `createProgram`. Use `compile(code)` → `{ checker, program, sourceFile }` (backed by `languageService.scratch`), `transformRaw(code)` for the data plugin, or `transformWith(plugins, code)` for any plugin set. `ts.createProgram`/`createCompilerHost`/`createSourceFile`/`ts.sys` no longer exist. Fixture types must not be named after DOM globals (`Node`, `Document`, `Range`): a scratch file is a script, not a module, so the name collides with the global instead of shadowing it — the harness pins `lib: ['es2020']` to keep that off the DOM type graph.
DEFERRED 2026-07-26T08:28:15.108Z run=f177cf28 class=dependency reason="dependency validator-boolean-coercion did not land — reverted" salvage=none
