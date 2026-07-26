---
type: fix
recommended-model: opus
status: BLOCKED
priority: P2
source: findings D7, D8 (audit section D)
depends-on: [relocate-tests-and-benches, sbc-schema-preregistration]
files-own: [src/sbc/cache.ts, src/sbc/schema.ts, test/sbc/cache.test.ts, test/sbc/schema-store.test.ts]
files-shared: [src/sbc/index.ts]
tests: [test/sbc/cache.test.ts, test/sbc/schema-store.test.ts]
blocked-reason: test evidence destroyed — sbc-cache-isolation net-removes test cases from its declared test(s) [test/sbc/schema-store.test.ts]; a fixer must re-scope the bound or BLOCK, never discharge by deletion; salvage ref salvage/5776b305-u1 @ b080c13005ca81adf40c4a9ec7cf7669978fe189 — the unit branch tip survives as this tag; cherry-pick the item's [sbc-cache-isolation] commits to recover
---

# Per-codec schema cache; store tests that actually exercise the store

## Rationale

D8 (P2): `src/sbc/cache.ts:24-28` holds `map`/`head`/`tail` at MODULE scope — a fresh `codec()` with no store decodes any buffer any other codec in the process encoded, defeating codec isolation. D7 (P2, test honesty): that global cache is exactly what makes the store tests vacuous — `tests/sbc-schema-store.ts:174` ("resolves schema lazily from shared store") measured `store.get()` invocations = 0; `:117` passes with a store whose `get()` always returns `null`. These tests currently prove nothing about the PersistentStore feature.

## Changes

The shared schema cache STAYS shared: its key is content-derived, so a cross-codec hit is the same schema the codec would have built, and mandating a `store.get()` round trip would be a straight regression. `src/sbc/cache.ts` instead gains a `clear()` on its default export (internal to `src/sbc/`, no public API change) and stops overwriting an existing entry's schema; `test/sbc/cache.test.ts` is added as its mirror, and `test/sbc/schema-store.test.ts` is rewritten to run cold so it measures real store traffic.

## Design

Settled decisions. These SUPERSEDE D8's per-codec-isolation premise recorded in Rationale — see Notes for the supersession record; D7 (vacuous store tests) survives intact and is the substance of this item.

- **Shared cache retained — do NOT make it per-instance.** `computeShapeHash` (`src/sbc/schema.ts:11-36`) is FNV-1a over the ordered `(name, rawType)` pairs, so hash H determines the shape: an entry seeded by another codec IS the schema this codec would otherwise rebuild. `resolveSchemaFromCacheOrStore` (`src/sbc/index.ts:78-96`) keeps its exact order — cache → `store.get()` → `defineSchema` → null — and no decode path gains a round trip. No consumer changes its `import cache from './cache'`.
- **`clear()` joins the default export.** `src/sbc/cache.ts` gains one internal `function` resetting `hand`/`head`/`map`/`tail` to their initial values, exported as `export default { clear, get, set }` (alphabetical). It is NOT re-exported from `src/sbc/index.ts` or `src/index.ts`, so the published surface is byte-identical. It exists because a cold cache is unconstructible today, which is precisely why the store tests are vacuous: the module singleton satisfies every lookup before `store.get()` is ever reached.
- **Collision overwrite closed.** `set` currently replaces `entry.schema` on an existing hash (`src/sbc/cache.ts:83-91`) while the registry throws on a colliding shape (`src/sbc/schema.ts:198`). Make it first-writer-wins: on an existing entry, set `visited = true` and return without touching `entry.schema`. The registry stays the sole collision arbiter and keeps failing loud rather than serving a foreign shape.
- **OUT OF SCOPE — a `CodecOptions.cache` knob.** Two codecs holding DIFFERENT `PersistentStore`s still share shape definitions through the singleton; per-tenant isolation would need an injectable cache on `codec()`. That is a public-API add (Ask First) and is recorded as a follow-up, never improvised under this slug.

Test plan — `test/sbc/cache.test.ts` (new mirror for `src/sbc/cache.ts`):

1. `clear()` empties the cache: a `set` hash is retrievable, `clear()`, the same `get` returns `null`.
2. `set` on an existing hash leaves the FIRST-written schema in place (the collision guard) while still refreshing `visited`.
3. SIEVE eviction stays bounded at capacity across `maxSize + 1` distinct hashes, and a `visited` entry survives one eviction pass.

Test plan — rewrite `test/sbc/schema-store.test.ts`. Every case calls `cache.clear()` and constructs a FRESH `codec()` (its registry is closure-local, so the pair is genuinely cold) so no warm entry can satisfy the lookup:

4. A store-backed codec decodes a buffer another codec encoded AND an instrumented `PersistentStore` wrapper counts `get()` >= 1 — this flips the measured-zero repro the old `:174` case recorded.
5. A store whose `get()` returns `null` FAILS decode with `Codec2: unknown schema hash <hash>` (`src/sbc/tagged.ts:116`, `:144`) — the old `:117` vacuous pass becomes a real negative.
6. A store hit populates the cache: a second decode of the same hash adds NO further `get()` call (proves the memo, and that the resolution order was not inverted).

## Reads

- src/sbc/types.ts — PersistentStore contract the instrumented wrapper implements
- src/sbc/tagged.ts — the `Codec2: unknown schema hash` throw sites (:116, :144), the named error the negative test asserts
- src/index.ts — the package root export list, verified unchanged (clear() must not surface publicly)
- test/sbc/decode-interleave.test.ts — the lastDecodeFn invariant that must stay green

## Acceptance

- Cold cache + null-returning store FAILS decode with `Codec2: unknown schema hash <hash>`; cold cache + populated store SUCCEEDS with measured `store.get()` >= 1 (the suite's measured-zero becomes non-zero); a repeat decode of the same hash adds no further `get()`.
- `cache.set` on an existing hash leaves the first-written schema in place; `cache.clear()` empties it; SIEVE eviction stays bounded at capacity.
- No public API change: `src/index.ts` and `src/sbc/index.ts` export the same names as before, and `resolveSchemaFromCacheOrStore`'s order is unchanged (no decode gains a store round trip).
- 0 regressions in test/sbc/cache.test.ts, test/sbc/schema-store.test.ts and test/sbc/decode-interleave.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/cache.test.ts test/sbc/schema-store.test.ts test/sbc/decode-interleave.test.ts
- npx tsc --noEmit

## Notes

src/sbc/index.ts carries only the mechanical construction-site hook (instantiate the cache in codec() and pass it down) — declared files-shared per the hub grammar; all substantive cache logic stays in files-own. The decode-interleave suite's `lastDecodeFn` invariant (verified at baseline) must stay green — it lives at test/sbc/decode-interleave.test.ts and runs at merge boundaries.
2026-07-25 — SUPERSESSION (user review of Q3/Q4). D8's premise is REJECTED: the module-scope cache is not a leak, it is a correct content-addressed memo, because `computeShapeHash` makes hash H determine the shape. Per-codec isolation would force N codecs to re-fetch and re-`defineSchema` the identical shape and would split one 1024-entry budget N ways — a regression bought for design purity. The Rationale and title above are frozen by the mutator contract and read as authored; the Design section is authoritative where they disagree, and the surviving work is D7 (vacuous store tests) plus the unguarded `set` overwrite. Follow-up recorded, not built: an injectable `CodecOptions.cache` for codecs holding different PersistentStores.
DEFERRED 2026-07-26T08:28:15.391Z run=f177cf28 class=dependency reason="dependency validator-boolean-coercion did not land — reverted" salvage=none
FABLE_REPLAN ledger: []
