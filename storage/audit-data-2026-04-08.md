# Code Audit: @esportsplus/data — src/sbc/

**Status**: COMPLETE
**Date**: 2026-04-08
**Commit**: d3d0154
**Mode**: incremental (re-run #3, 5 changed files + 1 new)
**Previous audit**: 2026-04-07 @ f4201f1

---

## Scope Reduction

| Metric | Count |
|--------|-------|
| Total project source files | 83 |
| Changed files (full audit) | 5 |
| New files | 1 (cache.ts) |
| Deleted files | 1 (registry.ts — resolved F-010..F-012) |
| Skipped (confidence >= 3) | 0 (all file hashes changed in refactor) |
| In scope | 5 |
| Reduction | 94% |

## Agent Dispatch

| Agent | Symbols | Sub-targets | Status | Findings |
|-------|---------|-------------|--------|----------|
| Correctness | 14 | 1 | ok | 4 |
| Security | 11 | 1 | ok | 4 |
| Performance | 11 | 1 | ok | 7 (2 valid) |
| Architecture | 39 | 1 | ok | 3 (2 valid) |
| Testing | 10 | 1 | ok | 10 (8 valid) |

## Judge Validation

| Raw | Verdict | Reason |
|-----|---------|--------|
| P-F1 | INVALID | Cold path — buffer grows geometrically, amortized negligible |
| P-F2 | INVALID | 2 structurally different locations, below 3+ dedup threshold |
| P-F4 | INVALID | <10% for realistic workloads (isInteger is very fast) |
| P-F6 | INVALID | <10% — property access vs variable read ~1ns |
| P-F7 | INVALID | Browser-only cold path for Node-first project |
| A-F3 | INVALID | ParsedType has consumer: index.ts imports it |
| T-F9 | MERGED → F-016 | Combined compressed mode test gaps |
| T-F10 | MERGED → F-016 | Combined compressed mode test gaps |

---

## Summary

- Audit agents dispatched: 5 (correctness: 1, security: 1, performance: 1, architecture: 1, testing: 1, gap re-dispatch: 0)
- **Audit mode**: incremental (5 changed, 0 probabilistic, 0 skipped)
- Files audited: 5 / 5 (100%)
- **Symbol coverage by group**:
  - Correctness: 14/14 (100%)
  - Security: 11/11 (100%)
  - Performance: 11/11 (100%)
  - Architecture: 39/39 (100%)
  - Testing: 10/10 (100%)
- **Total findings** (post-judge): 19
- Findings merged by judge: 2
- Findings rejected by judge: 5
- Multi-agent agreement findings: 0
- Findings by category: correctness 4 | security 4 | optimize 2 | loc 2 | coverage 5 | test-quality 2
- Findings by priority: P0 5 | P1 13 | P2 1 (excluded)
- Estimated total LOC delta: +80 / -10

## SQALE Technical Debt Rating

**Grade: D** (5 P0 findings)

| Grade | Criteria |
|-------|---------|
| A | 0 P0, <= 3 P1 |
| B | 0 P0, 4-10 P1 |
| C | 0 P0, 11-25 P1 OR 1 P0 |
| D | 2-5 P0 OR 25+ P1 |
| E | 6+ P0 |

---

## Findings

### F-001: `readVarint` CPU DoS via all-continuation-bit input [P0]
- **File**: src/sbc/platform.ts:220-232
- **Symbol**: `readVarint`
- **Category**: security
- **Severity**: HIGH
- **Confidence**: HIGH
- **Score**: 123
- **Attack vector**: Send a buffer of N bytes all set to `0xFF`. `readVarint` loops N times before terminating (when `pos` exceeds buffer length, `buf[pos]` returns `undefined`, `!` coerces to `NaN`, `NaN & 0x80 = 0`, loop stops). A 10MB buffer = 10M iterations monopolizing the event loop.
- **Fix**: Add `if (shift >= 35) throw new Error('Codec2: varint overflow')` at loop top.

### F-002: `decodeTagEnd` unchecked end offsets for tags 5/6/12/13/14/17 [P0]
- **File**: src/sbc/index.ts:741-814
- **Symbol**: `decodeTagEnd`
- **Category**: security
- **Severity**: HIGH
- **Confidence**: HIGH
- **Score**: 119
- **Impact**: Tags 12/13/14 read u32 `count` and compute `offset + 5 + count * N` with NO `MAX_ARRAY_COUNT` guard — unlike `decodeSbc` which guards all count-based tags. Tags 5/6 return `offset + 5 + sLen` without bounds check. Crafted buffers cause OOM or billion-iteration loops.
- **Fix**: Add `if (count > MAX_ARRAY_COUNT) throw` for tags 12/13/14 (matching `decodeSbc`). Add `if (offset + 5 + sLen > buf.length) throw` for tags 5/6/17.

### F-003: `lastDecodeFn` stale pointer after tag-18 decode [P0]
- **File**: src/sbc/index.ts:1211-1256
- **Symbol**: `decode`
- **Category**: correctness
- **Confidence**: HIGH
- **Score**: 103
- **Path**: (1) `decode(bufA)` tag-8 schema A → sets `lastDecodeHash=A, lastDecodeFn=fn_A`. (2) `decode(bufB, {schema:specB})` tag-18 schema B → sets `lastDecodeHash=B` but NOT `lastDecodeFn`. (3) `decode(bufB_plain)` tag-8 schema B → line 1232: `B === lastDecodeHash && lastDecodeFn` → true with stale `fn_A` → schema A's decoder runs on schema B data → corrupt output.
- **Fix**: After tag-18 paths (lines 1215, 1259), set `lastDecodeFn = null`.

### F-004: `matchSchema` for-in key counting + redundant WeakMap lookup [P0]
- **File**: src/sbc/index.ts:1131-1194
- **Symbol**: `matchSchema`
- **Category**: optimize
- **Confidence**: HIGH
- **Score**: 103
- **Hot path**: Every encode of a new object (WeakMap miss) calls `matchSchema`. (1) `for (let _ in obj)` at line 1142 traverses prototype chain — use `Object.keys(obj).length`. (2) `weakCache.get(obj)` at line 1133 always misses — all callers (encodeObj:446, encodeSbc:1085, encode:1344, computeSize:1884) already check `weakCache.get` before calling. Remove redundant lookup.
- **Estimated improvement**: 10-15%

### F-005: `readVarint` allocates [number, number] tuple per call [P0]
- **File**: src/sbc/platform.ts:220-232
- **Symbol**: `readVarint`
- **Category**: optimize
- **Confidence**: HIGH
- **Score**: 99
- **Hot path**: `readVarint` is passed as a bound parameter to JIT-compiled decoders (codegen.ts) and called in `extractField` variable scan (index.ts:1669, 1677, 1688). Every string/bytes/array field decode allocates a 2-element array.
- **Fix**: Replace with module-level mutable output (`let _vVal = 0, _vPos = 0`) and void-returning `readVarintInto(buf, pos)`, or inline at call sites. Related: F-001.

### F-006: `matchSchema` ring-buffer false positive for structural element types [P1]
- **File**: src/sbc/index.ts:1157-1168
- **Symbol**: `matchSchema`
- **Category**: correctness
- **Confidence**: MEDIUM
- **Score**: 79
- **Path**: Ring buffer compares `f.type` (base type 'array') not element types. Schema for `array<string>` matches an object with `[1,2,3]` because `inferType([1,2,3]) = 'array'`. Wrong compiled encoder is used → corrupt output or crash.
- **Fix**: For fields with `elementType` or `refHash`, compare `f.rawType` instead of `f.type`.
- **Related**: F-007

### F-007: `typedSchemas` last-writer-wins on shared name-hash [P1]
- **File**: src/sbc/index.ts:1544-1546
- **Symbol**: `defineSchema`
- **Category**: correctness
- **Confidence**: MEDIUM
- **Score**: 83
- **Path**: `computeNameHash(keys)` hashes only field names. Two schemas with same names but different types (e.g., `{data: 'array<string>'}` vs `{data: 'array<uint8>'}`) produce the same `nameHash`. Second `defineSchema` overwrites first in `typedSchemas` Map.
- **Fix**: Use `computeShapeHash` (includes types) as the key, or a `nameHash→[schemas]` multimap.
- **Related**: F-006

### F-008: `encode(view=true)` returns alias of shared mutable `encodeBuf` [P1]
- **File**: src/sbc/index.ts:1330-1331, 1393-1394, 1412-1413
- **Symbol**: `encode`
- **Category**: security
- **Severity**: MEDIUM
- **Confidence**: HIGH
- **Score**: 79
- **Impact**: `view=true` returns `encodeBuf.subarray(0, end)` — a live alias. Next `encode()` call overwrites the content. In pipelined server code, one client's data leaks into another's response.
- **Fix**: Document borrow semantics clearly, or remove view mode from public API.

### F-009: `deserializeRegistry` uncapped loop bounds — DoS [P1]
- **File**: src/sbc/index.ts:2003-2056
- **Symbol**: `deserializeRegistry`
- **Category**: security
- **Severity**: MEDIUM
- **Confidence**: HIGH
- **Score**: 79
- **Impact**: u16 `schemaCount` (max 65535) x u16 `fieldCount` (max 65535) = 4B iterations. No `pos >= data.length` bounds check — reads `undefined` bytes silently. Char-by-char string concat in name/type parsing is O(n^2).
- **Fix**: Cap `schemaCount` <= 1024, `fieldCount` <= 64, `nameLen`/`typeLen` <= 256. Add `pos` bounds checks.

### F-010: `serializeRegistry`/`deserializeRegistry` truncate non-Latin-1 field names [P1]
- **File**: src/sbc/index.ts:2108-2116, 2019-2027
- **Symbol**: `serializeRegistry`, `deserializeRegistry`
- **Category**: correctness
- **Confidence**: MEDIUM
- **Score**: 49
- **Impact**: `charCodeAt` returns >255 for Unicode (e.g., U+03B1 = 945), stored as single byte truncated to `945 & 0xFF = 177`. Deserialized name differs → hash mismatch → schema not found.
- **Fix**: Use UTF-8 encoding for names/types, or validate ASCII-only.

### F-011: `zigzagDecode` dead export [P1]
- **File**: src/sbc/platform.ts:261, 306
- **Symbol**: `zigzagDecode`
- **Category**: loc
- **Confidence**: HIGH
- **Score**: 53
- **Evidence**: `grep -rn "zigzagDecode" --include="*.ts" | grep -v platform.ts` → 0 matches. Used only internally by `readZigzag`.

### F-012: `zigzagEncode` dead export [P1]
- **File**: src/sbc/platform.ts:266, 307
- **Symbol**: `zigzagEncode`
- **Category**: loc
- **Confidence**: HIGH
- **Score**: 53
- **Evidence**: `grep -rn "zigzagEncode" --include="*.ts" | grep -v platform.ts` → 0 matches. Used only internally by `writeZigzag`.

### F-013: Compressed mode (tag 18) untested across extractField, decodeAt, encode view+hint [P1]
- **File**: src/sbc/index.ts:1427, 1581, 1330
- **Symbol**: `extractField`, `decodeAt`, `encode`
- **Category**: test-quality
- **Confidence**: HIGH
- **Score**: 79
- **Gaps**: (1) `extractField` on tag-18 buffer untested. (2) `decodeAt` on tag-18 buffer untested. (3) `encode(value, {schema, view:true})` with `compress:true` untested.
- **Evidence**: `grep -r "extractField.*compress\|decodeAt.*compress\|compress.*view" tests/` → 0 matches.

### F-014: Map/Set DoS count guard (encode + decode) untested [P1]
- **File**: src/sbc/index.ts:947, 966, 657, 683
- **Symbol**: `encodeSbc`, `decodeSbc`
- **Category**: test-quality
- **Confidence**: HIGH
- **Score**: 73
- **Evidence**: `grep -r "map count\|set count" tests/` → 0 matches.

### F-015: Unknown typed array typeId error path untested [P1]
- **File**: src/sbc/index.ts:706
- **Symbol**: `decodeSbc`
- **Category**: coverage
- **Confidence**: HIGH
- **Score**: 73
- **Evidence**: `grep -r "unknown typed array typeId" tests/` → 0 matches.

### F-016: Typed array `byteLength not aligned` error path untested [P1]
- **File**: src/sbc/index.ts:711
- **Symbol**: `decodeSbc`
- **Category**: coverage
- **Confidence**: HIGH
- **Score**: 73
- **Evidence**: `grep -r "byteLength not aligned" tests/` → 0 matches.

### F-017: `deserializeRegistry` with corrupted/truncated input untested [P1]
- **File**: src/sbc/index.ts:2003
- **Symbol**: `deserializeRegistry`
- **Category**: coverage
- **Confidence**: MEDIUM
- **Score**: 69
- **Related**: F-009, F-010

### F-018: `computeSize` for bytes-type schema field untested [P1]
- **File**: src/sbc/index.ts:1936
- **Symbol**: `computeSize`
- **Category**: coverage
- **Confidence**: HIGH
- **Score**: 73
- **Evidence**: `grep -r "computeSize.*bytes\|bytes.*computeSize" tests/` → 0 matches.

---

## Stale Findings (from previous audit)

| Old ID | Status | Reason |
|--------|--------|--------|
| F-005 (textEncoder/readShortStr dead) | RESOLVED | Exports removed in refactor |
| F-010 (deserializeRegistry errors) | RESOLVED | registry.ts deleted |
| F-011 (createSchemaStore coverage) | RESOLVED | registry.ts deleted |
| F-012 (createInternPool coverage) | RESOLVED | registry.ts deleted |

---

## Implementation Batches

### Batch 1: Security hardening — 4 findings
- F-001: Add varint overflow guard in readVarint
- F-002: Add MAX_ARRAY_COUNT + bounds checks in decodeTagEnd
- F-005: Refactor readVarint to avoid tuple allocation (also fixes F-001)
- F-009: Cap deserializeRegistry loop bounds + add pos validation

### Batch 2: Correctness fixes — 4 findings
- F-003: Null lastDecodeFn after tag-18 decode paths
- F-006: Compare rawType in matchSchema ring buffer for structural fields
- F-007: Use shapeHash (not nameHash) as typedSchemas key
- F-010: Use UTF-8 encoding in serialize/deserializeRegistry

### Batch 3: Performance + dead code — 3 findings
- F-004: Replace for-in with Object.keys().length + remove redundant WeakMap lookup
- F-011: Remove zigzagDecode from exports
- F-012: Remove zigzagEncode from exports

### Batch 4: Test coverage — 7 findings
- F-008: Add view mode documentation/safety
- F-013: Add compressed mode tests (extractField, decodeAt, encode view+hint)
- F-014: Add Map/Set count guard tests
- F-015: Add unknown typeId test
- F-016: Add misaligned byteLength test
- F-017: Add deserializeRegistry corruption test
- F-018: Add computeSize bytes field test

## Next Steps
```
/spec-implementation storage/audit-data-2026-04-08.md --filter "Batch 1"
```
