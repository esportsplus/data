---
type: fix
recommended-model: opus
status: PENDING
priority: P1
depends-on: [validator-recursive-types]
files-own: [src/compiler/validator.ts, test/compiler/validator.test.ts]
tests: [test/compiler/validator.test.ts]
---

# Map, Set and Record validation build fresh, own-key containers

## Rationale

generateMapValidation and generateSetValidation validate each element into locals declared once outside the loop and then assign the ORIGINAL container to target (src/compiler/validator.ts:315, :525), so coercion inside a Map or Set never reaches the output and the returned container aliases the caller's input — the single place the fresh-output guarantee breaks. generateRecordValidation separately iterates with for-in and no own-property guard (:465), copying inherited enumerable properties into the fresh record. Array, record and object validation all build fresh containers correctly and are the pattern to follow.

## Changes

`generateMapValidation` and `generateSetValidation` build a fresh `new Map()` / `new Set()`, declare their per-element locals inside the loop, and populate the fresh container from the VALIDATED locals instead of assigning the caller's input — so coercion reaches the output and the result no longer aliases input storage. `generateRecordValidation` iterates `Object.keys` instead of `for…in`, dropping inherited enumerable properties while keeping its existing own-`__proto__` defineProperty route. All three now match the fresh-container pattern already used by array, record and object validation in `src/compiler/validator.ts`.

## Design

Settled decisions. Two generated container validators build the wrong output; both are single-line-of-reasoning defects with the correct pattern already present elsewhere in the same file.

- **Map and Set discard everything they validate.** `generateMapValidation` declares `keyOut`/`valueOut` ONCE outside the loop (`src/compiler/validator.ts:290-291`), validates each pair into them, and then assigns `${target} = ${source}` (`:315`). `generateSetValidation` does the same with `valueOut` (`:507`, `:525`). The validated values are never read — only the last iteration's would even survive the shared locals. Two consequences: coercion inside a Map or Set never reaches the output (a `Map<string, number>` carrying `'30'` stays `'30'`), and the returned container IS the caller's input object, which is the single place this package's fresh-output guarantee breaks. `generateArrayValidation` (`:123`, `:140`), `generateRecordValidation` (`:461`, `:482`) and `generateObjectValidation` (`:417`, `:421`) all build a fresh container correctly and are the pattern to follow.
- **Fix:** build a fresh `new Map()` / `new Set()`, declare the per-element locals INSIDE the loop, and populate the fresh container from the validated locals — `fresh.set(keyOut, valueOut)` and `fresh.add(valueOut)` — assigning that container to `target`. Key validation must feed `keyOut` and be used, not computed and dropped.
- **Record validation walks the prototype chain.** `generateRecordValidation` emits `for (let ${key} in ${source})` (`:465`) with no own-property guard, so inherited enumerable properties are copied into the fresh record. Emit `Object.keys(${source})` and iterate that, or keep `for…in` with an `Object.hasOwn(${source}, ${key})` continue-guard. `Object.keys` is preferred: it is own-and-enumerable by definition and removes the guard from the hot loop entirely.
- **The `__proto__` handling in the record loop stays.** `:470-475` already routes a `__proto__` key through `defineProperty`; own-key iteration does not make that dead, because `JSON.parse` produces a genuine own `__proto__` property that `Object.keys` reports.
- **Do NOT touch the validator's `map`/`set` TYPE support.** `TYPE_VALIDATORS` (`src/compiler/validator.ts:53`, `:58`) validates user data typed as `Map`/`Set` and is entirely independent of the SBC codec's tag-15/16 value types that `remove-map-set-tags` deletes. These two must not be conflated; this item REPAIRS the validator's Map/Set path while that item REMOVES the codec's.

Test plan (`test/compiler/validator.test.ts`):

1. A `Map<string, number>` field fed `new Map([['a', '30']])` returns a Map whose `'a'` value is the NUMBER 30 — the coercion repro, failing before the fix.
2. The returned Map is NOT the input Map (identity assertion), and mutating the returned one leaves the input untouched.
3. A `Set<number>` fed `new Set(['1', '2'])` returns a fresh Set of numbers, with the same identity assertion.
4. An invalid Map value still reports an error with the key in the path, proving key/value validation survives the rebuild.
5. A `Record<string, number>` validated while `Object.prototype` carries an enumerable test property returns a record WITHOUT that key — the prototype-chain repro; the property is removed in an `afterEach` so the suite cannot leak it.
6. A record built from `JSON.parse('{"__proto__": {"a": 1}}')` still places the own `__proto__` key via defineProperty and does not mutate the output's prototype.

## Reads

- src/compiler/types.ts — GeneratorContext / PathMode, unchanged but threaded through the rebuilt loops
- src/compiler/error.ts — ERRORS_VARIABLE and the error emitter the element loops gate on

## Acceptance

- A `Map<string, number>` fed `new Map([['a', '30']])` returns a Map whose `'a'` value is the NUMBER 30, and the returned Map is NOT the input Map; a `Set<number>` fed `new Set(['1','2'])` behaves equivalently.
- An invalid Map value still reports an error carrying the key in its path, proving key and value validation survive the rebuild.
- A `Record<string, number>` validated while `Object.prototype` carries an enumerable test property returns a record WITHOUT that key, with the property removed in an `afterEach` so the suite cannot leak it.
- A record built from `JSON.parse('{"__proto__": {"a": 1}}')` still places the own `__proto__` key via defineProperty and leaves the output's prototype unchanged.
- 0 regressions in test/compiler/validator.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/validator.test.ts
- npx tsc --noEmit
