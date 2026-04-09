---
status: draft
date: 2026-04-08
scope: codec2 → sbc rename, legacy sbc deletion
---

# Spec: Replace Legacy SBC with Codec2

## Goal

Delete the legacy `src/sbc/` implementation and rename `src/codec2/` to `src/sbc/`. Codec2 becomes the sole binary codec under the `sbc` name. The public API surface changes to match codec2's simpler, self-contained design.

## Rationale

- Codec2 outperforms legacy SBC on every benchmark scenario (encode 2.53x, decode 3.38x vs MsgPack)
- Legacy SBC's external schema store / intern pool injection adds complexity with no proven benefit
- Codec2's JIT codegen is architecturally superior (zero per-field branching, compile-time type resolution)
- Maintaining two codec implementations is unnecessary


## Breaking Changes

### Removed Exports (from `src/index.ts`)

These legacy SBC functions have no codec2 equivalent and will be deleted:

**Functions:**
- `buildSchema`
- `compileSchema` (legacy version — codec2 has its own internal `compileSchema`)
- `createInternPool`
- `createRegistry`
- `createSchemaStore`
- `decodeFieldDefs`
- `deserializeRegistry` (standalone — replaced by `codec.deserializeRegistry()` instance method)
- `inferFieldType`
- `inferSchema`
- `lookupSchema`
- `parseFieldType`
- `registerSchema`
- `resolveSchema`
- `serializeFieldType`
- `serializeRegistry` (standalone — replaced by `codec.serializeRegistry()` instance method)
- `validateFieldTypeString`

**Types:**
- `ArrayFieldType`
- `FieldDef` (legacy version — codec2 has its own internal `FieldDef`)
- `FieldType`
- `InternDb`
- `InternPool`
- `NullableFieldType`
- `ObjectFieldType`
- `SchemaStoreInterface`

### Changed Exports

| Export | Before (legacy SBC) | After (codec2) |
|--------|---------------------|----------------|
| `createCodec` | `(schemaStore?, options?, internPool?)` | `(options?: CodecOptions)` |
| `Schema` | Legacy schema type | Codec2 schema type (different shape) |
| `SchemaRegistry` | Legacy registry type | Codec2 registry type (different shape) |

### New Exports (from codec2)

**Functions:**
- `createCodec` (codec2 version — simpler signature)

**Types:**
- `CodecOptions` — `{ compress?: boolean }`
- `DecodeOptions` — `{ schema?: number \| FieldSpec[] }`
- `EncodeOptions` — `{ schema?: number \| FieldSpec[]; view?: boolean }`
- `FieldSpec` — `{ name: string; nullable?: boolean; type: string }`
- `Schema` — codec2 schema type
- `SchemaRegistry` — codec2 registry type

### Changed `createCodec()` Instance Methods

| Method | Before (legacy SBC) | After (codec2) |
|--------|---------------------|----------------|
| `encode(value, view?)` | `boolean` 2nd arg | `boolean \| EncodeOptions` 2nd arg |
| `decode(buffer, length?)` | `number` 2nd arg | `number \| DecodeOptions` 2nd arg |
| `extractField(buffer, field, length?)` | 3rd arg `length` | No 3rd arg |
| `computeSize(value)` | absent | **new** |
| `defineSchema(fields)` | absent | **new** — returns numeric hash |
| `serializeRegistry()` | absent (standalone fn) | **new** — instance method |
| `deserializeRegistry(data)` | absent (standalone fn) | **new** — instance method |


## Implementation Steps

### Phase 1 — Delete Legacy SBC

- [ ] **Step 1**: Delete `src/sbc/` directory (4 files: `index.ts`, `codegen.ts`, `platform.ts`, `registry.ts`)
- [ ] **Step 2**: Delete `tests/sbc.ts` (1018 lines — legacy SBC tests)
- [ ] **Step 3**: Delete `tests/bench/sbc-vs-proto.ts` (legacy benchmark)

### Phase 2 — Rename Codec2 to SBC

- [ ] **Step 4**: Move `src/codec2/` → `src/sbc/` (3 files: `index.ts`, `codegen.ts`, `platform.ts`)
- [ ] **Step 5**: Rename internal `SbcHelpers` interface in `src/sbc/codegen.ts` — keep as-is (name is fine, it's internal)
- [ ] **Step 6**: Update `src/sbc/codegen.ts` import path: `from './platform'` (no change needed — relative)
- [ ] **Step 7**: Update `src/sbc/index.ts` import path: `from './codegen'` (no change needed — relative)

### Phase 3 — Update Compiler References

- [ ] **Step 8**: Move `src/compiler/codec2/` → `src/compiler/sbc/` (1 file: `index.ts`)
- [ ] **Step 9**: Update `src/compiler/plugins/tsc.ts`: `import codec2 from '../codec2'` → `import sbc from '../sbc'`; update all `codec2.` references to `sbc.`
- [ ] **Step 10**: Update `src/compiler/plugins/vite.ts`: same as Step 9

### Phase 4 — Update Public Exports

- [ ] **Step 11**: Rewrite `src/index.ts` exports:
  ```typescript
  export { codec, type Codec } from './codec';
  export { createCodec } from './sbc';
  export {
      decodeTypedArray,
      encodeTypedArrayInto,
      getTypedArrayType,
      TYPED_ARRAY_MARKER,
  } from './typed-array-codec';
  export { validator };
  export * from './types';

  export type {
      CodecOptions,
      DecodeOptions,
      EncodeOptions,
      FieldSpec,
      Schema,
      SchemaRegistry,
  } from './sbc';
  ```

### Phase 5 — Update Tests & Benchmarks

- [ ] **Step 12**: Rename `tests/codec2.ts` → `tests/sbc.ts`; update import: `from '../src/codec2'` → `from '../src/sbc'`
- [ ] **Step 13**: Rename `tests/codec2-schema-hints.ts` → `tests/sbc-schema-hints.ts`; update imports
- [ ] **Step 14**: Update `tests/bench/all-codecs.ts`: change `import { createCodec as createCodec2 } from '../../src/codec2'` → `from '../../src/sbc'`; rename variable from `codec2` to `sbc` throughout
- [ ] **Step 15**: Update `tests/bench/codec2-vs-msgpack.ts` → rename to `tests/bench/sbc-vs-msgpack.ts`; update imports
- [ ] **Step 16**: Update `tests/bench/codec2-standalone.ts` → rename to `tests/bench/sbc-standalone.ts`; update imports
- [ ] **Step 17**: Update `tests/bench/autoresearch-codec2.ts` → rename to `tests/bench/autoresearch-sbc.ts`; update imports
- [ ] **Step 18**: Update `tests/utils.ts` if it references codec2 paths

### Phase 6 — Validate

- [ ] **Step 19**: Run `pnpm build` — verify zero tsc errors
- [ ] **Step 20**: Run `pnpm test` — all tests pass
- [ ] **Step 21**: Run `npx tsx tests/bench/all-codecs.ts` — verify performance unchanged
- [ ] **Step 22**: Verify `build/` output has correct export paths (`./sbc/index.js`)


## Files Changed Summary

| Action | Path |
|--------|------|
| **DELETE** | `src/sbc/index.ts` (legacy) |
| **DELETE** | `src/sbc/codegen.ts` (legacy) |
| **DELETE** | `src/sbc/platform.ts` (legacy) |
| **DELETE** | `src/sbc/registry.ts` (legacy) |
| **DELETE** | `tests/sbc.ts` (legacy tests) |
| **DELETE** | `tests/bench/sbc-vs-proto.ts` (legacy bench) |
| **MOVE** | `src/codec2/*` → `src/sbc/*` |
| **MOVE** | `src/compiler/codec2/*` → `src/compiler/sbc/*` |
| **EDIT** | `src/index.ts` — rewrite exports |
| **EDIT** | `src/compiler/plugins/tsc.ts` — update import |
| **EDIT** | `src/compiler/plugins/vite.ts` — update import |
| **RENAME** | `tests/codec2.ts` → `tests/sbc.ts` |
| **RENAME** | `tests/codec2-schema-hints.ts` → `tests/sbc-schema-hints.ts` |
| **RENAME+EDIT** | `tests/bench/codec2-vs-msgpack.ts` → `tests/bench/sbc-vs-msgpack.ts` |
| **RENAME+EDIT** | `tests/bench/codec2-standalone.ts` → `tests/bench/sbc-standalone.ts` |
| **RENAME+EDIT** | `tests/bench/autoresearch-codec2.ts` → `tests/bench/autoresearch-sbc.ts` |
| **EDIT** | `tests/bench/all-codecs.ts` — update imports |
| **EDIT** | `tests/utils.ts` — update if needed |


## Out of Scope

- Wire format changes (codec2's format is preserved as-is)
- Performance changes (this is a rename/reorganization only)
- The `codec<T>()` compile-time function (`src/codec.ts`) — unchanged
- The `typed-array-codec` module — unchanged
- The validator system — unchanged
