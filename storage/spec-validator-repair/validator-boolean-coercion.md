---
type: fix
recommended-model: sonnet
status: PENDING
priority: P2
depends-on: [validator-proto-property-reads]
files-own: [src/compiler/validator.ts, test/compiler/primitives.test.ts]
tests: [test/compiler/primitives.test.ts]
---

# Narrow boolean coercion to the documented forms

## Rationale

generateNumberValidation restricts coercion to numbers and decimal/scientific strings behind the NUMBER_STRING regex, with an in-source rationale that booleans, arrays and objects are type errors rather than coercions (src/compiler/validator.ts:36, :359). generateBooleanValidation handles the intended forms and then falls through to String(source).toLowerCase() at :188, which accepts any value whose string form is true/false/1/0 — so an array coerces to a boolean, which is precisely what the number path forbids. The two coercion policies in one file disagree.

## Changes

`generateBooleanValidation` loses its `String(source).toLowerCase()` fallback and its `str` local, so the accepted set narrows to exactly `boolean`, the strings `'true'`/`'false'`/`'1'`/`'0'`, and the numbers `1`/`0` — bringing `src/compiler/validator.ts`'s boolean policy in line with the number policy that already refuses arrays and objects. Behavior break: values that previously coerced through their string form, including `'TRUE'`, now produce a type error.

## Design

Settled decisions. The number path documents a deliberate coercion policy and the boolean path silently exceeds it.

- **The asymmetry.** `generateNumberValidation` restricts coercion to a number or a decimal/scientific STRING, gated by the `NUMBER_STRING` regex (`src/compiler/validator.ts:36`, applied at `:359`), with an in-source rationale citing README:704 and finding C15: booleans, arrays, objects and `''` are type errors, not coercions. `generateBooleanValidation` handles the intended forms at `:181-186` (`'true'`/`1`/`'1'`/`'false'`/`0`/`'0'`) and then falls through at `:188` to `String(${source}).toLowerCase()`, which accepts ANY value whose string form is `true`/`false`/`1`/`0`. `['true']` coerces to `true`; `{toString: () => 'true'}` coerces to `true`; `new Boolean(false)` coerces to `false`. An array coercing to a boolean is exactly what the number path's rationale forbids for numbers.
- **Decision — delete the `String()` fallback.** The explicit arm at `:181-186` already covers every form the documented policy allows. Remove the `else` branch and its `str` local entirely, replacing it with the error emission, so the accepted set becomes exactly: `boolean`, the strings `'true'`/`'false'`/`'1'`/`'0'`, and the numbers `1`/`0`. This is a deliberate narrowing and it is a BEHAVIOUR BREAK for inputs that previously coerced — acceptable under this spec's no-back-compat directive, and the narrowing direction (reject more) is the safe one.
- **Case-insensitivity is part of what is being dropped.** `'TRUE'` coerces today via `toLowerCase()` and will not after. If case-insensitive string forms are wanted they belong in the EXPLICIT arm as literal comparisons, not behind a `String()` call that also admits arrays and objects. This item does not add them; it is recorded so the change is understood as intentional rather than incidental.
- **Do not touch the number path.** `NUMBER_STRING` and its call site are correct and are the reference this item aligns to; they are reads, not edit targets.
- **Union branches are out of scope.** A `boolean` branch inside a union guards on `typeof === 'boolean'` (`:690-692`) and never reaches this code, so union behaviour is unchanged by construction.

Test plan (`test/compiler/primitives.test.ts`):

1. `['true']`, `{toString: () => 'true'}`, and `new Boolean(true)` each produce `ok: false` with `must be true or false`. Each passes today and must fail after.
2. The documented forms still coerce: `true`, `false`, `'true'`, `'false'`, `'1'`, `'0'`, `1`, `0` — with the boolean-typed result asserted, not just `ok`.
3. `'TRUE'` produces `ok: false`, pinning the intentional loss of case-insensitivity so a future reader does not restore it by accident.
4. A nullable boolean still accepts `null` and yields `null`.
5. A `boolean` branch inside a `string | boolean` union is unaffected — `true` matches the boolean branch and `'true'` matches the string branch, exactly as at baseline.

## Reads

- src/compiler/error.ts — the error emitter the replaced branch calls
- README.md — the documented coercion table, corrected later by readme-accuracy

## Acceptance

- `['true']`, `{toString: () => 'true'}` and `new Boolean(true)` each produce `ok: false` with `must be true or false` — all three pass today.
- The documented forms still coerce with the boolean-typed result asserted, not merely `ok`: `true`, `false`, `'true'`, `'false'`, `'1'`, `'0'`, `1`, `0`.
- `'TRUE'` produces `ok: false`, pinning the intentional loss of case-insensitivity so it is not restored by accident.
- A nullable boolean still accepts `null` and yields `null`; a `boolean` branch inside a `string | boolean` union is unaffected.
- 0 regressions in test/compiler/primitives.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/primitives.test.ts
- npx tsc --noEmit
