---
generated: 2026-04-09T00:00:00Z
ttl: 3600
source-hash: a328e779
partial-refresh: false
sections-refreshed: [1,2,3,4,5,6,7,8,9,10,11]
---

## 1. Project Overview

**@esportsplus/data** v0.4.0 — Compile-time data validation utility with binary codec (SBC).
- Entry: `src/index.ts`
- Exports: `.` (main), `./compiler/tsc`, `./compiler/vite`
- Dependencies: `@esportsplus/utilities` (runtime), `@esportsplus/typescript` (dev/compiler)
- Peer: `typescript >=5.0`, `esbuild >=0.17` (optional), `vite >=4.0` (optional)
- Proto codec removed (36f1702); codec.ts deleted; registry.ts merged into sbc/index.ts

## 2. File Tree (src/)

```
src/ (72 files, ~7314 LOC)
├── constants.ts (3 LOC) — PACKAGE_NAME constant
├── index.ts (40 LOC) — main barrel re-exports
├── typed-array-codec.ts (139 LOC) — typed array binary encode/decode
├── types.ts (63 LOC) — shared validator types
├── sbc/
│   ├── cache.ts (113 LOC) — SIEVE cache for schema lookups
│   ├── codegen.ts (1294 LOC) — schema compile, encode/decode codegen
│   ├── index.ts (2144 LOC) — createCodec, SBC encode/decode engine, registry
│   └── platform.ts (308 LOC) — Node/browser platform abstraction, I/O primitives
├── compiler/
│   ├── error.ts (47 LOC) — error code generation
│   ├── index.ts (175 LOC) — TSC transform plugin entry
│   ├── type-analyzer.ts (413 LOC) — TypeScript type analysis
│   ├── types.ts (14 LOC) — compiler types
│   ├── validator.ts (545 LOC) — validator code generation
│   ├── validators.ts (119 LOC) — branded validator registry
│   ├── plugins/
│   │   ├── tsc.ts (7 LOC) — TSC plugin export
│   │   └── vite.ts (11 LOC) — Vite plugin export
│   └── sbc/
│       └── index.ts (304 LOC) — SBC compiler transform
└── validators/ (50 files, ~1575 LOC total) — individual validation functions
```

## 3. Package Scripts

| Script | Description |
|--------|-------------|
| `build` | `tsc` — TypeScript compilation |
| `build:test` | Build then test |
| `prepare` | Build on install |
| `bench` | `vitest bench` — run benchmarks |
| `test` | `vitest run` — run tests |

## 4. Key Exports

**src/index.ts** (main entry):
- `codec` — SBC codec factory (re-export from ./sbc)
- `decodeTypedArray`, `encodeTypedArrayInto`, `getTypedArrayType`, `TYPED_ARRAY_MARKER` — typed array codec
- `validator` — compile-time validator stub (throws if untransformed)
- Types: `CodecOptions`, `DecodeOptions`, `EncodeOptions`, `FieldSpec`, `PersistentStore`, `Schema`, `SchemaRegistry`, `StoredSchema`, `Validator`, `ValidatorFn`, `Brand`

**src/compiler/plugins/tsc.ts** (./compiler/tsc):
- `default` — TSC plugin instance

**src/compiler/plugins/vite.ts** (./compiler/vite):
- `default` — Vite plugin instance

## 5. Module Map

**src/types.ts** — Shared validator types (rank: #1, 56 consumers)
  exports: Validator, ValidatorFn, Brand (types)
  imported by: 52 validator files, compiler/error, compiler/validator, compiler/validators, index

**src/sbc/platform.ts** — Platform I/O primitives (rank: #2, 2 consumers)
  exports: allocBuf, allocUnsafe, byteLen, codegenDriver, copyBuf, isNode, readBI64, readF64, readStr, readVarint, readZigzag, TYPED_ARRAY_BPE, TYPED_ARRAY_CTORS, TYPED_ARRAY_IDS, writeBI64, writeF64, writeUtf8, writeVarint, writeZigzag, CodegenDriver
  imported by: sbc/codegen, sbc/index

**src/sbc/codegen.ts** — Schema compilation, encode/decode codegen (rank: #3, 1 consumer)
  exports: compileSchema, FieldDef, ParsedType, Schema, SbcHelpers (types)
  imports from: ./platform
  imported by: sbc/index

**src/sbc/index.ts** — SBC codec engine + registry (rank: #4, 3 consumers)
  exports: codec + types (CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, Schema, SchemaRegistry, StoredSchema)
  imports from: ./codegen, ./platform, ./cache
  imported by: src/index, compiler/plugins/tsc, compiler/plugins/vite

**src/compiler/type-analyzer.ts** — TypeScript type introspection (rank: #5, 4 consumers)
  exports: analyzeType, resolveBrandedType, AnalyzedProperty, AnalyzedType (types)
  imported by: compiler/index, compiler/sbc/index, compiler/validator, compiler/validators

**src/compiler/validators.ts** — Branded validator registry (rank: #6, 3 consumers)
  exports: default { clear, get, inline }, BrandedValidator (type)
  imports from: ./type-analyzer, ./types, ./error
  imported by: compiler/index, compiler/types, compiler/validator

**src/compiler/error.ts** — Error code generation (rank: #7, 2 consumers)
  exports: default { generate, resolvePath }, ERRORS_VARIABLE
  imported by: compiler/validator, compiler/validators

**src/compiler/validator.ts** — Validator code generation (rank: #8, 1 consumer)
  exports: generateValidator
  imports from: ./type-analyzer, ./types, ./error, ./validators
  imported by: compiler/index

**src/compiler/index.ts** — TSC transform plugin (rank: #9, 2 consumers)
  exports: default (transform config)
  imports from: ../constants, ./type-analyzer, ./validators, ./validator
  imported by: compiler/plugins/tsc, compiler/plugins/vite

**src/constants.ts** — Package name constant (rank: #10, 6 consumers)
  exports: PACKAGE_NAME
  imported by: compiler/index, compiler/plugins/vite, src/index, validators/max, validators/min, validators/range

**src/typed-array-codec.ts** — Typed array binary codec (rank: #11, 1 consumer)
  exports: TYPED_ARRAY_MARKER, decodeTypedArray, encodeTypedArrayInto, getTypedArrayType
  imported by: src/index

**src/sbc/cache.ts** — SIEVE eviction cache (rank: #12, 1 consumer)
  exports: default { get, set }, StoredSchema (type)
  imported by: sbc/index

**src/compiler/sbc/index.ts** — SBC compiler transform (rank: #13, 2 consumers)
  exports: default (transform config)
  imports from: ../type-analyzer
  imported by: compiler/plugins/tsc, compiler/plugins/vite

**src/compiler/types.ts** — Compiler types (rank: #14, leaf)
  exports: GeneratorContext, PathMode (types)
  imported by: compiler/validator, compiler/validators, compiler/error

**src/compiler/plugins/tsc.ts** — TSC plugin (rank: #15, package export)
  exports: default plugin
  imports from: ../sbc, ..

**src/compiler/plugins/vite.ts** — Vite plugin (rank: #16, package export)
  exports: default plugin
  imports from: ../sbc, .., ~/constants

**src/validators/index.ts** — Barrel (rank: #17, 1 consumer)
  exports: 50 named validators (alpha through words)
  imported by: src/index (re-export via `* from './types'` path)

## 6. Dependency Graph

### 6a. Import Frequency

| File | Consumers | Key Role |
|------|-----------|----------|
| src/types.ts | 56 | Type hub — all validators + compiler + index |
| src/constants.ts | 6 | Package name |
| src/compiler/type-analyzer.ts | 4 | Type analysis |
| src/sbc/index.ts | 3 | Codec engine |
| src/compiler/validators.ts | 3 | Branded validator registry |
| src/sbc/platform.ts | 2 | I/O primitives |
| src/compiler/error.ts | 2 | Error codegen |
| src/compiler/index.ts | 2 | Transform plugin |
| src/compiler/sbc/index.ts | 2 | SBC compiler |
| src/compiler/types.ts | 3 | Compiler types |
| src/sbc/codegen.ts | 1 | Schema compilation |
| src/sbc/cache.ts | 1 | SIEVE cache |
| src/typed-array-codec.ts | 1 | Typed array codec |
| src/compiler/validator.ts | 1 | Validator codegen |

### 6c. No circular dependencies detected.

## 7. File Metrics

| File | LOC | Exports | Consumers | Complexity |
|------|-----|---------|-----------|------------|
| src/sbc/index.ts | 2144 | 1+types | 3 | high |
| src/sbc/codegen.ts | 1294 | 1+types | 1 | high |
| src/compiler/validator.ts | 545 | 1 | 1 | high |
| src/compiler/type-analyzer.ts | 413 | 2+types | 4 | medium |
| src/sbc/platform.ts | 308 | 19+type | 2 | medium |
| src/compiler/sbc/index.ts | 304 | 1 | 2 | medium |
| src/compiler/index.ts | 175 | 1 | 2 | medium |
| src/typed-array-codec.ts | 139 | 4 | 1 | low |
| src/compiler/validators.ts | 119 | 3+type | 3 | low |
| src/sbc/cache.ts | 113 | 2+type | 1 | low |

## 8. Risk Scoring

| Symbol | File | Risk | Conn | Bound | Test | Sec | Deps |
|--------|------|------|------|-------|------|-----|------|
| codec | sbc/index.ts | 0.55 | 0.20 | 0.15 | 0.05 | 0.05 | 0.10 |
| compileSchema | sbc/codegen.ts | 0.45 | 0.10 | 0.00 | 0.05 | 0.20 | 0.10 |
| readVarint | sbc/platform.ts | 0.55 | 0.15 | 0.00 | 0.05 | 0.20 | 0.05 |
| writeVarint | sbc/platform.ts | 0.45 | 0.15 | 0.00 | 0.05 | 0.20 | 0.05 |
| analyzeType | compiler/type-analyzer.ts | 0.50 | 0.25 | 0.15 | 0.05 | 0.00 | 0.05 |
| generateValidator | compiler/validator.ts | 0.50 | 0.10 | 0.15 | 0.05 | 0.20 | 0.00 |
| validators.inline | compiler/validators.ts | 0.55 | 0.15 | 0.15 | 0.05 | 0.20 | 0.00 |
| encodeTypedArrayInto | typed-array-codec.ts | 0.45 | 0.05 | 0.15 | 0.30 | 0.00 | 0.00 |
| decodeTypedArray | typed-array-codec.ts | 0.45 | 0.05 | 0.15 | 0.30 | 0.00 | 0.00 |
| cache.get | sbc/cache.ts | 0.25 | 0.05 | 0.00 | 0.05 | 0.00 | 0.05 |
| cache.set | sbc/cache.ts | 0.25 | 0.05 | 0.00 | 0.05 | 0.00 | 0.05 |

## 9. Test Map

| Test File | Covers |
|-----------|--------|
| tests/sbc.ts | sbc/index (codec, encode/decode) |
| tests/sbc-schema-hints.ts | sbc schema hints |
| tests/sbc-schema-store.ts | sbc schema store/registry |
| tests/compile-validators.ts | compiler validator generation |
| tests/transformer.ts | compiler transform plugin |
| tests/type-analyzer-edge.ts | compiler/type-analyzer edge cases |
| tests/validators.ts | validators (basic) |
| tests/validators-format.ts | format validators |
| tests/validators-advanced.ts | advanced validators |
| tests/validators-constraints.ts | constraint validators |
| tests/validators-number-date.ts | number/date validators |
| tests/primitives.ts | primitive type validation |
| tests/complex.ts | complex type validation |
| tests/unions.ts | union type validation |
| tests/edge-cases.ts | edge cases |
| tests/error-paths.ts | error path coverage |
| tests/branded-strings.ts | branded string types |
| tests/custom-messages.ts | custom error messages |
| tests/namespace-imports.ts | namespace import handling |
| tests/async-validators.ts | async validators |
| tests/plugins.ts | plugin integration |

**Gaps**: typed-array-codec.ts has no dedicated test file. sbc/cache.ts tested indirectly via sbc.ts.

## 10. Recent History

```
633b053 Merge branch 'main' of https://github.com/esportsplus/data
6f38a92 chore: remove completed spec and batch state files
efe417b fix(bench): delete obsolete bench files, fix imports, update vitest excludes
724708a checkpoint: before bench test fixes
24276a2 chore: remove proto from benchmarks, delete obsolete audit files
93b389d checkpoint: before Batch 3 cleanup
f80dc39 test: remove proto and codec transform test files
5e52e94 checkpoint: before Batch 2 proto test removal
36f1702 refactor(compiler): remove proto codec compiler and codec<T>() API
ff87e92 checkpoint: before Batch 1 proto removal
dd98af5 checkpoint: before F-029
e0eada2 fix(proto): sign-extend negative BigInt in _readBigInt
fb2ef53 checkpoint: before F-028
94acef7 fix(proto): sign-extend negative int32 in _readVarint
46b3b88 checkpoint: before F-027
```

## 11. Build & Dev

- Build: `pnpm build` (tsc)
- Test: `pnpm test` (vitest run)
- Bench: `pnpm bench` (vitest bench)

## Token Usage: ~3200/4000
