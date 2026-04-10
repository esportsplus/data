---
generated: 2026-04-10T12:00:00Z
ttl: 3600
source-hash: a2168669
partial-refresh: true
sections-refreshed: [1,2,3,4,5,6,7,8,9,10,11]
---

### 1. Project Overview

- **Name**: @esportsplus/data v0.6.0 (compile-time data validation utility)
- **Author**: ICJR
- **Entry points**: `./build/index.js`, `./build/compiler/plugins/tsc.js`, `./build/compiler/plugins/vite.js`
- **Dependencies**: `@esportsplus/utilities` (runtime), `@esportsplus/typescript` (dev), `msgpackr` (dev/bench), `protobufjs` (dev/bench)
- **Total source files**: 75 (.ts in src/)

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
    type-analyzer.ts      416 LOC  — TypeScript type analysis: analyzeType, resolveBrandedType
    types.ts               15 LOC  — Compiler types: GeneratorContext, PathMode
    validator.ts          579 LOC  — Validator code generation: generateValidator
    validators.ts         120 LOC  — Branded validator registry: get, inline
    plugins/
      tsc.ts                7 LOC  — TSC plugin entry
      vite.ts              11 LOC  — Vite plugin entry
    sbc/
      index.ts            304 LOC  — SBC compiler transform
  sbc/
    cache.ts              113 LOC  — SIEVE cache: get, set, StoredSchema
    codegen.ts           1240 LOC  — JIT codegen: compileSchema (encoder/decoder/computeSize/compressed)
    constants.ts           48 LOC  — SBC constants: FIELD_SIZES, FNV_*, KNOWN_TYPES, MAX_*
    extract.ts            310 LOC  — Field extraction: extractField
    index.ts              654 LOC  — SBC codec core: codec(), encode/decode, schema registry
    platform.ts           319 LOC  — Platform abstraction: varint, zigzag, Buffer/DataView, typed array maps
    registry.ts           185 LOC  — Schema registry serialization: serializeRegistry, deserializeRegistry
    schema.ts             296 LOC  — Schema helpers: inferAndRegister, inferType, parseFieldType, computeNameHash, computeShapeHash
    size.ts               187 LOC  — Size computation: computeSize
    tagged.ts             761 LOC  — Tagged encoder/decoder: encodeSbc, decodeSbc, decodeTagEnd
    types.ts               55 LOC  — SBC types: CodecOptions, FieldSpec, PersistentStore, SchemaRegistry
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
export { TYPED_ARRAY_MARKER, decodeTypedArray, encodeTypedArrayInto, getTypedArrayType } from './typed-array-codec';
export type { CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, Schema, SchemaRegistry, StoredSchema };
```

### 5. Module Map (by dependency rank)

```
src/types.ts — Shared type definitions (rank: 0.95, consumers: 56+)
  exports: Validator, ErrorType, ValidatorFunction, Brand, Codec, ...
  imported by: all validators, compiler/*, index.ts

src/sbc/platform.ts — Platform abstraction layer (rank: 0.75, consumers: 6)
  exports: _vr, allocBuf, allocUnsafe, byteLen, codegenDriver, copyBuf, isNode, readBI64, readF64, readStr, readVarint, readZigzag, TYPED_ARRAY_*, writeBI64, writeF64, writeUtf8, writeVarint, writeZigzag
  imported by: sbc/codegen, sbc/tagged, sbc/extract, sbc/registry, sbc/index, sbc/size, sbc/schema

src/sbc/constants.ts — SBC constants (rank: 0.70, consumers: 6)
  exports: FIELD_NAME_RE, FIELD_SIZES, FNV_OFFSET, FNV_PRIME, KNOWN_TYPES, MAX_ARRAY_COUNT, MAX_SCHEMA_COUNT
  imported by: sbc/schema, sbc/tagged, sbc/extract, sbc/size, sbc/index, sbc/registry

src/sbc/codegen.ts — JIT compiler for schema encode/decode (rank: 0.65, consumers: 5)
  exports: compileSchema, FieldDef, ParsedType, Schema, SbcHelpers
  imported by: sbc/schema, sbc/index; types used by sbc/extract, sbc/size, sbc/tagged, sbc/registry, sbc/types

src/sbc/schema.ts — Schema inference/hashing (rank: 0.60, consumers: 4)
  exports: computeNameHash, computeShapeHash, inferAndRegister, inferType, parseFieldType, readFixedField, varintSize
  imported by: sbc/index, sbc/tagged, sbc/size, sbc/registry, sbc/extract

src/sbc/cache.ts — SIEVE eviction cache (rank: 0.50, consumers: 2)
  exports: default {get, set}, StoredSchema
  imported by: sbc/index, sbc/schema; type used by sbc/types

src/sbc/tagged.ts — Tagged encoder/decoder (rank: 0.50, consumers: 2)
  exports: decodeSbc, decodeTagEnd, encodeSbc, DecodeContext, EncodeContext
  imported by: sbc/index, sbc/extract

src/sbc/types.ts — SBC type definitions (rank: 0.45, consumers: 4)
  exports: CodecContext, CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, SchemaRegistry
  imported by: sbc/index, sbc/schema, sbc/tagged, sbc/size

src/sbc/extract.ts — Field extraction (rank: 0.40, consumers: 1)
  exports: extractField, ExtractContext
  imported by: sbc/index

src/sbc/size.ts — Size computation (rank: 0.40, consumers: 1)
  exports: computeSize, SizeContext
  imported by: sbc/index

src/sbc/registry.ts — Registry serialization (rank: 0.35, consumers: 1)
  exports: deserializeRegistry, serializeRegistry
  imported by: sbc/index

src/sbc/index.ts — SBC codec core (rank: 0.70, consumers: 2)
  exports: codec, CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, Schema, SchemaRegistry, StoredSchema
  imports from: all sbc/* modules
  imported by: src/index.ts

src/compiler/type-analyzer.ts — TS type introspection (rank: 0.60, consumers: 3)
  exports: analyzeType, resolveBrandedType, AnalyzedProperty, AnalyzedType
  imported by: compiler/index, compiler/sbc/index, compiler/validators

src/compiler/validators.ts — Branded validator registry (rank: 0.50, consumers: 3)
  exports: default {get, inline}, BrandedValidator
  imported by: compiler/index, compiler/validator, compiler/types

src/compiler/types.ts — Compiler internal types (rank: 0.45, consumers: 3)
  exports: GeneratorContext, PathMode
  imported by: compiler/validator, compiler/validators, compiler/error

src/compiler/error.ts — Error codegen helpers (rank: 0.35, consumers: 2)
  exports: default {generate}, ERRORS_VARIABLE
  imported by: compiler/validator, compiler/validators

src/compiler/validator.ts — Validator code generation (rank: 0.30, consumers: 1)
  exports: generateValidator
  imported by: compiler/index

src/compiler/index.ts — Compiler transform entry (rank: 0.35, consumers: 2)
  exports: default
  imported by: compiler/plugins/tsc, compiler/plugins/vite

src/compiler/sbc/index.ts — SBC compiler transform (rank: 0.30, consumers: 2)
  exports: default
  imported by: compiler/plugins/tsc, compiler/plugins/vite

src/constants.ts — Package name constant (rank: 0.40, consumers: 4)
  exports: PACKAGE_NAME
  imported by: index.ts, validators/max, validators/min, validators/range, compiler/plugins/vite, compiler/index

src/typed-array-codec.ts — TypedArray binary codec (rank: 0.20, consumers: 1)
  exports: TYPED_ARRAY_MARKER, decodeTypedArray, encodeTypedArrayInto, getTypedArrayType
  imported by: src/index.ts (re-export)

src/validators/index.ts — Barrel file (rank: 0.35, consumers: 1)
  re-exports: 56 validators from individual files
  imported by: src/index.ts
```

### 6. Dependency Graph

#### 6a. Import Frequency

| File | Consumers | Exports Used/Total | Rank |
|------|-----------|-------------------|------|
| src/types.ts | 56+ | 3/8 | 0.95 |
| src/sbc/platform.ts | 6 | 21/21 | 0.75 |
| src/sbc/constants.ts | 6 | 7/7 | 0.70 |
| src/sbc/index.ts | 2 | 1/9 | 0.70 |
| src/sbc/codegen.ts | 5 (types) | 5/5 | 0.65 |
| src/sbc/schema.ts | 4 | 7/7 | 0.60 |
| src/compiler/type-analyzer.ts | 3 | 4/4 | 0.60 |
| src/sbc/cache.ts | 2 | 2/2 | 0.50 |
| src/sbc/tagged.ts | 2 | 5/5 | 0.50 |
| src/compiler/validators.ts | 3 | 2/2 | 0.50 |
| src/compiler/types.ts | 3 | 2/2 | 0.45 |
| src/sbc/types.ts | 4 | 7/7 | 0.45 |
| src/constants.ts | 4 | 1/1 | 0.40 |
| src/sbc/extract.ts | 1 | 2/2 | 0.40 |
| src/sbc/size.ts | 1 | 2/2 | 0.40 |
| src/sbc/registry.ts | 1 | 2/2 | 0.35 |
| src/compiler/index.ts | 2 | 1/1 | 0.35 |
| src/compiler/error.ts | 2 | 2/2 | 0.35 |
| src/validators/index.ts | 1 | 56/56 | 0.35 |
| src/compiler/sbc/index.ts | 2 | 1/1 | 0.30 |
| src/compiler/validator.ts | 1 | 1/1 | 0.30 |
| src/typed-array-codec.ts | 1 | 4/4 | 0.20 |

#### 6b. Low Utilization Exports

```
src/types.ts — 3/8 exports used internally (37%)
  ✓ ErrorType (56 consumers)
  ✓ ValidatorFunction (9 consumers)
  ✓ Validator (1 consumer — index.ts)
  ? Codec, Brand, etc. — re-exported for external consumers

src/sbc/index.ts — 1/9 exports used directly (11%)
  ✓ codec (re-exported by index.ts)
  ? CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, Schema, SchemaRegistry, StoredSchema — type-only re-exports for external consumers
```

#### 6c. Circular Dependencies

None detected.

### 7. File Metrics

| File | LOC | Exports | Consumers | Complexity |
|------|-----|---------|-----------|------------|
| src/sbc/codegen.ts | 1240 | 5 | 5 | high |
| src/sbc/tagged.ts | 761 | 5 | 2 | high |
| src/sbc/index.ts | 654 | 9 | 2 | high |
| src/compiler/validator.ts | 579 | 1 | 1 | high |
| src/compiler/type-analyzer.ts | 416 | 4 | 3 | high |
| src/sbc/platform.ts | 319 | 21 | 6 | medium |
| src/sbc/extract.ts | 310 | 2 | 1 | medium |
| src/compiler/sbc/index.ts | 304 | 1 | 2 | medium |
| src/sbc/schema.ts | 296 | 7 | 4 | medium |
| src/sbc/size.ts | 187 | 2 | 1 | medium |
| src/sbc/registry.ts | 185 | 2 | 1 | medium |
| src/compiler/index.ts | 175 | 1 | 2 | medium |
| src/typed-array-codec.ts | 143 | 4 | 1 | medium |
| src/compiler/validators.ts | 120 | 2 | 3 | medium |
| src/sbc/cache.ts | 113 | 2 | 2 | low |

### 8. Risk Scoring

| Symbol | File | Risk | Conn | Bound | Test | Sec | Deps |
|--------|------|------|------|-------|------|-----|------|
| codec | src/sbc/index.ts | 0.70 | 0.25 | 0.15 | 0.05 | 0.20 | 0.05 |
| compileSchema | src/sbc/codegen.ts | 0.60 | 0.20 | 0.00 | 0.05 | 0.20 | 0.15 |
| encodeSbc | src/sbc/tagged.ts | 0.60 | 0.15 | 0.00 | 0.05 | 0.20 | 0.20 |
| decodeSbc | src/sbc/tagged.ts | 0.60 | 0.15 | 0.00 | 0.05 | 0.20 | 0.20 |
| analyzeType | src/compiler/type-analyzer.ts | 0.55 | 0.20 | 0.15 | 0.05 | 0.00 | 0.15 |
| generateValidator | src/compiler/validator.ts | 0.50 | 0.15 | 0.15 | 0.05 | 0.00 | 0.15 |
| inferAndRegister | src/sbc/schema.ts | 0.50 | 0.20 | 0.00 | 0.05 | 0.20 | 0.05 |
| extractField | src/sbc/extract.ts | 0.50 | 0.10 | 0.00 | 0.05 | 0.20 | 0.15 |
| readVarint | src/sbc/platform.ts | 0.50 | 0.15 | 0.00 | 0.05 | 0.20 | 0.10 |
| validators.inline | src/compiler/validators.ts | 0.50 | 0.15 | 0.15 | 0.05 | 0.00 | 0.15 |
| encodeTypedArrayInto | src/typed-array-codec.ts | 0.50 | 0.05 | 0.00 | 0.30 | 0.00 | 0.15 |
| decodeTypedArray | src/typed-array-codec.ts | 0.50 | 0.05 | 0.00 | 0.30 | 0.00 | 0.15 |
| computeSize | src/sbc/size.ts | 0.45 | 0.10 | 0.00 | 0.05 | 0.20 | 0.10 |
| deserializeRegistry | src/sbc/registry.ts | 0.45 | 0.10 | 0.00 | 0.05 | 0.20 | 0.10 |
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
| tests/typed-array-codec.ts | src/typed-array-codec.ts |
| tests/validators*.ts (5 files) | src/validators/* |
| tests/compile-validators.ts | src/compiler/validators.ts |
| tests/transformer.ts | src/compiler/index.ts |
| tests/type-analyzer-edge.ts | src/compiler/type-analyzer.ts |
| tests/complex.ts | Complex nested types |
| tests/primitives.ts | Primitive codec roundtrips |
| tests/unions.ts | Union type handling |
| tests/edge-cases.ts | Edge cases across modules |
| tests/error-paths.ts | Error handling paths |
| tests/branded-strings.ts | Branded string types |
| tests/custom-messages.ts | Custom error messages |
| tests/async-validators.ts | Async validators |
| tests/namespace-imports.ts | Namespace import handling |
| tests/plugins.ts | Plugin integration |

### 10. Recent History

```
b7425cd bench: add protobuf to codec comparison benchmark
a97195a fix(sbc): safe buffer overflow handling and lazy schema lookup
8a1f128 Merge branch 'main' of https://github.com/esportsplus/data
288ae09 chore: cleanup
1d11fb2 refactor(sbc): extract extractField, computeSize, registry (Phase 5-7)
ab25aff refactor(sbc): extract tagged encoder/decoder into tagged.ts (Phase 4)
e336582 refactor(sbc): extract types, constants, schema helpers from index.ts (Phase 1-3)
7326768 checkpoint: before sbc/index.ts reorg
602935e refactor(compiler,sbc): remove dead exports (F-ARCH-1, F-ARCH-5)
3c01ef0 test(sbc,compiler): fill coverage gaps from audit runs 9-12
2e7c7b0 fix(sbc): run 12 bounds checks + tests for tiered classification/JIT guards
338807a checkpoint: before run 12 fixes
0a60c9a fix(sbc): run 11 correctness/perf fixes
4273f92 checkpoint: before run 11 P0 fixes
d7d8cf3 fix(compiler,sbc): run 10 P0 correctness/security/perf fixes + tests
```

### 11. Build & Dev

```bash
pnpm build        # TypeScript compilation (tsc)
pnpm test         # vitest run
pnpm bench        # vitest bench
pnpm build:test   # Build + test
```

No env vars required. ESM module (`"type": "module"`).

### 12. Token Usage: ~3800/4000
