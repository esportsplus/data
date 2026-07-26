---
type: fix
recommended-model: opus
status: PENDING
priority: P1
depends-on: [validator-container-fidelity]
files-own: [src/compiler/validator.ts, test/compiler/validator.test.ts]
tests: [test/compiler/validator.test.ts]
---

# Read a __proto__ property through an own-property probe

## Rationale

outputAccess excludes PROTO_KEY from dot access so writes route through defineProperty (src/compiler/validator.ts:791-797), but its twin propertyAccess has no such exclusion (:799-805) and emits input.__proto__ for reads. Verified by execution: every plain object satisfies obj.__proto__ !== undefined, and bracket access behaves identically, so an optional __proto__ property is always considered present and a defaulted one never applies its default. JSON.parse does create a genuine own __proto__ property, so the read must distinguish own from inherited rather than reject the name.

## Changes

`propertyAccess` gains the `PROTO_KEY` special case its twin `outputAccess` already has: a `__proto__` property is read through a hoisted local seeded from `Object.hasOwn(input, '__proto__') ? input['__proto__'] : undefined`, and that local feeds the presence test, the default test and the validation source. Every other property name keeps its current dot/bracket spelling with zero generated-code change. `src/compiler/validator.ts` therefore stops treating every plain object as carrying a `__proto__` property and stops skipping that property's default.

## Design

Settled decisions. Root cause: the write side of the `__proto__` hardening was completed and the read side was not, leaving two near-identical helpers that disagree.

- **The defect.** `outputAccess` (`src/compiler/validator.ts:791-797`) explicitly excludes `PROTO_KEY` from the dot-access path, so writes go through `emitWrite`'s `defineProperty`. Its twin `propertyAccess` (`:799-805`) has NO such exclusion: `VALID_IDENTIFIER.test('__proto__')` is true and `__proto__` is absent from `RESERVED_WORDS`, so a `__proto__` property READ emits `_input.__proto__`.
- **Verified by execution, not inference.** `({a:1}).__proto__ !== undefined` is `true` for every plain object, and `({a:1})['__proto__'] === Object.prototype` is also `true` — bracket access behaves IDENTICALLY. Switching the accessor spelling therefore fixes nothing; this is the trap to avoid. Separately, `JSON.parse('{"__proto__":{"x":1}}')` DOES create a genuine own data property, and dot access returns that own value, so the read must distinguish the two cases rather than reject `__proto__` outright.
- **Consequences today.** For a schema declaring `__proto__?: T`, the presence test `if (${source} !== undefined)` (`:920`) is true for EVERY input, so the validator runs `T`'s check against `Object.prototype`. For a defaulted `__proto__` property the test `if (${source} === undefined)` (`:908`) is never true, so the default NEVER applies. Both are silent.
- **Decision — read `__proto__` through an own-property probe.** Emit, for the `PROTO_KEY` name only, a hoisted local seeded from `Object.hasOwn(${varname}, '__proto__') ? ${varname}['__proto__'] : undefined`, and use that local everywhere `propertyAccess` would have produced the expression — the presence tests, the default test, and the validation source. Every other property name keeps its current dot/bracket spelling with zero generated-code change.
- **Symmetry is the acceptance signal.** After this item `propertyAccess` and `outputAccess` both special-case `PROTO_KEY`; a reviewer diffing the two helpers should see the same exclusion in both. Leaving them asymmetric is what produced this bug.

Test plan (`test/compiler/validator.test.ts`):

1. A schema with `__proto__?: { x: number }` fed `{a: 1}` (no own `__proto__`) reports the property ABSENT — no error, no key in the output. Fails before the fix, which validates `Object.prototype` against the shape.
2. The same schema fed `JSON.parse('{"__proto__":{"x":1}}')` validates the own value and places `x: 1` under an own `__proto__` key in the output.
3. A schema with a DEFAULTED `__proto__` property fed `{a: 1}` applies the default — the `:908` repro, which never fires today.
4. The output's prototype is unchanged in every case above (`Object.getPrototypeOf(result.data) === Object.prototype`), proving the read fix did not regress the write hardening.
5. A property named `constructor` and one named `toString` behave the same way — own-property presence only — confirming the probe generalises rather than special-casing one name.

## Reads

- src/compiler/error.ts — emitString, used by both access helpers to spell a bracket key
- src/compiler/types.ts — GeneratorContext, unchanged but threaded through the probe emission

## Acceptance

- A schema with `__proto__?: { x: number }` fed `{a: 1}` reports the property ABSENT — no error, no key in the output; fed `JSON.parse('{"__proto__":{"x":1}}')` it validates the own value and places it under an own `__proto__` key.
- A schema with a DEFAULTED `__proto__` property fed `{a: 1}` applies the default, which never fires today.
- `Object.getPrototypeOf(result.data) === Object.prototype` in every case, proving the read fix did not regress the existing write hardening.
- Properties named `constructor` and `toString` behave the same way — own-property presence only — confirming the probe generalises.
- `propertyAccess` and `outputAccess` both special-case PROTO_KEY, asserted by a source-level check so the asymmetry cannot return.
- 0 regressions in test/compiler/validator.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/validator.test.ts
- npx tsc --noEmit
