---
type: fix
recommended-model: opus
status: PENDING
priority: P1
source: audit section E (numeric/constraint block)
depends-on: relocate-tests-and-benches
files-own: [src/validators/min.ts, src/validators/max.ts, src/validators/range.ts, src/validators/multiple-of.ts, src/validators/length.ts, src/validators/integer.ts, src/validators/positive.ts, src/validators/negative.ts, src/validators/non-negative.ts, src/validators/non-positive.ts, src/validators/finite.ts, src/validators/safe-integer.ts, src/validators/bytes.ts, src/validators/graphemes.ts, src/validators/date-constraint.ts, test/validators/number-date.test.ts, test/validators/constraints.test.ts, test/validators/advanced.test.ts]
tests: [test/validators/number-date.test.ts, test/validators/constraints.test.ts, test/validators/advanced.test.ts]
---

# Numeric/constraint validators: never throw, handle NaN and bigint coherently

## Rationale

Executed P1s: `min`/`max`/`range` silently PASS every NaN (`min.ts:12`, `max.ts:12`, `range.ts:12`); throw raw `RangeError` on a fractional bound vs a bigint value (`:18`, unguarded `BigInt(number)`) — and the compiler emits no try/catch, so it escapes `ValidatorFn`; and throw on `null`/`undefined`/Symbol/Uint8Array/Set/function (`:33`). `multipleOf()` fails decimal steps (`multiple-of.ts:8` — `multipleOf(0.1)` on `0.3` rejected where JSON Schema semantics accept), rejects `multipleOf(0)` on `0`, and rejects bigint. `length()` counts UTF-16 code units while its message says "characters" and rejects arrays min/max/range accept. bigint support is inconsistent: min/max/range accept it but `integer()`, `positive()`, `finite()`, `safeInteger()`, `multipleOf()` reject `5n`. Factory args are unvalidated: `bytes(NaN)`, `words(-1)`, `graphemes(-1)`, `min(NaN)`, `range(5,1)` build validators that pass/fail unconditionally. `date.min()`/`date.max()` eagerly call `d.toISOString()` at FACTORY time (`date-constraint.ts:21,31`) so an invalid Date throws even with a custom error supplied; `date.valid()` throws `TypeError` on a `Proxy<Date>`. `bytes()` miscounts lone surrogates (`bytes.ts:9` — TextEncoder substitutes U+FFFD).

## Changes

The whole numeric/constraint family adopts two conventions — factory misuse throws at factory time; runtime values NEVER throw, they push errors — plus coherent NaN/bigint semantics.

## Design

Settled conventions (apply uniformly; each is a decision, not a suggestion):

1. **Factory-arg validation.** Invalid factory arguments throw `new Error('Validators: …')` AT FACTORY time: NaN/non-finite numeric bounds (unless bigint), negative or NaN counts (`bytes`, `graphemes`, `length`), inverted `range(lo, hi)` with `lo > hi`, `multipleOf(0)` or NaN step. Misuse is programmer error — fail loud, fail early.
2. **Runtime values never throw.** Every validator guards input class FIRST and pushes a type error for unsupported classes (`null`, `undefined`, Symbol, function, and any object outside its supported set) — nothing escapes `ValidatorFn`.
3. **NaN fails.** `min`/`max`/`range` (and the sign/integer family) push an error on NaN — never silently pass.
4. **bigint everywhere in the numeric family.** `min`/`max`/`range` compare bigint values against number bounds DIRECTLY (`5n < 5.5` is well-defined JS — delete the `BigInt(bound)` conversion and its RangeError). `integer(5n)`, `finite(5n)` → true; `positive`/`negative`/`nonNegative`/`nonPositive` sign-check bigints; `safeInteger(v: bigint)` → true iff `v >= -(2n**53n - 1n) && v <= 2n**53n - 1n`; `multipleOf` uses `%` for bigint pairs.
5. **`multipleOf` decimal-safe.** Scale both operands by `10^max(decimals)` before the remainder (zod's floatSafeRemainder approach); `multipleOf` accepts `0.3 % 0.1` as a multiple.
6. **`length()` counts code units, says so, and takes arrays.** Keep UTF-16 code-unit counting (JS/zod convention) — fix the MESSAGE to say "code units"; accept arrays (`value.length`) for parity with min/max/range; grapheme counting remains `graphemes()`'s job.
7. **date-constraint lazily renders.** `toISOString()` moves into the error-message path (invalid bound Date: factory throw per convention 1); `date.valid()` never throws on exotic receivers — duck-check via `value instanceof Date || (typeof value === 'object' && value !== null && typeof (value as Date).getTime === 'function')` then `Number.isNaN(getTime())`, pushing an error instead of throwing on `Proxy<Date>`.
8. **`bytes()` treats lone surrogates as invalid input** (push error) rather than miscounting the U+FFFD substitution — a string that cannot UTF-8-encode has no byte length.

Discretion point: the supported input-class set for min/max/range (today: number, bigint, string, array — via magnitude or length); criterion — preserve every currently-passing verified behavior, document the set in each error message, and never widen silently.

Test plan across the three moved suites (spec vectors, not implementation echoes): NaN fails min/max/range; `min(5.5)` vs `6n` compares without throwing; `range(5,1)`/`min(NaN)`/`bytes(NaN)`/`graphemes(-1)` throw at factory; validators receive `null`/Symbol/function and push errors without throwing; `multipleOf(0.1)` accepts `0.3`; `multipleOf(2n)` accepts `4n`; `5n` passes integer/positive/finite/safeInteger; `2n**60n` fails safeInteger; `length(2)` accepts `"😀"` (2 code units) with the corrected message, accepts `['a','b']`; `date.min(new Date('bad'))` throws at factory; `date.valid()` on a Proxy-wrapped Date pushes/passes without TypeError; lone-surrogate string fails bytes.

## Reads

- src/types.ts — ValidatorFn contract (push, never throw) the conventions codify
- src/validators/words.ts — carries the same factory-guard convention (applied by format-validators-correctness; keep messages consistent)

## Acceptance

- Every measured repro in the Rationale flips; conventions 1–8 hold across all fifteen owned validator files.
- 0 regressions in test/validators/number-date.test.ts, test/validators/constraints.test.ts, test/validators/advanced.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/validators/number-date.test.ts test/validators/constraints.test.ts test/validators/advanced.test.ts
- npx tsc --noEmit

## Notes

The compiler-side reason `null` ever reaches these validators (validator.ts:559 nullable gate) is output-construction-safety's scope; convention 2 here is defense in depth, not the fix for that finding.
