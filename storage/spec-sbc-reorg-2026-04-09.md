# Spec: sbc/index.ts Reorg — Split 2255 LOC Monolith

- **Status**: PENDING
- **Source**: F-ARCH-2 from audit runs 9-14
- **Goal**: Split `src/sbc/index.ts` (2255 LOC, 4 concerns) into focused modules without changing public API or breaking tests

## Problem

Everything lives inside a single `codec()` factory closure. The closure captures shared mutable state (`registry`, `encodeBuf`, `helpers`, caches) that every function references. This makes the file hard to navigate and impossible to test internal concerns in isolation.

## Constraints

- **Zero public API changes**: `export { codec }` and all type exports must remain identical
- **Zero behavior changes**: all 1287 tests must pass without modification
- **No new dependencies**: extracted modules import from each other and from `./platform`, `./codegen`, `./cache` only
- **Closure state stays in `codec()`**: the factory still owns all mutable state. Extracted functions receive state via parameters

## Current Structure (line map)

```
src/sbc/index.ts (2255 LOC)
├── Types (lines 1-56)                    → CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, SchemaRegistry, Schema re-export
├── Module-level helpers (lines 57-405)
│   ├── Constants: FIELD_NAME_RE, FNV_OFFSET/PRIME, FIELD_SIZES, KNOWN_TYPES, MAX_*
│   ├── computeShapeHash(keys, types)
│   ├── computeNameHash(keys)
│   ├── varintSize(n)
│   ├── parseFieldType(type)
│   ├── inferType(value)
│   ├── inferAndRegister(obj, registry, helpers, store)
│   └── readFixedField(buf, pos, type)
├── codec() factory (lines 406-2268)
│   ├── Closure state (lines 407-423): compress, encodeBuf, registry, store, caches, weakCache
│   ├── Cache helpers (lines 425-457): setCache, resolveSchemaFromCacheOrStore, lastDecode* slots
│   ├── encodeObj (lines 459-497)
│   ├── helpers object (lines 499-505)
│   ├── decodeSbc (lines 508-741)         ~233 LOC — tagged value decoder
│   ├── decodeTagEnd (lines 742-882)      ~140 LOC — tag end-offset calculator
│   ├── encodeSbc (lines 883-1219)        ~336 LOC — tagged value encoder
│   ├── matchSchema (lines 1220-1274)
│   ├── decode (lines 1277-1353)
│   ├── encodeObject (lines 1354-1406)
│   ├── encode (lines 1407-1464)
│   ├── decodeAt (lines 1465-1483)
│   ├── defineSchema (lines 1484-1611)
│   ├── resolveSchemaForDecode/Encode (lines 1612-1638)
│   ├── extractField (lines 1640-1929)    ~289 LOC
│   ├── computeSize (lines 1930-2093)     ~163 LOC
│   ├── deserializeRegistry (lines 2094-2192)
│   └── serializeRegistry (lines 2193-2264)
└── Exports (lines 2271-2272)
```

## Target Structure

```
src/sbc/
├── index.ts          ~350 LOC  — codec() factory, closure state, public API surface
├── types.ts          ~60  LOC  — all SBC types (CodecOptions, FieldSpec, Schema, etc.)
├── constants.ts      ~90  LOC  — FIELD_NAME_RE, FIELD_SIZES, KNOWN_TYPES, MAX_*, FNV
├── schema.ts         ~300 LOC  — computeShapeHash, computeNameHash, varintSize, parseFieldType, inferType, inferAndRegister, readFixedField
├── tagged.ts         ~710 LOC  — decodeSbc, decodeTagEnd, encodeSbc (the wire format)
├── extract.ts        ~290 LOC  — extractField
├── size.ts           ~165 LOC  — computeSize
├── registry.ts       ~175 LOC  — serializeRegistry, deserializeRegistry
├── codegen.ts        (unchanged)
├── platform.ts       (unchanged)
├── cache.ts          (unchanged)
```

## Shared State — Threading Strategy

The `codec()` factory owns all mutable state. Extracted functions receive what they need as parameters:

```typescript
// src/sbc/types.ts — new type for the shared context bag
type CodecContext = {
    compress: boolean;
    encodeBuf: Uint8Array;
    helpers: SbcHelpers;
    registry: SchemaRegistry;
    store: PersistentStore | null;
};
```

| Extracted function | Receives | Returns |
|-------------------|----------|---------|
| `decodeSbc(ctx, buf, offset, len, depth)` | CodecContext | unknown |
| `decodeTagEnd(buf, offset, depth)` | (no ctx — stateless) | number |
| `encodeSbc(ctx, value, buf, pos)` | CodecContext | number |
| `extractField(ctx, buffer, fieldName)` | CodecContext + cache/decode refs | unknown |
| `computeSize(ctx, value)` | CodecContext | number |
| `serializeRegistry(registry)` | SchemaRegistry | Uint8Array |
| `deserializeRegistry(ctx, data)` | CodecContext | void |

Functions that also need cache state (`matchSchema`, `setCache`, `encodeObj`) stay inside `codec()` — they're tightly coupled to the ring-buffer and weakCache closure variables.

## Implementation Phases

### Phase 1: Extract types → `src/sbc/types.ts`

Move all type declarations (lines 1-56) plus the new `CodecContext` type. Update imports in `index.ts`.

**Files touched**: `src/sbc/types.ts` (new), `src/sbc/index.ts`

### Phase 2: Extract constants → `src/sbc/constants.ts`

Move: `FIELD_NAME_RE`, `FNV_OFFSET`, `FNV_PRIME`, `FIELD_SIZES`, `KNOWN_TYPES`, `MAX_ARRAY_COUNT`, `MAX_SCHEMA_COUNT`.

**Files touched**: `src/sbc/constants.ts` (new), `src/sbc/index.ts`, `src/sbc/schema.ts` (imports)

### Phase 3: Extract schema helpers → `src/sbc/schema.ts`

Move: `computeShapeHash`, `computeNameHash`, `varintSize`, `parseFieldType`, `inferType`, `inferAndRegister`, `readFixedField`.

These are all module-level (not inside `codec()`) and already pure or take explicit params. `inferAndRegister` takes `(obj, registry, helpers, store)` — no closure refs.

**Files touched**: `src/sbc/schema.ts` (new), `src/sbc/index.ts`

### Phase 4: Extract tagged encoder/decoder → `src/sbc/tagged.ts`

Move `decodeSbc`, `decodeTagEnd`, `encodeSbc` out of `codec()` closure. Thread shared state via `CodecContext` parameter.

`decodeTagEnd` is already stateless (only reads `buf`). `decodeSbc` references `compress`, `lastDecode*`, `registry`, `resolveSchemaFromCacheOrStore`. `encodeSbc` references `compress`, `helpers`, `registry`, `store`, `inferAndRegister`, `matchSchema`, `setCache`, `weakCache`.

For `encodeSbc`: `matchSchema`, `setCache`, `weakCache` are cache concerns that must stay in `codec()`. Solution: pass an `onEncode` callback or keep `encodeObj` (which wraps `encodeSbc` with cache logic) inside `codec()`, while `encodeSbc` itself only needs `ctx` + recursive self-reference.

Check: `encodeSbc` calls `inferAndRegister` and `matchSchema` via `encodeObj`. Since `encodeObj` stays in `codec()` and calls `encodeSbc`, the extracted `encodeSbc` must be passable as a callback — which is already how `helpers.encodeSbc` works.

**Strategy**: Extract `decodeSbc`, `decodeTagEnd`, `encodeSbc` as standalone functions that take a `CodecContext` (or subset). Inside `codec()`, bind them: `let boundDecodeSbc = (buf, off, len, depth) => decodeSbc(ctx, buf, off, len, depth)`.

**Files touched**: `src/sbc/tagged.ts` (new), `src/sbc/index.ts`

### Phase 5: Extract extractField → `src/sbc/extract.ts`

Move `extractField` out of `codec()`. It references: `compress`, `registry`, `decodeSbc`, `decodeTagEnd`. All available via `CodecContext` or direct import.

**Files touched**: `src/sbc/extract.ts` (new), `src/sbc/index.ts`

### Phase 6: Extract computeSize → `src/sbc/size.ts`

Move `computeSize` out of `codec()`. It references: `registry`, `helpers`, `inferAndRegister`, `store`. All threadable via `CodecContext`.

**Files touched**: `src/sbc/size.ts` (new), `src/sbc/index.ts`

### Phase 7: Extract registry serialization → `src/sbc/registry.ts`

Move `serializeRegistry` and `deserializeRegistry`. `serializeRegistry` only reads `registry.schemas`. `deserializeRegistry` calls `defineSchema` — pass as callback or import.

**Files touched**: `src/sbc/registry.ts` (new), `src/sbc/index.ts`

### Phase 8: Verify

1. `pnpm tsc --noEmit` — zero errors
2. `pnpm test` — 1287/1287 pass
3. `wc -l src/sbc/index.ts` — target: ~350 LOC (down from 2255)
4. No public API changes: `export { codec }` and type exports unchanged

## Risk Mitigation

- **Each phase is independently committable** — if Phase 4 (tagged.ts) proves too tangled, phases 1-3 still reduce index.ts by ~450 LOC
- **No behavior changes** — every function keeps its exact signature and logic, just moved
- **Tests are the safety net** — run full suite after every phase
- **Performance risk**: extra parameter passing adds ~0 overhead (V8 inlines small functions). The `CodecContext` object is allocated once per `codec()` call, not per encode/decode

## What Stays in `index.ts` (~350 LOC)

- `codec()` factory function
- Closure state declarations (`compress`, `encodeBuf`, `registry`, `store`, caches)
- `setCache`, `resolveSchemaFromCacheOrStore` (cache-coupled)
- `encodeObj` (calls both cache + encodeSbc)
- `matchSchema` (reads ring buffer + typedSchemas)
- `decode`, `encode`, `encodeObject`, `decodeAt` (thin API wrappers)
- `defineSchema` (modifies registry + typedSchemas + calls compileSchema)
- `resolveSchemaForDecode/Encode` (reads registry)
- `return { ... }` public API object
- Re-exports from `./types`
