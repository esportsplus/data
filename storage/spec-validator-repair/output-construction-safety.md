---
type: fix
recommended-model: opus
status: PENDING
priority: P1
source: findings C5, C6, C7, C15, C16 + the validator.ts:559 nullable gate (audit sections C, E)
depends-on: relocate-tests-and-benches
files-own: [src/compiler/validator.ts, test/compiler/validator.test.ts]
tests: [test/compiler/validator.test.ts]
---

# Emitted validators build output instead of mutating input

## Rationale

C5 (P1): `src/compiler/validator.ts:228` (`!isFinite(${varname} = +${varname})`) and `:45-68` assign coerced values back into the CALLER's object unconditionally — strict-mode ESM throws `TypeError` on frozen objects, getter-only properties, and `writable:false` fields; sloppy mode silently leaves a STRING in a `number`-typed field (`{"ok":true,"data":{"n":"42"}}`) and observable mutation (`o.n` becomes `42`-number or `NaN`). C6 (P1): union branch speculation (`:471-547`) rolls back only `_errors.length` (`:535`) — a failed branch's coercion writes survive, inventing `a: NaN` keys on the caller's object that leak into `data`. C7 (P1): no root guard (`:609-621`) — `validate(null)` throws despite `ValidatorFn<T>` being typed `(input: unknown)` (`src/types.ts:72`). C15 (P1): `+x` + `isFinite` coercion accepts `''`→0, `[]`→0, `true`→1, `'0x10'`→16 while README:704 documents only string→number. C16 (P2): an UNQUOTED `__proto__:` key passes `VALID_IDENTIFIER` (`:298-317`) and sets the PROTOTYPE of returned `data`, contradicting README:705. E-P1: nullable non-union props reach builtin validators with `null` because `:559` gates null only inside the union path — `min()` then throws.

## Changes

The generated validator's core data-flow contract: input is READ-ONLY; `data` is constructed fresh; coercion is strict; null roots and nullable properties short-circuit safely.

## Design

Settled decisions:

- **Fresh-output construction (the core decision, fixes C5+C6).** The emitted validator never writes to `varname`/`_input`. Each validated property writes its (possibly coerced) value into the output container being built; nested objects/arrays/tuples/records allocate fresh containers. Union branch speculation validates into a THROWAWAY container per branch; rollback = discard (no writes ever reach the caller's object, so `_errors.length` restore suffices for errors and nothing else needs undoing). Extra-property stripping falls out for free (only validated keys are copied — current behavior preserved).
- **Root guard (C7).** For object-rooted types: `input === null || typeof input !== 'object' || Array.isArray(input)` → push one root error, return `{ok:false, errors}` — never throw. Non-object roots get the analogous typeof guard (analyzer-structural-types owns WHICH root kinds exist; this item owns the no-throw contract).
- **Strict number coercion (C15).** Coercion accepts `typeof v === 'number'` (finite gate unchanged) or a STRING matching a module-level regex constant `^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$` (decimal/scientific only — no hex, no empty string, no whitespace-only). Booleans, arrays, objects, `''` are type errors. Boolean coercion keeps its documented `'true'/'1'/'0'`-style table but writes to output only. README:704 already documents strings-only; readme-accuracy re-states the final table.
- **`__proto__` safety (C16).** Keys equal to `__proto__` are written via `Object.defineProperty(target, '__proto__', {configurable: true, enumerable: true, value, writable: true})` — an object-literal or bracket-assignment spelling would hit the prototype setter. All other keys use plain assignment/literal emission (with emitted-code-escaping's `emitString`).
- **Nullable gate (E carry-over).** A nullable (or optional-with-undefined) NON-union property short-circuits BEFORE type checks and config/brand validator invocations when the value is `null` (respectively absent/`undefined`), generalizing the union path's `:559` handling to property level — builtin validators never receive `null` for a `T | null` property.
- Discretion point: whether output containers pre-size via property count; criterion — no measurable regression on `bench/compiler/validator.bench.ts` shapes (do not run the bench as a gate; just avoid per-property closures/allocations beyond the container itself).

Test plan (new `test/compiler/validator.test.ts` — the mirror suite src/compiler/validator.ts never had): frozen input validates without throwing; deep-equal snapshot of input before/after proves zero mutation (including the C5 `'42'` and `'abc'` cases); `'42'` coerces in `data` while input keeps the string; `''`/`true`/`[]`/`'0x10'` rejected for number fields; the C6 repro (`{v:{b:'x',kind:'b'}}`) leaves caller keys exactly `b,kind` and `data.v` without `a`; `validate(null)`/`validate(undefined)`/`validate(42)` return `ok:false`; `__proto__` key lands as an OWN key (`Object.keys` includes it, `Object.getPrototypeOf(data) === Object.prototype`); nullable non-union prop accepts `null` without invoking a configured `min`.

## Reads

- src/compiler/error.ts — emitString helper and error-shape plumbing the new emission uses
- bench/compiler/validator.bench.ts — the relocated validator benchmark whose shapes the container-allocation criterion references (citation only; created by relocate-tests-and-benches, never edited here)
- src/types.ts — ValidatorFn/ValidatorResult contracts (input: unknown; ok/data/errors shape)
- test/utils.ts — transform harness

## Acceptance

- All execution-proven C5/C6/C7/C15/C16 repros flip to correct behavior as listed in the test plan.
- 0 regressions in test/compiler/validator.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/validator.test.ts
- npx tsc --noEmit

## Notes

Coercion divergence flag (must be surfaced, per evidence J): even after tightening, this package coerces `'30'`→30 while zod 4.4.3 coerces NOTHING by default — the ai-orchestrator follow-up spec must decide whether plan-node inputs may rely on coercion. Out of scope here; recorded in the index's Out of Scope section.
