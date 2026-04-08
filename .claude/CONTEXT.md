---
generated: 2026-04-07T00:00:00Z
ttl: 3600
source-hash: pending
partial-refresh: true
sections-refreshed: [1,2,5,6,7]
---

## 1. Project Overview

**@esportsplus/data** v0.3.9 — Compile-time data validation utility with binary codec.
- Entry: `src/index.ts`
- Exports: `.` (main), `./compiler/tsc`, `./compiler/vite`
- Dependencies: `@esportsplus/utilities` (runtime), `@esportsplus/typescript` (dev/compiler)
- Peer: `typescript >=5.0`, `esbuild >=0.17` (optional), `vite >=4.0` (optional)

## 2. File Tree (src/)

```
src/
├── codec.ts (19 LOC) — compile-time codec stub
├── constants.ts (4 LOC) — package name constant
├── index.ts (62 LOC) — main barrel re-exports
├── typed-array-codec.ts (139 LOC) — typed array binary encode/decode
├── types.ts (63 LOC) — shared validator types
├── sbc/
│   ├── codegen.ts (1312 LOC) — schema compile, encode/decode codegen
│   ├── index.ts (618 LOC) — createCodec, SBC encode/decode engine
│   ├── platform.ts (376 LOC) — Node/browser platform abstraction, I/O primitives
│   └── registry.ts (883 LOC) — schema registry, intern pool, schema store
├── compiler/
│   ├── error.ts (48 LOC) — error code generation
│   ├── index.ts (212 LOC) — TSC transform plugin entry
│   ├── type-analyzer.ts (413 LOC) — TypeScript type analysis
│   ├── types.ts (15 LOC) — compiler types
│   ├── validator.ts (545 LOC) — validator code generation
│   ├── validators.ts (119 LOC) — branded validator registry
│   └── proto/
│       ├── decoder.ts (333 LOC) — protobuf-style decoder codegen
│       ├── encoder.ts (463 LOC) — protobuf-style encoder codegen
│       ├── field-mapper.ts (37 LOC) — field mapping
│       ├── index.ts (60 LOC) — transformCodec entry
│       ├── runtime.ts (347 LOC) — runtime helper codegen
│       └── type-mapper.ts (96 LOC) — wire type mapping
└── validators/ (50 files, ~1200 LOC total) — individual validation functions
```

## 5. Module Map

**src/sbc/platform.ts** — Platform abstraction, Buffer/DataView I/O (rank: #1, central hub)
  exports: allocBuf, allocUnsafe, byteLen, copyBuf, FIELD_SIZES, fromUtf8, isNode, read/write primitives, driver, codegen driver, varint, zigzag, types
  imported by: sbc/codegen, sbc/index, sbc/registry

**src/sbc/codegen.ts** — Schema compilation, encode/decode function generation (rank: #2)
  exports: buildSchema, buildSchemaFromDef, compileSchema, compileCompressedDecoder, compileCompressedEncoder, validateFieldName, validateFieldTypeString, CODEGEN_RESERVED_NAMES
  imports from: ./platform
  imported by: sbc/index, sbc/registry

**src/sbc/registry.ts** — Schema registry, lookup, inference, intern pool, schema store (rank: #3)
  exports: createInternPool, createRegistry, createSchemaStore, decodeFieldDefs, deserializeRegistry, inferFieldType, inferSchema, lookupSchema, parseFieldType, registerSchema, resolveSchema, serializeFieldType, serializeRegistry
  imports from: ./codegen, ./platform
  imported by: sbc/index

**src/sbc/index.ts** — SBC codec factory (createCodec), re-exports (rank: #4)
  exports: createCodec + re-exports from codegen/registry
  imports from: ~/typed-array-codec, ./codegen, ./platform, ./registry
  imported by: src/index

**src/typed-array-codec.ts** — Typed array binary codec (rank: #5)
  exports: TYPED_ARRAY_MARKER, decodeTypedArray, encodeTypedArrayInto, getTypedArrayType
  imported by: sbc/index, src/index

**src/compiler/index.ts** — TSC transform plugin (rank: #6)
  exports: default (transform config)
  imports from: compiler/type-analyzer, compiler/validators, compiler/proto, compiler/validator, ../constants

**src/compiler/validator.ts** — Validator code generation (rank: #7)
  exports: generateValidator
  imported by: compiler/index

**src/compiler/type-analyzer.ts** — TypeScript type introspection (rank: #8)
  exports: analyzeType, resolveBrandedType
  imported by: compiler/index

**src/compiler/proto/index.ts** — Codec transform entry (rank: #9)
  exports: transformCodec
  imports from: ./decoder, ./encoder, ./field-mapper, ./runtime, ./type-mapper

## 6. Dependency Graph

### 6a. Import Frequency

| File | Consumers | Key Role |
|------|-----------|----------|
| src/sbc/platform.ts | 3 (codegen, registry, index) | I/O hub |
| src/sbc/codegen.ts | 2 (index, registry) | Schema compiler |
| src/sbc/registry.ts | 1 (index) | Schema management |
| src/typed-array-codec.ts | 2 (sbc/index, src/index) | Typed array codec |
| src/constants.ts | 2 (codec, compiler/index) | Package name |
| src/types.ts | 1 (src/index) | Types |
| src/validators/index.ts | 1 (src/index) | Barrel |

### 6c. No circular dependencies detected in manual analysis.

## 7. File Metrics

| File | LOC | Exports | Consumers | Complexity |
|------|-----|---------|-----------|------------|
| src/sbc/codegen.ts | 1312 | 8 | 2 | high |
| src/sbc/registry.ts | 883 | 13 | 1 | high |
| src/sbc/index.ts | 618 | 1+re-exports | 1 | high |
| src/compiler/validator.ts | 545 | 1 | 1 | high |
| src/compiler/proto/encoder.ts | 463 | 1 | 1 | medium |
| src/compiler/type-analyzer.ts | 413 | 2 | 1 | medium |
| src/sbc/platform.ts | 376 | 30+ | 3 | medium |
| src/compiler/proto/runtime.ts | 347 | 2 | 1 | medium |
| src/compiler/proto/decoder.ts | 333 | 1 | 1 | medium |
