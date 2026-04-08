# Code Audit: src/codec2

**Status**: COMPLETE
**Date**: 2026-04-08
**Commit**: 4accce5
**Mode**: first-run (full audit)
**Scope**: src/codec2/ (3 files, 1252 LOC)

---

## Summary

- Audit agents dispatched: 5 (correctness: 1, security: 1, performance: 1, architecture: 1, testing: 1)
- Files audited: 3 / 3 (100%)
- Total raw findings: 38
- Merged (cross-agent overlap): 4
- Rejected (latent/low-value): 8
- **Valid findings (post-judge): 23**
- Findings by priority: **P0: 9** | **P1: 7** | P2 (excluded): 7

## SQALE Technical Debt Rating

**Grade: D** — 9 P0 findings (7 correctness bugs + 1 security DoS + 1 security data exposure)

---

## Findings — P0 (Immediate)

### F-000: matchSchema ring buffer ignores value types — wrong schema used for same keys with different types
- **Category**: correctness
- **Priority**: P0 — Score: 124
- **Agents**: Correctness, Security, Testing (all flagged related aspects)
- **File**: src/codec2/index.ts:580-598
- **Evidence**: `matchSchema` ring buffer checks only key names and count, NOT value types. When the same keys appear with different value types (e.g. `{ value: "hello" }` then `{ value: 42 }`), the cached schema's compiled encoder/decoder is reused — the string encoder runs on a number, producing crashes or corrupt output. The hash-based registry (`inferAndRegister`) correctly hashes both keys AND types via `computeShapeHash`, but `matchSchema` short-circuits before `inferAndRegister` is ever reached. Fix: in the ring buffer match loop, also compare `inferType(obj[fields[j].name])` against `fields[j].type` for each field.

### F-001: compileEncoder mixed array — non-number elements encoded as garbage float64
- **Category**: correctness
- **Priority**: P0 — Score: 99
- **Agents**: Correctness
- **File**: src/codec2/codegen.ts:119-133
- **Evidence**: If `a[0]` is a number but later elements are not, the type-check loop breaks with `_u8=0, _i32=0`. Falls to packed float64 branch which calls `_wF64` on non-numbers → NaN/garbage. `encodeSbc` correctly handles this case (full scan + `allNumber` flag), but `compileEncoder`'s array path does not track an `allNumber` equivalent.

### F-002: Array length > 65535 silently truncates element count
- **Category**: correctness
- **Priority**: P0 — Score: 89
- **Agents**: Correctness
- **File**: src/codec2/index.ts:517-518
- **Evidence**: Tags 7, 12, 13, 14 all store element count as u16 (2 bytes). Arrays with >65535 elements encode `len & 0xFFFF` — decoder reconstructs a shorter array. Silent data loss.

### F-003: String byte-length > 65535 silently truncates length prefix
- **Category**: correctness
- **Priority**: P0 — Score: 89
- **Agents**: Correctness
- **File**: src/codec2/index.ts:413-414
- **Evidence**: `encodeSbc` writes string byte-length as u16. Strings >65535 UTF-8 bytes encode a truncated length. Decoder reads wrong `sLen`, returns corrupt/truncated string.

### F-004: Unbounded recursion on nested tag-7 arrays → stack overflow
- **Category**: security
- **Priority**: P0 — Score: 89
- **Agents**: Security
- **File**: src/codec2/index.ts:241-247, 337-344
- **Evidence**: `decodeSbc` tag-7 and `decodeTagEnd` tag-7 recurse without depth limit. A crafted ~10KB payload with nested single-element arrays causes ~10,000 stack frames → `RangeError: Maximum call stack size exceeded`. Any code path decoding untrusted bytes is vulnerable.

### F-005: Shared encode buffer view:true leaks data across calls
- **Category**: security
- **Priority**: P0 — Score: 83
- **Agents**: Security
- **File**: src/codec2/index.ts:656, 674
- **Evidence**: `encode(value, true)` returns `encodeBuf.subarray(0, end)` — a live alias. Next `encode()` call overwrites the buffer. Caller holding old reference reads new data. Data integrity + potential confidentiality issue in async pipelines.

### F-006: for...in / Object.keys mismatch — unbounded schema registry growth
- **Category**: security + optimize
- **Priority**: P0 — Score: 118
- **Agents**: Security, Performance
- **File**: src/codec2/index.ts:576
- **Evidence**: `matchSchema` counts keys with `for (let _ in obj)` (includes inherited). `inferAndRegister` uses `Object.keys(obj).sort()` (own-only). For objects with inherited enumerable props, keyCount is inflated → cache never matches → new schema registered + JIT-compiled on every encode. Memory + CPU DoS.

### F-007: FNV-1a 32-bit hash collision — silent data corruption
- **Category**: security
- **Priority**: P0 — Score: 69 → upgraded to P0 due to severity
- **Agents**: Security, Testing
- **File**: src/codec2/index.ts:119-124
- **Evidence**: `inferAndRegister` looks up by hash only — `if (existing) return existing` without verifying fields match. Birthday problem: ~65K distinct schemas for 50% collision probability. Deliberate collision: attacker sends two shapes with same hash → wrong encoder/decoder used for one shape → silent data corruption.

### F-008: decodeTagEnd default — unknown tag advances 1 byte, cascading misalignment
- **Category**: correctness
- **Priority**: P0 — Score: 80
- **Agents**: Correctness, Testing
- **File**: src/codec2/index.ts:364-366
- **Evidence**: Unknown tag byte returns `offset + 1`. In array decode, this causes subsequent elements to be read from wrong positions — cascading garbage for all remaining elements. No error thrown.

---

## Findings — P1 (This Sprint)

### F-009: readShortStrAscii — concat loop for lengths 5-16
- **Category**: optimize
- **Priority**: P1 — Score: 70
- **Agents**: Performance
- **File**: src/codec2/platform.ts:28-43
- **Evidence**: Lengths 5-16 use per-character `String.fromCharCode` in a concat loop. Multi-argument `String.fromCharCode(c0, c1, ..., cN)` is significantly faster. ~20-25% improvement on short ASCII string decode (most real-world keys/IDs).

### F-010: Double Number.isInteger in encodeSbc numeric array scan
- **Category**: optimize
- **Priority**: P1 — Score: 60
- **Agents**: Performance
- **File**: src/codec2/index.ts:441-513
- **Evidence**: The classification loop calls `Number.isInteger(v)` twice per element (once for allUint8, once for allInt32). Store result in a local. ~10-12% on numeric array encode.

### F-011: decodeSbc tag-7 double tag dispatch per element
- **Category**: optimize
- **Priority**: P1 — Score: 55
- **Agents**: Performance
- **File**: src/codec2/index.ts:237-248
- **Evidence**: Each array element triggers two switch dispatches: `decodeTagEnd` reads tag → `decodeSbc` reads tag again. A combined decode-and-advance would halve tag dispatch overhead. ~12% on mixed array decode.

### F-012: writeUtf8 browser path allocates via TextEncoder.encode
- **Category**: optimize
- **Priority**: P1 — Score: 48
- **Agents**: Performance
- **File**: src/codec2/platform.ts:152-158
- **Evidence**: Browser path creates a new `Uint8Array` per string via `textEncoder.encode()`. Should use `textEncoder.encodeInto(str, target.subarray(off))` for zero-alloc. ~15% browser string encode.

### F-013: getDv browser path — WeakMap lookup per numeric field
- **Category**: optimize
- **Priority**: P1 — Score: 45
- **Agents**: Performance
- **File**: src/codec2/platform.ts:97-107
- **Evidence**: Every `readF64`/`writeF64` call in browser triggers `dvCache.get(ab)` + `byteLength` comparison. Cache the DataView at a higher level (per encodeBuf allocation). ~10-15% browser encode/decode for float/date/bigint fields.

### F-014: Dead code — readU16, writeU16, readU32, writeU32, readUtf8 (unused imports/exports)
- **Category**: loc
- **Priority**: P1 — Score: 43
- **Agents**: Architecture
- **File**: src/codec2/platform.ts, src/codec2/index.ts:5
- **Evidence**: 5 exported symbols imported by index.ts but never called. ~38 LOC removable across declarations + import line.

### F-015: Dead code — compileComputeSize + hasVariable + needsTagEnd
- **Category**: loc
- **Priority**: P1 — Score: 40
- **Agents**: Architecture, Testing
- **File**: src/codec2/codegen.ts:39,45,166,282-300
- **Evidence**: `compileComputeSize` writes to `schema.computeSize` which is never read. `hasVariable` and `needsTagEnd` are set but never consumed. ~33 LOC removable.

---

## Findings — P2 (Excluded, backlog)

- `-0` classified as uint8 (known, Impact 3)
- `codegenDriver.readU32` Node.js missing parens (latent — unused helper)
- `getDv` undefined on Node.js (latent — never called)
- `inferType` uint16 range untested as schema field (coverage gap)
- `int8/int16/uint32` dead codegen branches (coverage gap for unreachable code)
- Schema/SchemaRegistry type-only exports with 0 consumers (zero runtime cost)
- Multiple testing gaps (packed array tag assertions, UTF-8 in schema strings, etc.)

---

## Test Coverage Gaps (actionable, from Testing agent)

These are the highest-value missing tests that would catch real bugs:

1. **Schema-compiled object with UTF-8 string field** — `{ label: 'こんにちは' }` round-trip through compiled path
2. **Packed array wire tag assertions** — verify `[0,1,255]` encodes as tag 12, `[256,-1]` as tag 14, `[1.1,2.2]` as tag 13
3. **decode with trailing garbage bytes** — `decode(extendedBuf, originalLen)` to verify length parameter
4. **readShortStrAscii non-ASCII bail** — encode `'é'` (2 UTF-8 bytes) and verify fallback to TextDecoder
5. **decodeTagEnd unknown tag** — manually corrupt a tag byte, verify decode produces null (not crash)
6. **matchSchema type-check positive test** — after bug fix, `{ value: 'hello' }` then `{ value: 42 }` should both round-trip

---

## Implementation Batches

### Batch 1: Critical Correctness + Security (F-001 through F-008) — 8 findings

**Priority**: Immediate — these are data corruption and DoS bugs.

1. **F-000**: Fix `matchSchema` ring buffer — also compare value types against cached schema field types
2. **F-006**: Fix `matchSchema` — replace `for (let _ in obj)` with `Object.keys(obj).length`
3. **F-001**: Fix `compileEncoder` array path — add `allNumber` tracking, fall to generic tag-0 when false
3. **F-002**: Upgrade array count from u16 to u32 (or throw on >65535)
4. **F-003**: Upgrade string byte-length from u16 to u32 (or throw on >65535)
5. **F-004**: Add depth parameter to `decodeSbc` + `decodeTagEnd`, cap at 64
6. **F-005**: Document view:true borrow semantics or remove the parameter
7. **F-007**: Verify schema fields match after hash lookup in `inferAndRegister`
8. **F-008**: Throw error on unknown tag in `decodeTagEnd` instead of advancing 1 byte

### Batch 2: Performance + Dead Code (F-009 through F-015) — 7 findings

1. **F-009**: Expand readShortStrAscii switch to cover lengths 5-16 with multi-arg fromCharCode
2. **F-010**: Cache Number.isInteger result in encodeSbc array scan
3. **F-011**: Merge decodeTagEnd + decodeSbc into single decode-and-advance
4. **F-012**: Use TextEncoder.encodeInto in browser writeUtf8 path
5. **F-013**: Cache DataView at encodeBuf allocation level
6. **F-014**: Remove unused readU16/writeU16/readU32/writeU32/readUtf8 imports + declarations
7. **F-015**: Remove compileComputeSize, hasVariable, needsTagEnd dead code

## Next Steps

```
/spec-implementation storage/audit-codec2-2026-04-08.md --filter "Batch 1"
```

---

## Convergence Status

### Per-Category
| Category | Runs | Last | Yield | Status |
|----------|------|------|-------|--------|
| correctness | 1 | ok | [6] | INSUFFICIENT_DATA |
| security | 1 | ok | [4] | INSUFFICIENT_DATA |
| performance | 1 | ok | [7] | INSUFFICIENT_DATA |
| architecture | 1 | ok | [7] | INSUFFICIENT_DATA |
| testing | 1 | ok | [14] | INSUFFICIENT_DATA |

### Overall: INSUFFICIENT_DATA
First run — all categories need 2+ successful runs for convergence estimation.
