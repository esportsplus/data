---
status: draft
date: 2026-04-08
scope: SIEVE-evicted in-memory schema cache for codec2, optional persistent store
---

# Spec: SIEVE Schema Cache + Persistent Store

## Goal

Build a bounded SIEVE cache into the codec as the internal shared schema layer. Consumers optionally provide a `PersistentStore` for durable cross-process/cross-session schema sharing (IndexedDB, LMDB, etc.). The cache is always present — the persistent store never is unless the user provides one.

## Architecture

```
createCodec({ store? })
│
├── Local Registry (per-instance, compiled JIT functions)
│     Hot path — encode/decode use this directly
│
├── SIEVE Cache (shared across instances, in-memory, built-in)
│     src/codec2/cache.ts — always present, bounded, automatic
│     Holds StoredSchema descriptors (data only, no JIT)
│
└── PersistentStore? (optional, user-provided)
      get/set interface — IndexedDB, LMDB, Redis, etc.
      Consulted only on SIEVE cache miss during decode
```

**Data flow on encode (schema registration):**
```
inferAndRegister / defineSchema
  → compile JIT into local registry
  → cache.set(hash, storedSchema)        ← always
  → persistentStore?.set(hash, storedSchema)  ← if provided
```

**Data flow on decode (schema lookup):**
```
decode → local registry.get(hash)
  → hit? → use compiled JIT (hot path, zero overhead)
  → miss? → cache.get(hash)
    → hit? → defineSchema(fields) → compile locally → decode
    → miss? → persistentStore?.get(hash)
      → hit? → cache.set + defineSchema → compile locally → decode
      → miss? → throw "unknown schema hash"
```

## Rationale

- The SIEVE cache is an implementation detail — consumers don't configure or interact with it
- Consumers only care about persistence: "I want schemas to survive process restarts"
- Separating cache from persistence keeps the codec fast (in-memory SIEVE) while letting users plug in any durable backend
- The cache acts as a write-through buffer for persistence — hot schemas never hit the persistent store on read

## Types

### User-Facing (exported)

```typescript
type PersistentStore = {
    get(hash: number): StoredSchema | null;
    set(hash: number, schema: StoredSchema): void;
};

type StoredSchema = {
    fields: FieldSpec[];
    hash: number;
};

type CodecOptions = {
    compress?: boolean;
    store?: PersistentStore;
};
```

- `PersistentStore` — user implements this for their storage backend
- `StoredSchema` — plain serializable object, no functions, no JIT state
- `get` returns `null` on miss, not `undefined`

### Internal (not exported)

```typescript
// src/codec2/cache.ts

type CacheEntry = {
    hash: number;
    next: CacheEntry | null;
    prev: CacheEntry | null;
    schema: StoredSchema;
    visited: boolean;
};
```

## SIEVE Cache — `src/codec2/cache.ts`

### Factory

```typescript
const createSchemaCache = (maxSize?: number): SchemaCache;

type SchemaCache = {
    get(hash: number): StoredSchema | null;
    set(hash: number, schema: StoredSchema): void;
};
```

- `maxSize` defaults to `1024`
- `SchemaCache` is internal — not exported to consumers
- SIEVE state (`hand`, `head`, `tail`, `map`) closed over in the factory

### Algorithm

**`get(hash)`**:
1. `map.get(hash)` — if `undefined`, return `null`
2. `entry.visited = true`
3. Return `entry.schema`

**`set(hash, schema)`**:
1. `map.get(hash)` — if exists, update `entry.schema`, set `entry.visited = true`, return
2. While `map.size >= maxSize`, call `evictOne()`
3. Create `CacheEntry` with `visited = false`
4. Insert at head of linked list
5. `map.set(hash, entry)`

**`evictOne()`**:
1. Start at `hand ?? tail`
2. Scan backward: while `entry.visited`, clear visited, move to `entry.prev ?? tail`
3. Cap scan at 64 iterations (prevent degenerate all-visited loops)
4. Save `hand = entry.prev`
5. Unlink entry from list
6. `map.delete(entry.hash)`

### Linked List Operations

**Insert at head**:
```
entry.next = head
entry.prev = null
if (head) head.prev = entry
head = entry
if (!tail) tail = entry
```

**Unlink entry**:
```
if (entry.prev) entry.prev.next = entry.next
else head = entry.next
if (entry.next) entry.next.prev = entry.prev
else tail = entry.prev
if (hand === entry) hand = entry.prev
entry.prev = entry.next = null
```

### Why SIEVE Over LRU

| Operation | LRU | SIEVE |
|-----------|-----|-------|
| Access (hot path) | Unlink + move to head (6 pointer writes) | Set visited bit (1 write) |
| Eviction | Remove tail (2 pointer writes) | Scan + remove (amortized ~same) |
| Scan resistance | None — single scan evicts hot entries | Visited bit protects hot entries |


## Implementation Steps

### Phase 1 — SIEVE Cache

- [ ] **Step 1**: Create `src/codec2/cache.ts` with `CacheEntry` type, `createSchemaCache` factory
- [ ] **Step 2**: Implement SIEVE state: `hand`, `head`, `tail`, `map`, `maxSize`
- [ ] **Step 3**: Implement `get(hash)` — map lookup + visited bit
- [ ] **Step 4**: Implement `set(hash, schema)` — upsert + eviction loop
- [ ] **Step 5**: Implement `evictOne()` — backward scan, 64-iteration cap
- [ ] **Step 6**: Implement `unlinkEntry()` — doubly-linked list unlink

### Phase 2 — Types & Exports

- [ ] **Step 7**: Add `PersistentStore` and `StoredSchema` types to `src/codec2/index.ts`
- [ ] **Step 8**: Add `store?: PersistentStore` to `CodecOptions`
- [ ] **Step 9**: Export `PersistentStore`, `StoredSchema` types from `src/codec2/index.ts`

### Phase 3 — Codec Integration

- [ ] **Step 10**: In `createCodec`, instantiate the SIEVE cache: `let cache = createSchemaCache()`
- [ ] **Step 11**: On `defineSchema` — after local `registry.schemas.set(hash, schema)`:
  - `cache.set(hash, { fields: sorted, hash })`
  - `store?.set(hash, { fields: sorted, hash })`
- [ ] **Step 12**: On `inferAndRegister` — after local registration, build `StoredSchema` from inferred fields:
  - `cache.set(hash, { fields, hash })`
  - `store?.set(hash, { fields, hash })`
  - Pass `cache` and `store` references into `inferAndRegister`
- [ ] **Step 13**: On decode miss (local registry miss):
  1. `cache.get(hash)` — if non-null, `defineSchema(stored.fields)`, retry
  2. `store?.get(hash)` — if non-null, `cache.set(hash, stored)`, `defineSchema(stored.fields)`, retry
  3. Both miss → throw as before
- [ ] **Step 14**: Apply decode-miss logic to all 4 sites: `decode()` tag-8 fast path, `decode()` tag-18 fast path, `decodeSbc()` tag-8 handler, `decodeSbc()` tag-18 handler

### Phase 4 — Tests

#### Cache unit tests
- [ ] **Step 15**: Fill cache to capacity + 1, verify oldest unvisited entry evicted
- [ ] **Step 16**: Access an entry, fill to capacity, verify accessed entry survives eviction
- [ ] **Step 17**: Fill with all-visited entries, verify eviction clears bits and evicts (scan cap)
- [ ] **Step 18**: `get(unknownHash)` returns `null`
- [ ] **Step 19**: `set(hash, A)` then `set(hash, B)` — `get` returns B

#### Integration tests
- [ ] **Step 20**: Two codec instances (no persistent store) — encode on A, decode on B succeeds via shared cache
- [ ] **Step 21**: Two codec instances + mock persistent store — encode on A, clear cache, decode on B succeeds via store fallback
- [ ] **Step 22**: Schema already in local registry — neither cache nor store consulted
- [ ] **Step 23**: Nested objects — parent + child schemas flow through cache
- [ ] **Step 24**: Compressed codec round-trip through cache + store

### Phase 5 — Validate

- [ ] **Step 25**: `pnpm build` — zero tsc errors
- [ ] **Step 26**: `pnpm test` — all tests pass
- [ ] **Step 27**: Benchmark: zero regression when no persistent store (cache is always present but decode hot path still uses local registry directly)
- [ ] **Step 28**: Benchmark: decode-miss-then-cache-hit path is fast


## Files Changed

| Action | Path |
|--------|------|
| **ADD** | `src/codec2/cache.ts` — SIEVE cache implementation |
| **EDIT** | `src/codec2/index.ts` — types, exports, codec integration |
| **ADD** | `tests/codec2-schema-store.ts` — cache + integration tests |


## Constraints

- SIEVE cache is **always** instantiated inside `createCodec` — not optional, not configurable by consumers
- `PersistentStore` is optional — when absent, the cache is the only shared layer
- Zero overhead on the encode/decode hot path — local registry is checked first, cache/store only on miss
- `StoredSchema` is plain data — serializable, no functions. Consumers can `JSON.stringify` it for their persistent store
- `PersistentStore.get`/`set` are synchronous — async backends must be wrapped (e.g., pre-load into a sync cache)
- Scan cap of 64 prevents pathological all-visited loops
- Default cache capacity 1024 — covers ~1000 distinct object shapes


## Consumer Example

```typescript
import { createCodec } from '@esportsplus/data';

// No persistence — schemas shared in-memory across codec instances automatically
let codecA = createCodec();
let codecB = createCodec();

codecA.encode({ name: 'Alice', age: 30 });
// codecB can now decode this shape — schema flows through the built-in SIEVE cache

// With persistence — schemas survive process restarts
let store = {
    get(hash: number) {
        let data = localStorage.getItem(`schema:${hash}`);
        return data ? JSON.parse(data) : null;
    },
    set(hash: number, schema: StoredSchema) {
        localStorage.setItem(`schema:${hash}`, JSON.stringify(schema));
    }
};

let codecC = createCodec({ store });
// Schemas now persist to localStorage and reload on next process start
```


## Out of Scope

- LRFU tiers, admission filters, WeakRef/FinalizationRegistry — unnecessary for bounded schema map
- Async persistent store interface — decode is synchronous
- Schema versioning or migration
- Timed cleanup — eviction by capacity pressure only
- Exposing cache internals or configuration to consumers
