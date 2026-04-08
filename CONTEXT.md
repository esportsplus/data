---
generated: 2026-04-08T06:45:00Z
ttl: 3600
source-hash: 2c714493
partial-refresh: true
sections-refreshed: [1,2,3,4,5,6,7,8,9,10,11]
---

### 1. Project Overview

- **Name**: @esportsplus/data (compile-time data validation utility)
- **Author**: ICJR
- **Entry points**: `./build/index.js`, `./build/compiler/plugins/tsc.js`, `./build/compiler/plugins/vite.js`
- **Dependencies**: `@esportsplus/utilities` (runtime), `@esportsplus/typescript` (dev), `msgpackr` (dev/bench)
- **Total source files**: 83 (.ts in src/)

### 2. File Tree (src/codec2/ — audit target)

```
src/codec2/
  index.ts       691 lines  — Main codec: createCodec(), encode/decode, schema cache
  codegen.ts     304 lines  — JIT compiler: compileEncoder, compileDecoder, compileComputeSize
  platform.ts    257 lines  — Platform abstraction: Buffer/DataView, codegen driver
  TOTAL         1252 lines
```

### 3. Package Scripts

| Script | Command | Description |
|--------|---------|-------------|
| build | `tsc` | TypeScript compilation |
| build:test | `pnpm build && pnpm test` | Build + test |
| bench | `vitest bench` | Run benchmarks |
| test | `vitest run` | Run tests |

### 4. Key Exports

**src/codec2/index.ts**
- `createCodec()` — factory returning `{ encode, decode }` codec instance
- `type Schema` — schema definition with hash, fields, compiled encode/decode fns
- `type SchemaRegistry` — maps schema IDs to Schema objects

**src/codec2/codegen.ts**
- `compileSchema(schema, helpers)` — JIT-compiles encode/decode/computeSize for a schema
- `type FieldDef` — field definition: name, type, fixedSize, offset
- `type SbcHelpers` — callbacks: decodeSbc, decodeTagEnd, encodeSbc

**src/codec2/platform.ts** (18 value exports + 1 type export)
- `allocBuf`, `allocUnsafe`, `byteLen`, `copyBuf` — buffer allocation/manipulation
- `codegenDriver` — platform-specific code generation driver (Node vs browser)
- `isNode` — runtime detection flag
- `readBI64`, `readF64`, `readStr`, `readU16`, `readU32`, `readUtf8` — read primitives
- `writeBI64`, `writeF64`, `writeU16`, `writeU32`, `writeUtf8` — write primitives
- `type CodegenDriver` — interface for platform-specific code generation

### 5. Module Map

```
platform.ts — Platform abstraction layer (rank: #1, centrality: 0.67)
  exports: 18 values + CodegenDriver type
  imports from: (none — leaf module)
  imported by: ./index, ./codegen

codegen.ts — JIT schema compiler (rank: #2, centrality: 0.50)
  exports: compileSchema, FieldDef, Schema, SbcHelpers
  imports from: ./platform
  imported by: ./index

index.ts — Public API + runtime (rank: #3, centrality: 0.33)
  exports: createCodec, Schema, SchemaRegistry
  imports from: ./codegen, ./platform
  imported by: tests/codec2.ts, tests/bench/codec2-*.ts, tests/bench/all-codecs.ts
```

### 6. Dependency Graph

#### 6a. Import Frequency (within codec2)

| File | Consumers | Exports Used / Total |
|------|-----------|---------------------|
| platform.ts | 2 (index, codegen) | 17/18 values used |
| codegen.ts | 1 (index) | 4/4 (all) |
| index.ts | 4 (test files) | 1/3 (createCodec only) |

#### 6b. Export Usage — Low Utilization

platform.ts — 17/18 exports used (94%)
- ✗ `readUtf8` — 0 internal consumers (exported but unused by codec2)

index.ts — 1/3 exports used externally
- ✓ `createCodec` (4 consumers)
- ✗ `Schema` type (0 external consumers — used internally)
- ✗ `SchemaRegistry` type (0 external consumers — used internally)

#### 6c. Circular Dependencies

None detected.

#### 6d. Dependency Ranking

Linear chain: platform.ts → codegen.ts → index.ts. No cycles, no barrel files.

### 7. File Metrics

| File | LOC | Exports | Imports | Consumers | Complexity |
|------|-----|---------|---------|-----------|------------|
| index.ts | 691 | 3 | 2 modules | 4 (tests) | high |
| codegen.ts | 304 | 4 | 1 module | 1 | medium |
| platform.ts | 257 | 19 | 0 | 2 | medium |

### 8. Risk Scoring

| Symbol | File | Risk | Conn | Bound | Test | Sec | Deps |
|--------|------|------|------|-------|------|-----|------|
| createCodec | index.ts | 0.55 | 0.15 | 0.00 | 0.05 | 0.00 | 0.10 |
| compileSchema | codegen.ts | 0.50 | 0.10 | 0.00 | 0.30 | 0.00 | 0.10 |
| encodeSbc (internal) | index.ts | 0.45 | 0.10 | 0.00 | 0.05 | 0.00 | 0.05 |
| compileEncoder | codegen.ts | 0.45 | 0.10 | 0.00 | 0.30 | 0.00 | 0.05 |
| compileDecoder | codegen.ts | 0.45 | 0.10 | 0.00 | 0.30 | 0.00 | 0.05 |
| matchSchema (internal) | index.ts | 0.40 | 0.05 | 0.00 | 0.05 | 0.00 | 0.05 |
| codegenDriver | platform.ts | 0.35 | 0.10 | 0.00 | 0.30 | 0.00 | 0.05 |
| inferType (internal) | index.ts | 0.35 | 0.05 | 0.00 | 0.05 | 0.00 | 0.00 |
| computeShapeHash (internal) | index.ts | 0.35 | 0.05 | 0.00 | 0.05 | 0.00 | 0.00 |
| platform read/write fns | platform.ts | 0.25 | 0.15 | 0.00 | 0.30 | 0.00 | 0.00 |

### 9. Test Map

| Test File | Covers |
|-----------|--------|
| tests/codec2.ts | Unit tests for codec2 (94 tests — 80 pass, 14 expected-fail bugs) |
| tests/bench/codec2-standalone.ts | Performance benchmark vs msgpackr |
| tests/bench/codec2-vs-msgpack.ts | Vitest benchmark vs msgpackr |
| tests/bench/all-codecs.ts | Benchmark: codec2 vs sbc vs proto vs msgpackr |

**Gaps**: No unit tests for codegen.ts or platform.ts in isolation. All testing goes through createCodec().

### 10. Recent History

```
4accce5 chore: add final performance report
65e16dd chore: update experiment log with all iterations
9255ad1 experiment(9): restore WeakMap cache + add fresh object benchmark
cf17997 experiment(8): WeakMap schema cache
d3eab62 experiment(7): deferred header write, single-pass encode
86537c6 experiment(6): decode fast path for tag-8 objects
b19ad41 experiment(5): ASCII fast path for string encoding in codegen
f847dc3 experiment(4): for-in count-first matchSchema with cacheCounts
c15016f experiment(3): packed numeric array encoding in codegen
d82359f experiment(2): for-in key counting with early exit in matchSchema
6865149 experiment(1): multi-schema cache ring for nested object support
d47c970 feat(codec2): initial v1 implementation
```

### 11. Build & Dev

```bash
pnpm install          # Install deps
pnpm build            # tsc
pnpm test             # vitest run
pnpm bench            # vitest bench
npx tsx tests/bench/codec2-standalone.ts  # Standalone benchmark
```

## Token Usage: ~2100/4000
