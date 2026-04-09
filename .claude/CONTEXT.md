---
generated: 2026-04-09T12:00:00Z
ttl: 3600
source-hash: a328e779
partial-refresh: true
sections-refreshed: [1,2,3,4,5,6,7,8,9,10,11]
---

### 1. Project Overview

- **Name**: @esportsplus/data v0.4.0 (compile-time data validation utility)
- **Author**: ICJR
- **Entry points**: `./build/index.js`, `./build/compiler/plugins/tsc.js`, `./build/compiler/plugins/vite.js`
- **Dependencies**: `@esportsplus/utilities` (runtime), `@esportsplus/typescript` (dev), `msgpackr` (dev/bench)
- **Total source files**: 74 (.ts in src/)

### 2. File Tree

```
src/
  index.ts                 40 LOC  — Main entry: re-exports codec, validators, types
  constants.ts              3 LOC  — PACKAGE_NAME
  types.ts                 63 LOC  — Shared types: Validator, ErrorType, ValidatorFunction, Brand
  typed-array-codec.ts    143 LOC  — TypedArray encode/decode: encodeTypedArrayInto, decodeTypedArray, getTypedArrayType
  compiler/
    error.ts               47 LOC  — Error code generation
    index.ts              175 LOC  — Compiler transform: default export (handles codec/validator calls)
    type-analyzer.ts      413 LOC  — TypeScript type analysis: analyzeType, resolveBrandedType
    types.ts               14 LOC  — Compiler types: GeneratorContext, PathMode
    validator.ts          545 LOC  — Validator code generation: generateValidator
    validators.ts         125 LOC  — Branded validator registry: get, inline
    plugins/
      tsc.ts                7 LOC  — TSC plugin entry
      vite.ts              11 LOC  — Vite plugin entry
    sbc/
      index.ts            304 LOC  — SBC compiler transform
  sbc/
    cache.ts              113 LOC  — SIEVE cache: get, set, StoredSchema
    codegen.ts           1239 LOC  — JIT codegen: compileSchema (encoder/decoder/computeSize/compressed)
    index.ts             2196 LOC  — SBC codec core: codec(), encode/decode, schema registry, extractField
    platform.ts           325 LOC  — Platform abstraction: varint, zigzag, Buffer/DataView, typed array maps
  validators/
    index.ts               56 LOC  — Barrel: re-exports 56 validators
    [56 validator files]  ~20 LOC avg — alpha, email, uuid, ip, cc, isbn, etc.
```

### 3. Package Scripts

| Script | Command | Description |
|--------|---------|-------------|
| build | tsc | TypeScript compilation |
| test | vitest run | Run test suite |
| bench | vitest bench | Run benchmarks |
| build:test | pnpm build && pnpm test | Build + test |

### 4. Key Exports (src/index.ts)

```typescript
export { codec } from './sbc';           // SBC binary codec factory
export { alpha, email, uuid, ... } from './validators';  // 56 validators
export { validator };                     // validator() factory
export * from './types';                  // Validator, ErrorType, etc.
export type { CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, Schema, SchemaRegistry, StoredSchema };
```

### 5. Module Map (by dependency rank)

```
src/types.ts — Shared type definitions (rank: 0.95, consumers: 56)
  exports: Validator, ErrorType, ValidatorFunction, Brand, Codec, ...
  imported by: all 56 validators, compiler/*, index.ts

src/constants.ts — Package name constant (rank: 0.40, consumers: 4)
  exports: PACKAGE_NAME
  imported by: index.ts, validators/max.ts, validators/min.ts, validators/range.ts, compiler/plugins/vite.ts

src/sbc/platform.ts — Platform abstraction layer (rank: 0.65, consumers: 2)
  exports: _vr, allocBuf, allocUnsafe, byteLen, codegenDriver, copyBuf, isNode, readBI64, readF64, readStr, readVarint, readZigzag, TYPED_ARRAY_BPE, TYPED_ARRAY_CTORS, TYPED_ARRAY_IDS, writeBI64, writeF64, writeUtf8, writeVarint, writeZigzag, CodegenDriver
  imported by: sbc/codegen.ts, sbc/index.ts

src/sbc/codegen.ts — JIT compiler for schema encode/decode (rank: 0.55, consumers: 1)
  exports: compileSchema, FieldDef, ParsedType, Schema, SbcHelpers
  imported by: sbc/index.ts

src/sbc/cache.ts — SIEVE eviction cache (rank: 0.45, consumers: 1)
  exports: get, set, StoredSchema
  imported by: sbc/index.ts

src/sbc/index.ts — SBC codec core (rank: 0.70, consumers: 3 via barrel)
  exports: codec, CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, Schema, SchemaRegistry, StoredSchema
  imports from: ./codegen, ./platform, ./cache

src/compiler/type-analyzer.ts — TS type introspection (rank: 0.60, consumers: 4)
  exports: analyzeType, resolveBrandedType, AnalyzedProperty, AnalyzedType
  imported by: compiler/index.ts, compiler/sbc/index.ts, compiler/validators.ts (+1)

src/compiler/validators.ts — Branded validator registry (rank: 0.50, consumers: 3)
  exports: default {get, inline}, BrandedValidator
  imported by: compiler/index.ts, compiler/validator.ts, compiler/types.ts

src/compiler/error.ts — Error codegen helpers (rank: 0.35, consumers: 2)
  exports: default {generate, resolvePath}, ERRORS_VARIABLE
  imported by: compiler/validator.ts, compiler/validators.ts

src/compiler/validator.ts — Validator code generation (rank: 0.30, consumers: 1)
  exports: generateValidator
  imported by: compiler/index.ts

src/compiler/types.ts — Compiler internal types (rank: 0.45, consumers: 3)
  exports: GeneratorContext, PathMode
  imported by: compiler/validator.ts, compiler/validators.ts, compiler/error.ts

src/compiler/index.ts — Compiler transform entry (rank: 0.35, consumers: 2)
  exports: default
  imported by: compiler/plugins/tsc.ts, compiler/plugins/vite.ts

src/compiler/sbc/index.ts — SBC compiler transform (rank: 0.30, consumers: 2)
  exports: default
  imported by: compiler/plugins/tsc.ts, compiler/plugins/vite.ts

src/typed-array-codec.ts — TypedArray binary codec (rank: 0.20, consumers: 0 internal)
  exports: TYPED_ARRAY_MARKER, decodeTypedArray, encodeTypedArrayInto, getTypedArrayType

src/validators/index.ts — Barrel file (rank: 0.35, consumers: 1)
  re-exports: 56 validators from individual files
  imported by: src/index.ts
```

### 6. Dependency Graph

#### 6a. Import Frequency

| File | Consumers | Exports Used/Total | Rank |
|------|-----------|-------------------|------|
| src/types.ts | 56 | 3/8 | 0.95 |
| src/sbc/index.ts | 3 (via barrel+plugins) | 1/9 | 0.70 |
| src/sbc/platform.ts | 2 | 20/21 | 0.65 |
| src/compiler/type-analyzer.ts | 4 | 4/4 | 0.60 |
| src/sbc/codegen.ts | 1 | 5/5 | 0.55 |
| src/compiler/validators.ts | 3 | 2/2 | 0.50 |
| src/compiler/types.ts | 3 | 2/2 | 0.45 |
| src/sbc/cache.ts | 1 | 2/2 | 0.45 |
| src/constants.ts | 4 | 1/1 | 0.40 |
| src/compiler/index.ts | 2 | 1/1 | 0.35 |
| src/compiler/error.ts | 2 | 2/2 | 0.35 |
| src/compiler/sbc/index.ts | 2 | 1/1 | 0.30 |
| src/compiler/validator.ts | 1 | 1/1 | 0.30 |
| src/typed-array-codec.ts | 0 | 0/4 | 0.20 |

#### 6b. Low Utilization Exports

```
src/types.ts — 3/8 exports used internally (37%)
  ✓ ErrorType (56 consumers)
  ✓ ValidatorFunction (9 consumers)
  ✓ Validator (1 consumer — index.ts)
  ? Codec, Brand, etc. — re-exported for external consumers

src/sbc/index.ts — 1/9 exports used directly (11%)
  ✓ codec (re-exported by index.ts)
  ? CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, Schema, SchemaRegistry, StoredSchema — type-only re-exports

src/typed-array-codec.ts — 0/4 exports used internally (0%)
  ✗ TYPED_ARRAY_MARKER (0 consumers)
  ✗ decodeTypedArray (0 consumers)
  ✗ encodeTypedArrayInto (0 consumers)
  ✗ getTypedArrayType (0 consumers)
  NOTE: may be consumed externally or by tests only
```

#### 6c. Circular Dependencies

None detected.

### 7. File Metrics

| File | LOC | Exports | Consumers | Complexity |
|------|-----|---------|-----------|------------|
| src/sbc/index.ts | 2196 | 9 | 3 | high |
| src/sbc/codegen.ts | 1239 | 5 | 1 | high |
| src/compiler/validator.ts | 545 | 1 | 1 | high |
| src/compiler/type-analyzer.ts | 413 | 4 | 4 | high |
| src/sbc/platform.ts | 325 | 21 | 2 | medium |
| src/compiler/sbc/index.ts | 304 | 1 | 2 | medium |
| src/compiler/index.ts | 175 | 1 | 2 | medium |
| src/typed-array-codec.ts | 143 | 4 | 0 | medium |
| src/compiler/validators.ts | 125 | 2 | 3 | medium |
| src/sbc/cache.ts | 113 | 2 | 1 | low |

### 8. Risk Scoring

| Symbol | File | Risk | Conn | Bound | Test | Sec | Deps |
|--------|------|------|------|-------|------|-----|------|
| codec | src/sbc/index.ts | 0.70 | 0.25 | 0.15 | 0.05 | 0.20 | 0.05 |
| compileSchema | src/sbc/codegen.ts | 0.55 | 0.15 | 0.00 | 0.05 | 0.20 | 0.15 |
| analyzeType | src/compiler/type-analyzer.ts | 0.55 | 0.20 | 0.15 | 0.05 | 0.00 | 0.15 |
| generateValidator | src/compiler/validator.ts | 0.50 | 0.15 | 0.15 | 0.05 | 0.00 | 0.15 |
| readVarint | src/sbc/platform.ts | 0.50 | 0.15 | 0.00 | 0.05 | 0.20 | 0.10 |
| validators.inline | src/compiler/validators.ts | 0.50 | 0.15 | 0.15 | 0.05 | 0.00 | 0.15 |
| encodeTypedArrayInto | src/typed-array-codec.ts | 0.50 | 0.05 | 0.00 | 0.30 | 0.00 | 0.15 |
| decodeTypedArray | src/typed-array-codec.ts | 0.50 | 0.05 | 0.00 | 0.30 | 0.00 | 0.15 |
| default (compiler) | src/compiler/index.ts | 0.45 | 0.15 | 0.15 | 0.05 | 0.00 | 0.10 |
| default (sbc compiler) | src/compiler/sbc/index.ts | 0.45 | 0.15 | 0.15 | 0.05 | 0.00 | 0.10 |
| cache.get/set | src/sbc/cache.ts | 0.30 | 0.10 | 0.00 | 0.05 | 0.00 | 0.15 |
| validators (56) | src/validators/*.ts | 0.15 | 0.05 | 0.00 | 0.05 | 0.00 | 0.05 |

### 9. Test Map

| Test File | Covers |
|-----------|--------|
| tests/sbc.ts | src/sbc/* (codec, encode/decode, schema) |
| tests/sbc-schema-hints.ts | SBC schema hint paths |
| tests/sbc-schema-store.ts | SBC persistent store |
| tests/validators*.ts (5 files) | src/validators/* |
| tests/compile-validators.ts | src/compiler/validators.ts |
| tests/transformer.ts | src/compiler/index.ts |
| tests/type-analyzer-edge.ts | src/compiler/type-analyzer.ts |
| tests/complex.ts | Complex nested types |
| tests/primitives.ts | Primitive codec roundtrips |
| tests/unions.ts | Union type handling |
| tests/edge-cases.ts | Edge cases across modules |
| tests/error-paths.ts | Error handling paths |
| **No test coverage** | src/typed-array-codec.ts |

### 10. Recent History

```
4b255c8 refactor(sbc,compiler): dedup codegen/encode, remove dead export, add body guard
579fc4b checkpoint: before batch 5 architecture fixes
63ea8d1 perf(sbc): eliminate hot-path allocations in varint, matchSchema, encodeSbc
202de27 checkpoint: before batch 4 performance fixes
fea9a87 fix(compiler,typed-array): fix eager regex eval, null union validation, header overflow
69d24bc checkpoint: before batch 3 compiler correctness fixes
4c624fa checkpoint: before batch 2 correctness SBC fixes
7fce799 fix(sbc): add input validation for readVarint, decodeTagEnd, deserializeRegistry
e1a66dd checkpoint: before batch 1 security fixes
633b053 Merge branch 'main' of https://github.com/esportsplus/data
```

### 11. Build & Dev

```bash
pnpm build        # TypeScript compilation (tsc)
pnpm test         # vitest run
pnpm bench        # vitest bench
pnpm build:test   # Build + test
```

No env vars required. ESM module (`"type": "module"`).

### 12. Token Usage: ~3200/4000
