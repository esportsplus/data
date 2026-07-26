---
type: fix
recommended-model: opus
status: PENDING
priority: P1
depends-on: [encode-growth-signal]
files-own: [src/sbc/index.ts, test/sbc/index.test.ts]
tests: [test/sbc/index.test.ts]
---

# Count own keys only, matching the rest of the encode pipeline

## Rationale

matchSchema (src/sbc/index.ts:190-192) and revalidateCached (:344-347) count keys with for-in, which enumerates own AND inherited enumerable keys, while every other stage measures own keys only — src/sbc/index.ts:224 and src/sbc/schema.ts:171 both use Object.keys. A schema's fields.length therefore always reflects own keys while the two guards comparing against it may not. When an encoded object inherits enumerable keys, keyCount inflates, the 16-slot ring cache never matches and revalidateCached always returns false, so both of the encoder's hot caches miss on every call and fall through to full inference — silently, with throughput collapse as the only signal.

## Changes

`matchSchema` and `revalidateCached` in `src/sbc/index.ts` gain an `Object.hasOwn` guard inside their existing `for…in` counting loops, so key counts measure own keys only and agree with the `Object.keys` used by `src/sbc/schema.ts`'s inference. The allocation-free loop is deliberately KEPT — switching to `Object.keys(obj).length` would allocate an array on the encoder's hottest path — so the ring cache and the WeakMap cache stop missing on every call when an encoded object inherits enumerable keys.

## Design

Settled decisions. Root cause: one concept — "how many keys does this object have" — is measured two different ways inside a single encode pipeline.

- **The split.** `matchSchema` (`src/sbc/index.ts:190-192`) and `revalidateCached` (`:344-347`) count with `for (let _ in obj) { keyCount++; }`, which enumerates own AND INHERITED enumerable string keys. Every other stage measures own keys only: `src/sbc/index.ts:224` sorts `Object.keys(obj)`, and `inferAndRegister` derives its field list from `Object.keys(obj).sort()` (`src/sbc/schema.ts:171`). A schema's `fields.length` therefore always reflects own keys while the two guards comparing against it may not.
- **Blast radius, stated honestly.** A plain object literal is UNAFFECTED — `Object.prototype`'s members are non-enumerable, so both methods agree. The split bites only when the encoded object inherits enumerable keys: a value built with `Object.create(protoCarryingEnumerables)`, or any object in a process where `Object.prototype` has been polluted. This is a latent cliff, not an everyday failure, and it is P1 for that reason. The defect being fixed is the inconsistency itself; the failure mode is its symptom.
- **The symptom when it does bite.** `keyCount` inflates above `cacheCounts[i]`, so the 16-slot ring cache check at `:197` never matches, and `revalidateCached`'s `keyCount !== n` at `:348` always returns false, which discards the WeakMap hit at `:102`. Both of the encoder's hot caches then miss on EVERY call and fall through to full schema inference — silently, with no error and no observable signal other than throughput collapse.
- **Fix — add the own-property guard, do NOT switch to `Object.keys().length`.** Emit `for (let k in obj) { if (Object.hasOwn(obj, k)) { keyCount++; } }` at both sites. `Object.keys(obj).length` would also be correct but allocates an array on the hottest path in the encoder, which is precisely why the allocation-free `for…in` was written in the first place; replacing it with an allocating call would trade one defect for a regression. The guard keeps the loop allocation-free.
- **`encodable-type-constraint` narrows exposure but does not close this.** That item rejects class instances at the type level, removing one source of inherited enumerables, but `Object.create` with a data-carrying prototype and global prototype pollution both remain. The two items are complementary and neither substitutes for the other.

Test plan (`test/sbc/index.test.ts`):

1. The repro: with an enumerable property installed on `Object.prototype`, encoding the same plain object twice produces the same schema hash AND the second encode takes the ring-cache path — asserted by instrumenting the store or by asserting the registry did not grow. The property is removed in an `afterEach` so the suite cannot leak it.
2. An object built via `Object.create({ inherited: 1 })` carrying its own fields encodes to a schema whose field list contains ONLY the own fields, and round-trips without the inherited key.
3. `revalidateCached` still correctly INVALIDATES when an own key is genuinely added or removed between encodes — proving the guard did not turn the check into a no-op.
4. A plain object literal round-trips byte-identically to baseline, confirming the common path is untouched.
5. Repeated encodes of the same shape hit the WeakMap path — asserted by a counter on schema inference — so the fix is verified to restore caching rather than merely to stop miscounting.

## Reads

- src/sbc/schema.ts — inferAndRegister's `Object.keys(obj).sort()` at :171, the own-keys measurement this item aligns to
- src/sbc/codegen.ts — the Schema.fields shape whose length the two guards compare against

## Acceptance

- With an enumerable property installed on `Object.prototype` (removed in `afterEach`), encoding the same plain object twice yields the same schema hash AND takes the ring-cache path on the second encode — asserted by the registry not growing.
- An object built via `Object.create({ inherited: 1 })` encodes a schema whose field list contains ONLY its own fields and round-trips without the inherited key.
- `revalidateCached` still invalidates when an own key is genuinely added or removed between encodes — the guard did not turn the check into a no-op.
- A plain object literal round-trips BYTE-IDENTICALLY to baseline, and repeated encodes of one shape hit the WeakMap path, asserted by an inference counter.
- 0 regressions in test/sbc/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/index.test.ts
- npx tsc --noEmit
