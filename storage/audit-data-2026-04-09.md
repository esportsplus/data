# Audit: @esportsplus/data — 2026-04-09

**Status**: COMPLETE
**Date**: 2026-04-09
**Project**: @esportsplus/data
**Commit**: d5db57c
**Mode**: Incremental (src/sbc/ re-audit) + First-time (src/compiler/, src/ root, src/validators/)
**Run**: 5

---

## Scope Reduction

| Metric | Count |
|--------|-------|
| Total project source files | 75 |
| Changed files (full re-audit) | 2 (sbc/index.ts, sbc/platform.ts) |
| First-time audit files | 73 (compiler/, validators/, root) |
| Skipped (confidence >= 3) | 0 |
| In scope | 75 |

---

## Summary

- Audit agents dispatched: 12 (correctness: 3, security: 2, performance: 1, architecture: 3, testing: 3)
- **Audit mode**: incremental (2 changed) + first-time (73 files)
- Files audited: 75 / 75 (100%)
- **Total findings** (post-judge): 33 (8 new correctness, 1 new security, 4 new performance, 4 new architecture, 14 new testing, + 8 re-verified existing = 26 open existing)
- Findings invalidated by judge: 1 (C4 — trailing comma fabricated)
- Findings merged by judge: 3 (S2→C5, T10-12→T-VALIDATORS-API, T15-17→T-TYPED-ARRAY-CODEC)
- Multi-agent agreement: 1 (validators.inline flagged by correctness + security)
- Findings by category: correctness 7 | security 1 | optimize 4 | loc 0 | dedup 3 | reorg 2 | coverage 2 | test-quality 12 | deps 0
- Findings by priority: **P0: 8** | P1: 23 | P2 (excluded): 2

## SQALE Technical Debt Rating

**Grade: D**

| Grade | Criteria |
|-------|---------|
| D | 2-5 P0 OR 25+ P1 |

8 P0 findings: 3 correctness bugs in proto runtime, 1 correctness in validators.inline, 1 correctness in type-analyzer, 3 performance in generated runtime code.

---

## Findings — P0 (Fix Immediately)

### F-027: _readVarint negative int32 corruption
- **File**: src/compiler/proto/runtime.ts:234-251
- **Symbol**: buildRuntimeHelpers (HELPER_VARINT → _readVarint)
- **Category**: correctness
- **Evidence**: JS `<<` uses ToInt32; shifts >=32 wrap mod 32. 292/300 negative int32 values decode wrong. Only -1 and -2 roundtrip by coincidence.
- **Recommendation**: After loop, sign-extend: `if (result > 0x7FFFFFFF) result -= 0x100000000;` or limit to 5 bytes for int32.
- **Confidence**: HIGH (10)
- **Priority**: 129
- **Estimated LOC delta**: +3
- **Found by**: correctness-proto

### F-028: _readBigInt no sign extension — all negative BigInt decode as large positives
- **File**: src/compiler/proto/runtime.ts:38-55
- **Symbol**: buildRuntimeHelpers (HELPER_BIGINT → _readBigInt)
- **Category**: correctness
- **Evidence**: Unsigned accumulation only. encode(-1n) → 18446744073709551615n. encode(-100n) → 18446744073709551516n.
- **Recommendation**: After read: `if (result >= (1n << 63n)) result -= (1n << 64n);`
- **Confidence**: HIGH (10)
- **Priority**: 119
- **Estimated LOC delta**: +3
- **Found by**: correctness-proto

### F-029: Proto decoder tuple [value, offset] allocation per scalar read
- **File**: src/compiler/proto/runtime.ts (lines 54, 132, 158, 183, 250)
- **Symbol**: buildRuntimeHelpers (all _read* helpers)
- **Category**: optimize
- **Evidence**: Every read helper allocates 2-element array `[value, offset]`. N fields × M decodes/sec = N×M short-lived allocations. 20-40% decode improvement.
- **Recommendation**: Module-level `_pos` variable; helpers return value only, write offset to `_pos`.
- **Confidence**: HIGH (9)
- **Priority**: 110
- **Estimated LOC delta**: +10 / -10
- **Found by**: performance

### F-030: Proto tag single-byte write for fieldNumber >= 16 — wire format corruption
- **File**: src/compiler/proto/encoder.ts:309+ / decoder.ts
- **Symbol**: generateEncoder, generateDecoder
- **Category**: correctness
- **Evidence**: Tag value >= 128 for field 16+ needs varint (2+ bytes). Encoder writes `_buffer[_offset++] = tag` (1 byte). Size calc adds 1 for tag byte. Wire format corrupted for types with 16+ properties.
- **Recommendation**: Use varint write for tags; update size calc to `_varintSize(tag)`.
- **Confidence**: HIGH (10)
- **Priority**: 105
- **Estimated LOC delta**: +8 / -4
- **Found by**: correctness-proto

### F-031: validators.inline produces spurious quote chars in error messages
- **File**: src/compiler/validators.ts:114
- **Symbol**: validators.inline
- **Category**: correctness
- **Evidence**: `.replace(ERRORS_PUSH_REGEX, error.generate('$1$2$1', path))` — `$1` expands to quote char during String.replace, producing `'"message"'`. All custom branded validator error messages have embedded quotes.
- **Recommendation**: Use function replacement: `.replace(ERRORS_PUSH_REGEX, (_, _q, msg) => error.generate(msg, path))`
- **Confidence**: HIGH (9)
- **Priority**: 97
- **Related**: S1 (security — same function, different concern)
- **Found by**: correctness-core, security (multi-agent)

### F-032: _writeString TextEncoder.encode() allocates per call
- **File**: src/compiler/proto/runtime.ts:170-176
- **Symbol**: buildRuntimeHelpers (HELPER_STRING → _writeString)
- **Category**: optimize
- **Evidence**: `_encode.call(_textEncoder, value)` allocates new Uint8Array per string field. 15-35% improvement for string-heavy messages.
- **Recommendation**: ASCII fast-path with encodeInto + scratch buffer; fallback to encode() for non-ASCII.
- **Confidence**: HIGH (8)
- **Priority**: 87
- **Estimated LOC delta**: +10 / -2
- **Found by**: performance

### F-033: _writeVarint Math.floor(value/128) in negative loop
- **File**: src/compiler/proto/runtime.ts:215-217
- **Symbol**: buildRuntimeHelpers (HELPER_VARINT → _writeVarint)
- **Category**: optimize
- **Evidence**: Negative branch uses `Math.floor(value / 128)` — FP division + floor per iteration × 9 loops. `>> 7` is single instruction. 20-30% improvement for negative int encode.
- **Recommendation**: Replace `Math.floor(value / 128)` with `value >> 7` (arithmetic right shift preserves sign).
- **Confidence**: HIGH (8)
- **Priority**: 83
- **Estimated LOC delta**: +1 / -1
- **Found by**: performance

### F-034: analyzeType null|undefined union skips all validation
- **File**: src/compiler/type-analyzer.ts:263-317
- **Symbol**: analyzeType (via analyzeUnionType)
- **Category**: correctness
- **Evidence**: Union of only null+undefined: both consumed as flags, types[]=[], literals[]=[], fallback returns type:'unknown'. generateValidator skips 'unknown' → no validation. `foo: null | undefined` accepts any value.
- **Recommendation**: Handle explicitly: when nullable && optional && types.length===0 && literals.length===0, return type:'null'.
- **Confidence**: MEDIUM (6)
- **Priority**: 81
- **Estimated LOC delta**: +4 / -1
- **Found by**: correctness-core

---

## Findings — P1 (This Sprint)

### Existing (Re-verified — all STILL VALID)

| ID | Title | File | Category | Priority |
|----|-------|------|----------|----------|
| F-001 | readVarint CPU DoS via all-continuation-bit input | src/sbc/platform.ts | security | 123 |
| F-002 | decodeTagEnd unchecked end offsets tags 5/6/12/13/14/17 | src/sbc/index.ts | security | 119 |
| F-003 | lastDecodeFn stale pointer after tag-18 decode | src/sbc/index.ts | correctness | 103 |
| F-004 | matchSchema for-in key counting + redundant WeakMap | src/sbc/index.ts | optimize | 103 |
| F-005 | readVarint allocates [number,number] tuple per call | src/sbc/platform.ts | optimize | 99 |
| F-006 | Ring-buffer false positive for structural element types | src/sbc/index.ts | correctness | 79 |
| F-007 | typedSchemas last-writer-wins on shared name-hash | src/sbc/index.ts | correctness | 83 |
| F-008 | encode(view=true) returns alias of shared mutable encodeBuf | src/sbc/index.ts | security | 79 |
| F-009 | deserializeRegistry uncapped loop bounds — DoS | src/sbc/index.ts | security | 79 |
| F-010 | serialize/deserializeRegistry truncate non-Latin-1 names | src/sbc/index.ts | correctness | 49 |

### New P1 Findings

### F-035: analyzeType WeakMap cache stale in watch/incremental mode
- **File**: src/compiler/type-analyzer.ts:55
- **Symbol**: analyzeType
- **Category**: correctness
- **Recommendation**: Export clearCache() or key cache per ts.Program.
- **Confidence**: MEDIUM (7) | **Priority**: 59
- **Found by**: correctness-core

### F-036: encodeTypedArrayInto partial header write on buffer overflow
- **File**: src/typed-array-codec.ts:115-118
- **Symbol**: encodeTypedArrayInto
- **Category**: correctness
- **Recommendation**: Add bounds check before any write: `if (pos + 4 + value.byteLength > buf.byteLength) return -1;`
- **Confidence**: MEDIUM (6) | **Priority**: 69
- **Found by**: correctness-core

### F-037: validators.inline unsanitized brand validator body — supply chain risk
- **File**: src/compiler/validators.ts:105-115
- **Symbol**: validators.inline
- **Category**: security
- **Recommendation**: Validate AST of extracted body; reject process/require/eval/Function nodes.
- **Confidence**: MEDIUM | **Priority**: 47
- **Related**: F-031
- **Found by**: security

### F-038: decodeTypedArray double allocation in copy path
- **File**: src/typed-array-codec.ts:99-101
- **Symbol**: decodeTypedArray
- **Category**: optimize
- **Recommendation**: Use `bytes.subarray(4, 4 + dataLen)` instead of `new Uint8Array(bytes.buffer, byteOffset+4, dataLen)`.
- **Confidence**: HIGH (8) | **Priority**: 51
- **Found by**: performance

### F-039: encoder.ts / decoder.ts State type + processFields skeleton dedup
- **File**: src/compiler/proto/encoder.ts, decoder.ts
- **Symbol**: EncoderState/DecoderState, processFields/processDecoderFields
- **Category**: dedup
- **Confidence**: MEDIUM | **Priority**: 43
- **Found by**: architecture

### F-040: codegen.ts ref-hash preamble dedup (21 LOC × 4 sites)
- **File**: src/sbc/codegen.ts
- **Symbol**: compileEncoder/compileDecoder/compileCompressedEncoder/compileCompressedDecoder
- **Category**: dedup
- **Recommendation**: Extract `collectRefHashes(schema, helpers, fnKey, prefix)`.
- **Confidence**: HIGH | **Priority**: 67
- **Found by**: architecture

### F-041: sbc/index.ts reorg (2144 LOC, 3 concerns)
- **File**: src/sbc/index.ts
- **Category**: reorg
- **Concerns**: (1) type inference + schema registration ~300 LOC, (2) serialization ~250 LOC, (3) codec runtime ~1600 LOC
- **Confidence**: MEDIUM | **Priority**: 61
- **Found by**: architecture

### F-042: encode() hint/plain dedup (~35 LOC × 2 sites)
- **File**: src/sbc/index.ts
- **Category**: dedup
- **Recommendation**: Extract `encodeWithSchema(schema, obj, view)` helper.
- **Confidence**: HIGH | **Priority**: 57
- **Found by**: architecture

### Testing Findings (P1)

| ID | Title | File | Category | Priority |
|----|-------|------|----------|----------|
| F-043 | analyzeRuntimeNeeds + buildRuntimeHelpers: 0 direct test refs | runtime.ts | coverage | 73 |
| F-044 | generateEncoder: negative bigint array + optional array untested | encoder.ts | test-quality | 79 |
| F-045 | generateDecoder: SKIP_UNKNOWN_FIELD untested | decoder.ts | test-quality | 79 |
| F-046 | sbc compiler: decode(buf, numericLiteral) untested | compiler/sbc/index.ts | test-quality | 69 |
| F-047 | transformCodec: defaults with undefined untested | proto/index.ts | test-quality | 59 |
| F-048 | analyzeType: cache hit path untested | type-analyzer.ts | test-quality | 55 |
| F-049 | resolveBrandedType: non-intersection path untested | type-analyzer.ts | test-quality | 49 |
| F-050 | generateValidator: custom code guard untested | validator.ts | test-quality | 55 |
| F-051 | validators.clear/get/inline: 0 direct test refs | validators.ts | coverage | 49 |
| F-052 | compiler default: early return paths untested | compiler/index.ts | test-quality | 43 |
| F-053 | codec sentinel: throw untested | codec.ts | coverage | 43 |
| F-054 | typed-array-codec: decodeTypedArray/encodeTypedArrayInto/getTypedArrayType 0 test refs | typed-array-codec.ts | coverage | 69 |
| F-055 | uuid: v2/v3/v5/v6/v8 untested | validators/uuid.ts | test-quality | 63 |
| F-056 | cc: too-long (>19 digits) branch untested | validators/cc.ts | test-quality | 43 |

---

## Existing Testing Findings (from prior runs, still open)

| ID | Title | Priority |
|----|-------|----------|
| F-013 | Compressed mode (tag 18) untested across extractField/decodeAt/encode | 79 |
| F-014 | Map/Set DoS count guard untested | 73 |
| F-015 | Unknown typed array typeId error path untested | 73 |
| F-016 | Typed array byteLength not aligned error path untested | 73 |
| F-017 | deserializeRegistry with corrupted/truncated input untested | 69 |
| F-018 | computeSize for bytes-type schema field untested | 73 |
| F-019 | Multi-boolean (>8) bitmap boundary untested | 99 |
| F-020 | Negative bigint roundtrip untested | 93 |
| F-021 | iso.dateTime missing timezone rejection boundary tests | 83 |
| F-022 | extractField with compressed (tag-18) buffer not tested | 79 |
| F-023 | uuid v2/v3/v5/v6/v8 zero test coverage | 63 |
| F-024 | SIEVE cache visited flag not verified for eviction survival | 59 |
| F-025 | SIEVE cache eviction at maxSize=1024 boundary not tested | 55 |
| F-026 | codec() untransformed throw path never tested | 43 |

---

## Convergence Status

### Per-Category
| Category | Runs | Last | Yield Curve | Status |
|----------|------|------|-------------|--------|
| correctness | 4 | ok | 4, 1, 4, 7 | NOT_CONVERGED |
| security | 4 | ok | 0, 1, 4, 1 | NOT_CONVERGED |
| performance | 4 | ok | 4, 2, 2, 4 | NOT_CONVERGED |
| architecture | 4 | ok | 5, 1, 2, 4 | NOT_CONVERGED |
| testing | 5 | ok | 5, 8, 8, 8, 14 | NOT_CONVERGED |

### Overall: NOT_CONVERGED
Reason: First-time audit of compiler/ and root files produced many new findings. Testing category expanding as new source is audited. Re-run after implementing P0 fixes.

Clean symbols at confidence >= 3: 7 / ~90 total
SQALE trend: degrading (new code brought from A/B to D)

### Recommendation
Re-run after implementing P0 Batch 1 fixes. Focus: correctness and performance in proto/runtime.ts (3 P0 findings in same file).

---

## Implementation Batches

### Batch 1: Proto Runtime Critical Fixes — 5 findings
F-027: _readVarint negative int32 sign extension
F-028: _readBigInt negative BigInt sign extension
F-029: Decoder tuple allocation → module-level _pos
F-033: _writeVarint Math.floor → >> 7
F-030: Proto tag varint write for fieldNumber >= 16

### Batch 2: Compiler Correctness — 3 findings
F-031: validators.inline quote char fix (function replacement)
F-034: analyzeType null|undefined union handling
F-035: analyzeType WeakMap cache invalidation

### Batch 3: Performance + Typed Array — 3 findings
F-032: _writeString encodeInto fast path
F-038: decodeTypedArray subarray optimization
F-036: encodeTypedArrayInto bounds check

### Batch 4: SBC Security Hardening — 4 findings (carry-over)
F-001: readVarint DoS cap
F-002: decodeTagEnd bounds validation
F-008: encode view=true copy semantics
F-009: deserializeRegistry loop caps

### Batch 5: SBC Correctness — 4 findings (carry-over)
F-003: lastDecodeFn stale pointer fix
F-006: Ring-buffer structural type discrimination
F-007: typedSchemas name-hash collision handling
F-010: Non-Latin-1 field name encoding

### Batch 6: Architecture — 4 findings
F-040: codegen.ts ref-hash preamble extraction
F-042: encode() hint/plain dedup
F-039: encoder/decoder State type dedup
F-041: sbc/index.ts reorg (if pursuing)

### Batch 7: Testing — 14 new findings
F-043 through F-056 (see table above)

## Next Steps
```
/spec-implementation storage/audit-data-2026-04-09.md --filter "Batch 1"
```
