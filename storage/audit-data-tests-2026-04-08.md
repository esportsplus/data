# Test Audit — @esportsplus/data

- **Status**: COMPLETE
- **Date**: 2026-04-08
- **Project**: @esportsplus/data
- **Commit**: d3d0154
- **Mode**: test-directory audit (tests/ explicit target — Testing agent only)
- **Run**: 3

## Scope

Test-directory audit: user explicitly passed `tests/`. Only Testing agents dispatched.

| Metric | Count |
|--------|-------|
| Total test files | 34 (29 test + 5 bench) |
| Total test LOC | ~13,946 |
| Source files covered | 83 |
| Source exported symbols | ~95 (functions/values) + types |

## Agent Dispatch Plan

| Agent | Symbols | Sub-targets | Max/target |
|-------|---------|-------------|------------|
| Testing | 37 | 4 | 10 |

## Agent Runs

| Batch | Target | Agent | Status | Findings |
|-------|--------|-------|--------|----------|
| 1 | sbc-core | testing-1 | ok | 4 raw → 1 valid |
| 1 | sbc-internals | testing-2 | ok | 5 raw → 3 valid |
| 1 | compiler-proto | testing-3 | ok | 8 raw → 1 valid |
| 1 | codec-validators | testing-4 | ok | 3 raw → 3 valid |

## Summary

- Audit agents dispatched: 4 (all testing) + 1 judge
- **Audit mode**: re-run (test-directory focus, run 3)
- Symbol coverage (testing): 37 / 37 (100%)
- **Total findings** (post-judge): 8
- Findings rejected by judge: 12
- Findings by category: coverage 1 | test-quality 7
- Findings by priority: P0 3 | P1 5 | P2 0
- Estimated total LOC delta: +120 / -0

### Prior Finding Disposition

| Prior ID | Status | Reason |
|----------|--------|--------|
| F-006 | INVALID | Tag-8 fast path exercised by every decode call |
| F-007 | INVALID | Test at sbc.ts:1737 exercises nullable non-null extractField |
| F-008 | INVALID | proto-runtime.ts has behavioral tests for identical varint logic |
| F-009 | INVALID | Zigzag exercised via compressed codec path; proto-runtime has local tests |
| F-010 | Superseded | Replaced by F-003 (deserializeRegistry) — different scope now |
| F-011 | Superseded | createSchemaStore tested via sbc-schema-store.ts |
| F-012 | Superseded | createInternPool tested via sbc-schema-store.ts |
| F-013 | INVALID | Nullable extractField has dedicated test at sbc.ts:1714 |

## SQALE Technical Debt Rating

**Grade: C** (3 P0 findings)

| Grade | Criteria |
|-------|---------|
| A | 0 P0, <= 3 P1 |
| B | 0 P0, 4-10 P1 |
| C | 0 P0, 11-25 P1 OR 1+ P0 |
| D | 2-5 P0 OR 25+ P1 |
| E | 6+ P0 |

---

## Findings (Post-Judge) — 8 Valid

### F-001: compileCompressedEncoder/Decoder — multi-boolean (>8) bitmap boundary untested
- **Category**: test-quality
- **File**: src/sbc/codegen.ts
- **Symbol**: compileCompressedEncoder, compileCompressedDecoder
- **Confidence**: HIGH
- **Priority**: P0 (score: 99)
- **Evidence**: `boolBitmapBytes = Math.ceil(boolCount / 8)` at codegen.ts:971. When boolCount > 8, boolBitmapBytes = 2 and the encoder emits `b[_bbp+1]=(_bb>>>8)&0xFF`. Decoder at line 695 does `let _bb=b[p]|(b[p+1]<<8)`. All compressed tests use max 4 booleans (sbc.ts:1992). The 2-byte bitmap path is dead code in tests.
- **Specific gap**: defineSchema with 9+ boolean fields, encode/decode round-trip asserting 9th boolean (index 8) survives. Exercises `boolBitmapBytes === 2` in both encoder and decoder.

### F-002: Negative bigint roundtrip untested in proto runtime helpers
- **Category**: test-quality
- **File**: src/compiler/proto/runtime.ts
- **Symbol**: _writeBigInt, _readBigInt
- **Confidence**: HIGH
- **Priority**: P0 (score: 93)
- **Evidence**: `_writeBigInt` has explicit negative branch `if (v < 0n)` (runtime.ts:17-24). `_bigIntVarintSize` tests `-1n === 10` but roundtrip describe block (lines 480-527) only tests non-negative values. The judge notes `_readBigInt` may not apply sign reconstruction, making this potentially a correctness bug, not just a test gap.
- **Specific gap**: Write `-1n` through `_writeBigInt` → `_readBigInt` and assert value roundtrips. If it doesn't, this is a correctness bug.

### F-003: iso.dateTime doesn't test rejection of timezone-suffixed strings
- **Category**: test-quality
- **File**: src/validators/iso.ts
- **Symbol**: iso.dateTime
- **Confidence**: HIGH
- **Priority**: P0 (score: 83)
- **Evidence**: `DATE_TIME_REGEX` ends with `$` and has no timezone group. Tests (validators-format.ts:1329-1355) have only 4 cases. No test asserts that `'2024-01-15T14:30:00Z'` or `'2024-01-15T14:30:00+05:30'` is rejected by dateTime (which accepts only local datetime, not RFC 3339).
- **Specific gap**: `expectFail(iso.dateTime(), '2024-01-15T14:30:00Z')` and `expectFail(iso.dateTime(), '2024-01-15T14:30:00+05:30')`.

### F-004: extractField with compressed (tag-18) buffer not tested
- **Category**: test-quality
- **File**: src/sbc/index.ts
- **Symbol**: extractField
- **Confidence**: HIGH
- **Priority**: P1 (score: 79)
- **Evidence**: All extractField tests use non-compressed codecs. Source at index.ts:1580 checks `buffer[0] !== 8 && buffer[0] !== 18`. Compressed codec tests (lines 1906-2043) never call extractField.
- **Specific gap**: `createCodec({ compress: true })` + defineSchema with numeric fields → encode → extractField(encoded, 'fieldName') where encoded[0] === 18.

### F-005: uuid v2, v3, v5, v6, v8 variants have zero test coverage
- **Category**: coverage
- **File**: src/validators/uuid.ts
- **Symbol**: uuid.v2, uuid.v3, uuid.v5, uuid.v6, uuid.v8
- **Confidence**: HIGH
- **Priority**: P1 (score: 63)
- **Evidence**: validators-format.ts tests only uuid(), uuid.v1(), uuid.v4(), uuid.v7(). The factory() function builds per-version regex for all 8 versions — 5 variants have zero test references.
- **Specific gap**: Tests for uuid.v2/v3/v5/v6/v8 — pass with valid UUID of that version, fail with UUID of different version.

### F-006: cache.get — SIEVE visited flag not verified for eviction survival
- **Category**: test-quality
- **File**: src/sbc/cache.ts
- **Symbol**: cache.get
- **Confidence**: MEDIUM
- **Priority**: P1 (score: 59)
- **Evidence**: Tests check get/set happy path (sbc-schema-store.ts:17-43). `get()` sets `entry.visited = true` at cache.ts:78. `evictOne()` checks `o.visited` at line 38. No test verifies that a recently-accessed entry survives eviction.
- **Specific gap**: Fill cache near maxSize, get() one entry, fill past maxSize to trigger eviction, assert the get()-ed entry survives.

### F-007: cache.set — eviction at maxSize=1024 boundary not tested
- **Category**: test-quality
- **File**: src/sbc/cache.ts
- **Symbol**: cache.set
- **Confidence**: MEDIUM
- **Priority**: P1 (score: 55)
- **Evidence**: maxSize = 1024 at cache.ts:27. `while (map.size >= maxSize) evictOne()` at line 93 never triggered in tests.
- **Specific gap**: Call cache.set 1025 times, assert map.size <= 1024 and most-recent entry retrievable.

### F-008: codec() untransformed throw path never tested
- **Category**: test-quality
- **File**: src/codec.ts
- **Symbol**: codec
- **Confidence**: HIGH
- **Priority**: P1 (score: 43)
- **Evidence**: src/codec.ts:11-14 throws when called without compile-time transform. No test imports codec directly and asserts the throw.
- **Specific gap**: `import { codec } from '../src/codec'; expect(() => codec()).toThrow('must be transformed at compile-time')`.

---

## Convergence Status

### Per-Category
| Category | Runs | Last | Yield Curve | Status |
|----------|------|------|-------------|--------|
| testing | 3 | ok | 5, 8, 8 | NOT_CONVERGED |

### Overall: NOT_CONVERGED
Reason: testing category produced 8 new valid findings on run 3
Clean symbols at confidence >= 3: 0 / 37 (testing group)

### Recommendation
Re-run after implementing these findings. The testing category yield curve (5, 8, 8) is flat, not declining — additional runs may continue to find new gaps until coverage stabilizes.

---

## Implementation Batches

### Batch 1: P0 — Critical test gaps (3 findings)
- F-001: compileCompressedEncoder/Decoder multi-boolean >8 bitmap boundary
- F-002: Negative bigint roundtrip in proto runtime
- F-003: iso.dateTime timezone rejection boundary test

### Batch 2: P1 — sbc test gaps (3 findings)
- F-004: extractField compressed (tag-18) buffer
- F-006: SIEVE cache visited flag eviction test
- F-007: SIEVE cache maxSize eviction boundary test

### Batch 3: P1 — Validators + codec (2 findings)
- F-005: uuid v2/v3/v5/v6/v8 variant coverage
- F-008: codec() untransformed throw path

## Next Steps
```
/spec-implementation storage/audit-data-tests-2026-04-08.md --filter "Batch 1"
```
