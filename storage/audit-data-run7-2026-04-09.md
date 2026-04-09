# Audit Spec: @esportsplus/data — Run 7

**Status**: COMPLETE
**Date**: 2026-04-09
**Project**: @esportsplus/data v0.4.0
**Commit**: 4b255c8
**Mode**: incremental (6 changed files since 633b053, 10 commits)
**Prior runs**: 6

---

## Implementation Batches

### Batch 1: Security — 3 findings

#### F-S1: Unsanitized field names from deserializeRegistry flow into new Function() — RCE
- **File**: src/sbc/index.ts:2066, src/sbc/codegen.ts:120
- **Symbol**: deserializeRegistry → compileSchema
- **Category**: security
- **Priority Score**: 113
- **Evidence**: `readStr(data, pos, nameLen)` reads field names from untrusted wire bytes. Names flow through `defineSchema` → `compileSchema` → `compileEncoder/Decoder` where `JSON.stringify(name)` is used in `new Function()` body string. No field name validation exists anywhere in the pipeline.
- **Recommendation**: Add allowlist regex `if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) throw new Error('Codec2: invalid field name')` in both `deserializeRegistry` and `defineSchema` for defense-in-depth.
- **Estimated LOC delta**: +4

#### F-S2: decodeAt reads tag-8/18 header bytes without bounds guard
- **File**: src/sbc/index.ts:1430-1436
- **Symbol**: decodeAt
- **Category**: security
- **Priority Score**: 103
- **Evidence**: `buffer[offset+5]` through `buffer[offset+8]` read with no check that `buffer.length >= offset + 9`. Out-of-bounds reads return `undefined`, `undefined|0 = 0`, producing silently wrong `dataLen`.
- **Recommendation**: Add `if (offset + 9 > buffer.length) throw new Error('Codec2: truncated tag-8/18 header')` before header read.
- **Estimated LOC delta**: +6

#### F-CORR-2: decode schema hint path checks len >= 5 but tag-8/18 needs len >= 9
- **File**: src/sbc/index.ts:1252
- **Symbol**: decode
- **Category**: correctness
- **Priority Score**: 93
- **Evidence**: Guard is `len >= 5` but header is 9 bytes. With 5 <= len < 9, calls `decodeFn(buffer, 9, 0)` reading past message boundary.
- **Recommendation**: Change guard to `len >= 9`.
- **Estimated LOC delta**: +1

### Batch 2: Correctness (SBC codec) — 4 findings

#### F-CORR-3: compileDecoder tag-18 nested typed objects decoded with wrong decoder
- **File**: src/sbc/codegen.ts:558-586
- **Symbol**: compileDecoder
- **Category**: correctness
- **Priority Score**: 103
- **Evidence**: Generated code for object fields handles `b[p]===8||b[p]===18` but always calls `_s.decodeFn` (uncompressed), never `_s.compressedDecodeFn`. `compileCompressedDecoder` correctly dispatches at lines 840-856.
- **Recommendation**: Add `if(b[p]===18&&_s.compressedDecodeFn)` dispatch at three call sites mirroring compileCompressedDecoder.
- **Estimated LOC delta**: +6

#### F-CORR-1: extractField silent wrong value on truncated buffer
- **File**: src/sbc/index.ts:1643-1668
- **Symbol**: extractField, readFixedField
- **Category**: correctness
- **Priority Score**: 93
- **Evidence**: O(1) path accumulates pos from fixedSizes without bounds check. `readFixedField` has no bounds check. Browser: `buf[pos]` returns undefined, `undefined|0 = 0`.
- **Recommendation**: Add `if (pos + target.fixedSize > buffer.length) throw` before readFixedField calls.
- **Estimated LOC delta**: +4

#### F-CORR-4: computeSize underestimates for nested typed objects >= 128 bytes
- **File**: src/sbc/index.ts:1986
- **Symbol**: computeSize
- **Category**: correctness
- **Priority Score**: 83
- **Evidence**: `size += 1 + nestedSize` assumes 1-byte varint length. Encoder uses 9-byte header when nestedSize >= 128. Underestimates by 8.
- **Recommendation**: `size += (nestedSize < 128 ? 1 : 9) + nestedSize`
- **Estimated LOC delta**: +1

#### F-PERF-1: Map encode destructures iterator — per-entry tuple allocation
- **File**: src/sbc/index.ts:1013
- **Symbol**: encodeSbc
- **Category**: optimize
- **Priority Score**: 103
- **Evidence**: `for (let [k, v] of value)` on Map allocates 2-element array per entry.
- **Recommendation**: Replace with `value.forEach((v, k) => { ... })`.
- **Estimated LOC delta**: +0/-0

### Batch 3: Correctness (Compiler) + Performance — 4 findings

#### F-CORR-6: generateUnionValidation silently skips bigint union arms
- **File**: src/compiler/validator.ts:457-476
- **Symbol**: generateUnionValidation
- **Category**: correctness
- **Priority Score**: 93
- **Evidence**: Switch has no `case 'bigint'`. For `string|bigint`: only `typeof x !== 'string'` emitted. BigInt(42) incorrectly rejected.
- **Recommendation**: Add `case 'bigint': checks.push(\`typeof ${varname} !== 'bigint'\`); break;`
- **Estimated LOC delta**: +3

#### F-CORR-5: validators.get permanent cache — stale branded validators in watch mode
- **File**: src/compiler/validators.ts:80
- **Symbol**: get
- **Category**: correctness
- **Priority Score**: 83
- **Evidence**: Module-level `Map<string>` cache returns stale validators when program is rebuilt. `analyzeType` WeakMap self-invalidates; `validators.get` does not.
- **Recommendation**: Key cache on `ts.SourceFile` object (WeakMap) instead of path string.
- **Estimated LOC delta**: +3/-2

#### F-PERF-2: matchSchema Object.keys+sort on every cache-miss with structural schemas
- **File**: src/sbc/index.ts:1217-1220
- **Symbol**: matchSchema
- **Category**: optimize
- **Priority Score**: 93
- **Evidence**: `typedSchemas.size > 0` branch executes `Object.keys(obj).sort()` on every WeakMap miss.
- **Recommendation**: Add key-count guard before Object.keys, or make hash order-independent.
- **Estimated LOC delta**: +3/-1

#### F-CORR-7: analyzeTupleType hardcodes optional=false
- **File**: src/compiler/type-analyzer.ts:250
- **Symbol**: analyzeTupleType
- **Category**: correctness
- **Priority Score**: 59
- **Evidence**: `analyzePropertyType(elements[i], \`${i}\`, false, ...)` — false always for optional. `[string, number?]` generates strict length check rejecting valid `['hello']`.
- **Recommendation**: Detect optional elements via TupleType.elementFlags and generate range-based length check.
- **Estimated LOC delta**: +12/-3
