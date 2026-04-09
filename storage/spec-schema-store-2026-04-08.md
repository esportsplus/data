---
status: draft
date: 2026-04-08
scope: codec2 universal schema store
---

# Spec: Universal Schema Store

## Goal

Add an optional `SchemaStore` to codec2 that enables schema sharing across codec instances. Schemas registered in the store are available to any codec that uses it. Two methods: `get` and `set`. Returns `null` on miss — no `has`.

## Rationale

- Codec instances are currently isolated — schemas inferred/defined in one instance don't transfer to another
- Multi-service architectures need a shared schema registry (e.g., sender defines schema, receiver decodes without re-inference)
- `serializeRegistry` / `deserializeRegistry` exist but require manual coordination between instances
- A shared store eliminates that boilerplate while keeping codec instances independent for encode/decode state

## Design

### Interface

```typescript
type SchemaStore = {
    get(hash: number): StoredSchema | null;
    set(hash: number, schema: StoredSchema): void;
};

type StoredSchema = {
    fields: FieldSpec[];
    hash: number;
};
```

- `get(hash)` — returns the stored schema or `null` if not found
- `set(hash, schema)` — stores the schema, overwrites if hash already exists
- `StoredSchema` is a lightweight descriptor (field specs + hash), not the compiled `Schema` internal type — each codec compiles its own JIT functions from the descriptor

### Factory

```typescript
const createSchemaStore = (): SchemaStore;
```

Returns an in-memory store backed by a `Map<number, StoredSchema>`. Consumers can also implement the `SchemaStore` interface themselves (Redis, IndexedDB, etc.) since it's just `get`/`set`.

### Codec Integration

```typescript
type CodecOptions = {
    compress?: boolean;
    store?: SchemaStore;
};
```

When `store` is provided:

**On schema registration** (`defineSchema` or auto-inference):
1. Codec computes hash + builds `FieldSpec[]` as normal
2. Calls `store.set(hash, { fields, hash })` to publish the schema

**On decode with unknown hash**:
1. Codec encounters a hash not in its local `registry.schemas`
2. Calls `store.get(hash)` before throwing
3. If non-null, calls `defineSchema(storedSchema.fields)` to compile locally, then decodes
4. If null, throws as before (`unknown schema hash`)

**On encode** — no change. Schemas are always compiled locally before encoding.

### Lifecycle

```
Codec A (sender):                    Codec B (receiver):
  encode(obj)                          decode(buf)
    → inferAndRegister()                 → hash lookup in local registry
    → store.set(hash, schema)            → miss → store.get(hash)
    → returns encoded bytes              → StoredSchema found
                                         → defineSchema(fields)
                                         → compile JIT functions
                                         → decode succeeds
```

After the first decode, Codec B has the schema compiled locally — no further store lookups for that shape.

## Implementation Steps

### Phase 1 — Types & Factory

- [ ] **Step 1**: Add `SchemaStore` and `StoredSchema` types to `src/codec2/index.ts`
- [ ] **Step 2**: Implement `createSchemaStore` factory — `Map<number, StoredSchema>` wrapper with `get`/`set`
- [ ] **Step 3**: Add `store?` to `CodecOptions` type
- [ ] **Step 4**: Export `createSchemaStore`, `SchemaStore`, `StoredSchema` from `src/codec2/index.ts`

### Phase 2 — Publish on Registration

- [ ] **Step 5**: In `defineSchema`, after `registry.schemas.set(hash, schema)`, call `store.set(hash, { fields: sorted, hash })` if store exists
- [ ] **Step 6**: In `inferAndRegister`, after `registry.schemas.set(hash, schema)`, build a `StoredSchema` from the inferred fields and call `store.set(hash, ...)` if store exists. Pass `store` as a parameter to `inferAndRegister`
- [ ] **Step 7**: In `deserializeRegistry`, after each `defineSchema(fields)` call, the store is updated automatically via Step 5

### Phase 3 — Lookup on Decode Miss

- [ ] **Step 8**: In `decodeSbc` tag-8 handler (line ~515): when `registry.schemas.get(hash)` returns `undefined`, check `store.get(hash)`. If non-null, call `defineSchema(stored.fields)` then retry the schema lookup
- [ ] **Step 9**: In `decodeSbc` tag-18 handler: same as Step 8 for compressed objects
- [ ] **Step 10**: In `decode` fast-path (line ~1191): when `registry.schemas.get(hash)` misses, check store before falling through to generic path
- [ ] **Step 11**: In `decode` tag-18 fast-path (line ~1207): same as Step 10

### Phase 4 — Tests

- [ ] **Step 12**: Test: two codec instances sharing a store — encode on A, decode on B without pre-registration
- [ ] **Step 13**: Test: store miss returns null, decode throws for unknown hash (existing behavior preserved)
- [ ] **Step 14**: Test: store.get not called when schema already in local registry (verify no redundant lookups)
- [ ] **Step 15**: Test: nested objects — parent + child schemas both flow through store
- [ ] **Step 16**: Test: custom store implementation (mock get/set)
- [ ] **Step 17**: Test: compressed codec round-trip through store

### Phase 5 — Validate

- [ ] **Step 18**: Run `pnpm build` — zero tsc errors
- [ ] **Step 19**: Run `pnpm test` — all tests pass
- [ ] **Step 20**: Benchmark — verify zero performance regression when `store` is `undefined` (hot path unchanged)

## Files Changed

| Action | Path |
|--------|------|
| **EDIT** | `src/codec2/index.ts` — add types, factory, store integration |
| **ADD** | Test cases in `tests/codec2.ts` or new `tests/codec2-schema-store.ts` |

## Constraints

- `store` is optional — when omitted, zero overhead (no conditional checks on hot path). Guard the store calls behind a single `if (store)` at registration and decode-miss sites only
- `StoredSchema` must be serializable (plain object, no functions) — enables future persistence backends
- Store is synchronous — async stores are out of scope (decode is synchronous, can't await)
- Store does not own compilation — each codec compiles its own JIT functions from the `FieldSpec[]` descriptor. The store holds data, not code
- Thread safety is the consumer's responsibility — the interface is simple enough for any concurrency wrapper

## Out of Scope

- Async/persistent store backends (Redis, IndexedDB) — consumers implement the interface
- Schema versioning / migration — hashes are deterministic from field names + types
- Schema eviction / TTL — store is a simple map, consumers manage lifecycle
- Store-aware `serializeRegistry` / `deserializeRegistry` — these continue to work on the local registry only
