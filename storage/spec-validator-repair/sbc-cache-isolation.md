---
type: fix
recommended-model: opus
status: BLOCKED
blocked-reason: blocked pending user review of the SBC audit findings (Q3/Q4)
priority: P2
source: findings D7, D8 (audit section D)
depends-on: [relocate-tests-and-benches, sbc-schema-preregistration]
files-own: [src/sbc/cache.ts, src/sbc/schema.ts, test/sbc/schema-store.test.ts]
files-shared: [src/sbc/index.ts]
tests: [test/sbc/schema-store.test.ts]
---

# Per-codec schema cache; store tests that actually exercise the store

## Rationale

D8 (P2): `src/sbc/cache.ts:24-28` holds `map`/`head`/`tail` at MODULE scope — a fresh `codec()` with no store decodes any buffer any other codec in the process encoded, defeating codec isolation. D7 (P2, test honesty): that global cache is exactly what makes the store tests vacuous — `tests/sbc-schema-store.ts:174` ("resolves schema lazily from shared store") measured `store.get()` invocations = 0; `:117` passes with a store whose `get()` always returns `null`. These tests currently prove nothing about the PersistentStore feature.

## Changes

The LRU schema cache becomes per-codec-instance state; the schema-store suite is rewritten to assert isolation and real store traffic.

## Design

Settled decisions:

- **Instance-scoped cache.** `src/sbc/cache.ts` exports a factory (closure or class per repo style — internal `function` declarations, exported const at bottom) producing an independent LRU (same capacity/eviction semantics as today); `codec()` instantiates one per codec, threaded through `src/sbc/schema.ts`'s consumers via parameter, never via module state (repo standard: no static state). The shared `PersistentStore` remains the ONLY sanctioned cross-codec channel.
- **Resolution order per decode:** instance cache → codec-local registry → `store.get()` → `Codec2:` unknown-schema error. A store hit populates the instance cache.
- Discretion point: whether `src/sbc/types.ts`'s cache typing needs a signature touch; criterion — no public API change to `codec()`/`CodecOptions`.

Test plan (rewrite `test/sbc/schema-store.test.ts`): a fresh storeless codec CANNOT decode a buffer another codec encoded (asserts the isolation the old suite silently lacked); a store-backed codec decodes it AND an instrumented store wrapper counts `get()` >= 1 (the measured-zero repro flips); a null-returning store now FAILS decode with the named error (the `:117` vacuous case becomes a real negative test); LRU eviction still bounded per instance.

## Reads

- src/sbc/types.ts — PersistentStore contract the instrumented wrapper implements

## Acceptance

- Cross-codec decode without a store fails; with a store it succeeds via measured `store.get()` traffic; module-global cache state is gone (two codecs in one process are provably independent).
- 0 regressions in test/sbc/schema-store.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/schema-store.test.ts
- npx tsc --noEmit

## Notes

src/sbc/index.ts carries only the mechanical construction-site hook (instantiate the cache in codec() and pass it down) — declared files-shared per the hub grammar; all substantive cache logic stays in files-own. The decode-interleave suite's `lastDecodeFn` invariant (verified at baseline) must stay green — it lives at test/sbc/decode-interleave.test.ts and runs at merge boundaries.
