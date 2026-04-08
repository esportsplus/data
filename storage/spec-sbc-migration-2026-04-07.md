# Spec: SBC + Typed Array Codec Migration

**Date:** 2026-04-07
**Scope:** Delete old `src/sbc.ts`, move `storage/sbc/` and `storage/typed-array-codec.ts` into `src/`, re-export through `src/index.ts`

---

## Background

The `storage/sbc/` directory and `storage/typed-array-codec.ts` contain the latest, most performant SBC implementation — modularized into 4 files with new capabilities (field extraction, typed array support, compressed encoding, intern DB). The old monolithic `src/sbc.ts` (2652 lines) is superseded and must be replaced.

---

## Phase 1: Delete Old Implementation

- [ ] **1.1** Delete `src/sbc.ts`

---

## Phase 2: Move New Implementation into `src/`

- [ ] **2.1** Move `storage/sbc/` → `src/sbc/` (4 files: `index.ts`, `codegen.ts`, `platform.ts`, `registry.ts`)
- [ ] **2.2** Move `storage/typed-array-codec.ts` → `src/typed-array-codec.ts`
- [ ] **2.3** Verify internal imports within moved files resolve correctly:
  - `src/sbc/index.ts` imports `~/typed-array-codec` — must resolve to `src/typed-array-codec.ts` via `~` alias
  - `src/sbc/index.ts` imports `./codegen`, `./platform`, `./registry` — relative, no change needed
  - `src/sbc/codegen.ts` imports from `./platform`, `./registry` — relative, no change needed
  - `src/sbc/registry.ts` imports from `./platform`, `./codegen` — relative, no change needed

---

## Phase 3: Re-export Through `src/index.ts`

- [ ] **3.1** Add SBC re-exports to `src/index.ts`:

```typescript
export {
    buildSchema,
    compileSchema,
    createCodec,
    createInternPool,
    createRegistry,
    createSchemaStore,
    decodeFieldDefs,
    deserializeRegistry,
    inferFieldType,
    inferSchema,
    lookupSchema,
    parseFieldType,
    registerSchema,
    resolveSchema,
    serializeFieldType,
    serializeRegistry,
    validateFieldTypeString,
} from './sbc';

export type {
    ArrayFieldType,
    FieldDef,
    FieldType,
    InternDb,
    InternPool,
    NullableFieldType,
    ObjectFieldType,
    Schema,
    SchemaRegistry,
    SchemaStoreInterface,
} from './sbc';
```

- [ ] **3.2** Add typed array codec re-exports to `src/index.ts`:

```typescript
export {
    decodeTypedArray,
    encodeTypedArrayInto,
    getTypedArrayType,
    TYPED_ARRAY_MARKER,
} from './typed-array-codec';
```

---

## Phase 4: Update Consumers

- [ ] **4.1** Update `tests/bench/sbc-vs-proto.ts` line 3: change `from '../src/sbc'` → `from '../src/sbc'` (path unchanged since we're placing at same location)

---

## Phase 5: Validate

- [ ] **5.1** Run `pnpm tsc --noEmit` — zero errors
- [ ] **5.2** Run `pnpm test` — all tests pass
- [ ] **5.3** Verify `storage/sbc/` and `storage/typed-array-codec.ts` are removed (no orphan copies)

---

## Package.json Exports

No changes needed — SBC is consumed via the main `.` export entry point (`build/index.js`), which includes everything re-exported from `src/index.ts`.

---

## New Public API Surface (via `@esportsplus/data`)

### Functions
| Export | Source |
|--------|--------|
| `buildSchema` | `src/sbc/codegen.ts` |
| `compileSchema` | `src/sbc/codegen.ts` |
| `createCodec` | `src/sbc/index.ts` |
| `createInternPool` | `src/sbc/registry.ts` |
| `createRegistry` | `src/sbc/registry.ts` |
| `createSchemaStore` | `src/sbc/registry.ts` |
| `decodeFieldDefs` | `src/sbc/registry.ts` |
| `decodeTypedArray` | `src/typed-array-codec.ts` |
| `deserializeRegistry` | `src/sbc/registry.ts` |
| `encodeTypedArrayInto` | `src/typed-array-codec.ts` |
| `getTypedArrayType` | `src/typed-array-codec.ts` |
| `inferFieldType` | `src/sbc/registry.ts` |
| `inferSchema` | `src/sbc/registry.ts` |
| `lookupSchema` | `src/sbc/registry.ts` |
| `parseFieldType` | `src/sbc/registry.ts` |
| `registerSchema` | `src/sbc/registry.ts` |
| `resolveSchema` | `src/sbc/registry.ts` |
| `serializeFieldType` | `src/sbc/registry.ts` |
| `serializeRegistry` | `src/sbc/registry.ts` |
| `TYPED_ARRAY_MARKER` | `src/typed-array-codec.ts` |
| `validateFieldTypeString` | `src/sbc/codegen.ts` |

### Types
| Export | Source |
|--------|--------|
| `ArrayFieldType` | `src/sbc/platform.ts` |
| `FieldDef` | `src/sbc/platform.ts` |
| `FieldType` | `src/sbc/platform.ts` |
| `InternDb` | `src/sbc/platform.ts` |
| `InternPool` | `src/sbc/platform.ts` |
| `NullableFieldType` | `src/sbc/platform.ts` |
| `ObjectFieldType` | `src/sbc/platform.ts` |
| `Schema` | `src/sbc/platform.ts` |
| `SchemaRegistry` | `src/sbc/platform.ts` |
| `SchemaStoreInterface` | `src/sbc/platform.ts` |
