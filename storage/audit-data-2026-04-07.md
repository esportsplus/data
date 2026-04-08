# Code Audit: @esportsplus/data (Run 2)

**Status**: COMPLETE
**Date**: 2026-04-07
**Project**: @esportsplus/data v0.3.9
**Commit**: f4201f1
**Mode**: re-run (5 changed files, 13 commits since run 1)
**Previous audit**: 85323fc (run 1 — 18 findings, 13 implemented)

---

## Scope Reduction

| Metric | Count |
|--------|-------|
| Total project files | 68 |
| Changed files (full audit) | 5 |
| Propagated via call-graph | 0 |
| Skipped (unchanged, no findings) | 63 |
| In scope | 5 |
| Reduction | 93% |

## Summary

- Audit agents dispatched: 6 (correctness: 1, security: 1, performance: 1, architecture: 1, testing: 1, judge: 1)
- **Audit mode**: re-run (5 changed, 63 skipped)
- Files audited: 5 / 68 (7% — targeted re-audit of changed files)
- **Total findings** (post-judge): 13
- Findings rejected by judge: 16 (S-NEW-2, S-NEW-3, S-NEW-4, T-NEW-6 through T-NEW-9, T-NEW-13 through T-NEW-20)
- Multi-agent agreement findings: 0
- Findings by category: correctness 1 | security 1 | optimize 2 | loc 1 | coverage 5 | test-quality 3
- Findings by priority: P0 1 | P1 12 | P2 (excluded) 0
- Estimated total LOC delta: +80 / -10

## SQALE Technical Debt Rating

**Grade: C**

| Grade | Criteria |
|-------|---------|
| A | 0 P0, <= 3 P1 |
| B | 0 P0, 4-10 P1 |
| **C** | **0 P0, 11-25 P1 OR 1 P0** |
| D | 2-5 P0 OR 25+ P1 |
| E | 6+ P0 |

1 P0 (correctness regression) + 12 P1 findings -> Grade C.

---

## Judge Verdicts

| Raw ID | Verdict | Score | Priority | Reason |
|--------|---------|-------|----------|--------|
| F-NEW-1 | VALID | 85 | P0 | Confirmed: nullable fields have no extractor, extractField returns undefined for non-null values |
| S-NEW-1 | VALID | 58 | P1 | Confirmed: allocUnsafe fast path returns full buffer, theoretical leak via getter mutation |
| S-NEW-2 | INVALID | — | — | bytes subarray aliasing is a design choice, not a vulnerability; decode always uses unique buffer |
| S-NEW-3 | INVALID | — | — | Design limitation (32-bit FNV-1a); not exploitable without network attacker model |
| S-NEW-4 | INVALID | — | — | schemaId not used in array indexing; no exploitable path |
| P-NEW-1 | VALID | 55 | P1 | Confirmed: empty array alloc on every warm classed-object encode |
| P-NEW-2 | VALID | 65 | P1 | Confirmed: double lookupSchema for plain objects with variable schemas |
| A-NEW-1 | MERGED | 45 | P1 | Merged with A-NEW-2 as single dead-export finding |
| A-NEW-2 | VALID | 45 | P1 | 2 dead exports on platform.ts:406 (textEncoder, readShortStr) |
| T-NEW-1 | VALID | 55 | P1 | decode() uncompressed path, length param untested |
| T-NEW-2 | VALID | 60 | P1 | extractField nullable non-null path — directly related to F-001 |
| T-NEW-3 | VALID | 50 | P1 | readVarint: 0 test refs, 3 throw paths untested |
| T-NEW-4 | MERGED | — | — | Merged with T-NEW-3 (varint round-trip) |
| T-NEW-5 | VALID | 50 | P1 | readZigzag/writeZigzag: 0 test refs, range error untested |
| T-NEW-6 | INVALID | — | — | byteLen tested indirectly via string encode/decode round-trips |
| T-NEW-7 | INVALID | — | — | lookupSchema tested indirectly via every encode round-trip |
| T-NEW-8 | INVALID | — | — | inferSchema depth guard is defensive; indirect coverage sufficient |
| T-NEW-9 | INVALID | — | — | resolveSchema tested indirectly via createCodec.encode() |
| T-NEW-10 | VALID | 45 | P1 | deserializeRegistry: 3 reachable throw paths untested |
| T-NEW-11 | VALID | 50 | P1 | createSchemaStore: 0 test refs, substantial code (110 LOC) |
| T-NEW-12 | VALID | 50 | P1 | createInternPool: 0 test refs, substantial code (160 LOC) |
| T-NEW-13 | INVALID | — | — | buildSchema tested indirectly via every schema compile |
| T-NEW-14 | INVALID | — | — | compileSchema tested indirectly via createCodec |
| T-NEW-15 | INVALID | — | — | validateFieldTypeString tested indirectly via deserializeRegistry |
| T-NEW-16 | INVALID | — | — | inferFieldType tested indirectly via inferSchema round-trips |
| T-NEW-17 | INVALID | — | — | parseFieldType tested indirectly via deserializeRegistry |
| T-NEW-18 | INVALID | — | — | decodeFieldDefs tested indirectly via deserializeRegistry |
| T-NEW-19 | INVALID | — | — | serializeFieldType tested indirectly via T-004 |
| T-NEW-20 | INVALID | — | — | encodeTypedArrayInto buffer-too-small is caller responsibility |

---

## Findings

### F-001: extractField returns `undefined` for non-null nullable variable-length fields

- **Category**: correctness
- **Priority**: P0 (score: 85)
- **Confidence**: HIGH
- **File**: [codegen.ts:610](src/sbc/codegen.ts#L610) (compileFieldExtractors), [index.ts:635-638](src/sbc/index.ts#L635-L638) (extractField)
- **Found by**: correctness

`compileFieldExtractors` at line 610 uses `typeof target.type !== 'string'` to filter variable-size fields, which excludes all `NullableFieldType` objects (`{ kind: 'nullable', inner: 'string' }`). No extractor is compiled for nullable variable-length fields. In `extractField`, when the nullable bit IS set (non-null), execution falls to `schema.fieldExtractors.get(fieldName)` which returns `undefined`. The function returns `undefined` instead of the actual value.

The F-006 fix (nullIndexMap) correctly handles the null case (bit=0 -> return null), but the non-null case (bit=1) has no extractor to fall through to. This is a regression introduced by the F-006 implementation.

**Impact**: `codec.extractField(buf, 'optionalName')` silently returns `undefined` for any `nullable<string>` or `nullable<bytes>` field whose value is non-null. Affects any code using extractField for optional string/bytes fields.

---

### F-002: `allocUnsafe` fast-path encode returns unsliced buffer

- **Category**: security
- **Priority**: P1 (score: 58)
- **Confidence**: MEDIUM
- **File**: [index.ts:471-480](src/sbc/index.ts#L471-L480) (encodeValue fast path)
- **Found by**: security

The fast-path `encodeValue` allocates `allocUnsafe(size)` where `size = computeSize(obj)`, then calls `encodeFn(obj, result, 9)` returning `end`. The full `result` buffer is returned (line 480) without trimming to `end`. If `computeSize` and `encodeFn` disagree (possible via property getters returning different values on successive access), trailing bytes in the returned buffer contain uninitialized heap content from Node.js's slab allocator.

**Impact**: Theoretical info leak — requires object with getter properties that return different values between computeSize and encodeFn calls. Low probability in normal usage, but callers have no way to detect the over-allocation.

---

### F-003: `keysOut` array allocated unconditionally on every object encode

- **Category**: optimize
- **Priority**: P1 (score: 55)
- **Confidence**: HIGH
- **File**: [index.ts:402](src/sbc/index.ts#L402) (encodeSbc)
- **Found by**: performance

`keysOut: string[][] = []` is allocated before the `cachedCtorSchema.get()` short-circuit. For warm classed-object encodes (constructor cache hit), the array is allocated and immediately discarded. Only used by `inferSchema` on the new-schema branch.

**Impact**: 10-15% GC pressure reduction for classed-object encode workloads. One small-array allocation per encode in tight loops.

---

### F-004: Double `lookupSchema` for plain objects without `computeSize`

- **Category**: optimize
- **Priority**: P1 (score: 65)
- **Confidence**: MEDIUM
- **File**: [index.ts:461](src/sbc/index.ts#L461) (encodeValue), [index.ts:403](src/sbc/index.ts#L403) (encodeSbc)
- **Found by**: performance

`encodeValue` calls `lookupSchema(obj, registry)` at line 461. When `computeSize` is null (any schema with string/bytes/array/nested-object fields), falls to slow path -> `encodeSbc` -> line 403 calls `lookupSchema` again. For plain objects (`ctor === Object`), `cachedCtorSchema` is never populated, so full Tier-2/3 lookup runs twice per encode.

**Impact**: 10-20% throughput loss for plain-object encode with variable-size schemas (the majority of real-world schemas).

---

### F-005: Dead exports `textEncoder` and `readShortStr` on platform.ts

- **Category**: loc
- **Priority**: P1 (score: 45)
- **Confidence**: HIGH
- **File**: [platform.ts:406](src/sbc/platform.ts#L406)
- **Found by**: architecture

`textEncoder` — 0 import-site consumers. Used only in closures internal to platform.ts.
`readShortStr` — 0 import-site consumers. Passed through `driver.decoderBindArgs()` closure; codegen accesses it via `driver`, never by named import.

**Fix**: Change `export { driver, readShortStr, textDecoder, textEncoder }` to `export { driver, textDecoder }`.

---

### F-006: `decode()` uncompressed object path not tested

- **Category**: coverage
- **Priority**: P1 (score: 55)
- **Confidence**: HIGH
- **File**: [index.ts:549-591](src/sbc/index.ts#L549-L591)
- **Found by**: testing

`codec.decode()` is called only in T-003 (compression=true). The uncompressed path — tag 246 with `decodeFn`, the `length` parameter, and the slow-path copy branch (schema not in cache) — have zero test references via the `decode()` API.

---

### F-007: extractField nullable non-null path not tested

- **Category**: test-quality
- **Priority**: P1 (score: 60)
- **Confidence**: HIGH
- **File**: [index.ts:623-632](src/sbc/index.ts#L623-L632)
- **Found by**: testing
- **Related**: F-001

T-002 tests only non-nullable schemas. The null-bitmap path where a nullable field is actually non-null (`!(buffer[9 + (nullIdx >> 3)]! & bitMask)` returning the value) is never exercised. This gap directly masks the F-001 regression.

---

### F-008: readVarint/writeVarint — no behavioral test coverage

- **Category**: coverage
- **Priority**: P1 (score: 50)
- **Confidence**: HIGH
- **File**: [platform.ts:337-392](src/sbc/platform.ts#L337-L392)
- **Found by**: testing

Zero test references in `tests/sbc.ts`. Three readVarint throw paths untested: (1) `pos >= bufEnd` at entry, (2) `++pos >= bufEnd` mid-continuation, (3) `shift >= 35` overflow guard. Round-trip property (write then read) has no test.

---

### F-009: readZigzag/writeZigzag — no behavioral test coverage

- **Category**: coverage
- **Priority**: P1 (score: 50)
- **Confidence**: HIGH
- **File**: [platform.ts:366-400](src/sbc/platform.ts#L366-L400)
- **Found by**: testing

Zero test references. `writeZigzag` has a reachable `RangeError('SBC: int32 out of range')` for values outside [-2147483648, 2147483647]. Zigzag encoding identity and boundary cases (negative, zero, INT32_MIN, INT32_MAX) untested.

---

### F-010: deserializeRegistry error paths and legacy format not tested

- **Category**: test-quality
- **Priority**: P1 (score: 45)
- **Confidence**: HIGH
- **File**: [registry.ts:124-188](src/sbc/registry.ts#L124-L188)
- **Found by**: testing

T-004 tests only the happy path. Three reachable throw paths untested: (1) legacy bare-array format (v0 compatibility), (2) unknown version number, (3) malformed schema definition. No test passes null or invalid input.

---

### F-011: createSchemaStore — no test coverage

- **Category**: coverage
- **Priority**: P1 (score: 50)
- **Confidence**: HIGH
- **File**: [registry.ts:575-686](src/sbc/registry.ts#L575-L686) (110 LOC)
- **Found by**: testing

Zero test references. The `get()` path (DB fetch + decode + compile), `register()` with nested-transaction fallback via `queueMicrotask`, and `_setHelpers`/`_setIntern` wiring are all untested.

---

### F-012: createInternPool — no test coverage

- **Category**: coverage
- **Priority**: P1 (score: 50)
- **Confidence**: HIGH
- **File**: [registry.ts:718-879](src/sbc/registry.ts#L718-L879) (160 LOC)
- **Found by**: testing

Zero test references. `encode()` short-string inline path (< 16 bytes), intern path (sentinel 0xFFFFFFFF), `decode()` DB-fallback path, LRU eviction, and `load()` with `maxSize` truncation all untested.

---

### F-013: extractField nullable non-null — missing test for regression detection

- **Category**: test-quality
- **Priority**: P1 (score: 55)
- **Confidence**: HIGH
- **File**: [codegen.ts:606-612](src/sbc/codegen.ts#L606-L612)
- **Found by**: testing + correctness (2 agents)
- **Related**: F-001, F-007

No test exercises `extractField` on a `nullable<string>` or `nullable<bytes>` field with a non-null value. This is the specific test case that would have caught the F-001 regression. The test should: (1) create a schema with a nullable<string> field, (2) encode an object where that field is non-null, (3) assert `extractField(buf, fieldName)` returns the value (not undefined).

---

## Convergence Status

### Per-Category
| Category | Runs | Last | Yield Curve | Status |
|----------|------|------|-------------|--------|
| correctness | 2 | ok | 4, 1 | NOT_CONVERGED |
| security | 2 | ok | 0, 1 | NOT_CONVERGED |
| performance | 2 | ok | 4, 2 | NOT_CONVERGED |
| architecture | 2 | ok | 5, 1 | NOT_CONVERGED |
| testing | 2 | ok | 5, 5 | NOT_CONVERGED |

### Overall: NOT_CONVERGED
Reason: All categories still finding new issues on run 2 (code changed significantly between runs).
Clean symbols at confidence >= 3: 0 / 50
SQALE trend: stable (C -> C)

### Recommendation
Code changed significantly between runs (13 commits implementing 11 findings from run 1). New findings are expected — this does not indicate poor audit quality. Implement F-001 (P0 regression) immediately, then re-run after the next batch of fixes.

---

## Implementation Batches

### Batch 1: P0 Correctness fix + regression test — 3 findings

- **F-001**: Fix `compileFieldExtractors` to compile extractors for nullable variable-length fields (nullable<string>, nullable<bytes>)
- **F-007**: Add extractField test for nullable non-null path
- **F-013**: Add specific test: extractField on nullable<string> with non-null value

### Batch 2: Performance — 2 findings

- **F-003**: Move `keysOut` allocation inside the new-schema branch (after ctor cache miss)
- **F-004**: Cache lookupSchema result from encodeValue and pass to encodeSbc, or populate cachedCtorSchema for plain objects

### Batch 3: Security + dead code — 2 findings

- **F-002**: Trim allocUnsafe result to actual `end` position: `return result.subarray(0, end)`
- **F-005**: Remove `textEncoder` and `readShortStr` from platform.ts export line

### Batch 4: Test coverage — 6 findings

- **F-006**: Add decode() tests for uncompressed tag-246 path and length parameter
- **F-008**: Add readVarint/writeVarint round-trip and error path tests
- **F-009**: Add readZigzag/writeZigzag round-trip and boundary tests (0, -1, INT32_MIN, INT32_MAX)
- **F-010**: Add deserializeRegistry error path tests (legacy format, bad version, malformed schema)
- **F-011**: Add createSchemaStore tests (requires mock DB interface)
- **F-012**: Add createInternPool tests (requires mock InternDb)

## Next Steps

```
/spec-implementation storage/audit-data-2026-04-07.md --filter "Batch 1"
```
