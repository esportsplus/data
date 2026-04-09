# Audit: @esportsplus/data — Run 9

- **Status**: COMPLETE
- **Date**: 2026-04-09
- **Commit**: b41d9f4
- **Mode**: incremental (2 changed files + consumers, 67 skipped)
- **Previous audit**: e59365a (run 8)

## Scope Reduction

| Metric | Count |
|--------|-------|
| Total project files | 74 |
| Changed files (full audit) | 2 |
| Propagated via call-graph | 1 |
| Skipped (unchanged) | 71 |
| In scope | 3 + test cross-refs |
| Reduction | 96% |

## Agent Dispatch

| Agent | Symbols | Sub-targets | Status | Findings |
|-------|---------|-------------|--------|----------|
| Correctness (sbc) | 12 | 1 | ok | 1 |
| Correctness (compiler) | 13 | 1 | ok | 3 |
| Security | 16 | 1 | ok | 1 |
| Performance | 17 | 1 | ok | 2 (confirmed) |
| Architecture | 24 | 1 | ok | 4 (3 confirmed + 1 new) |
| Testing | 10 | 1 | ok | 3 |

## Findings (Post-Judge)

### P0 — Immediate (score >= 80)

#### F-CORR-NEW-3-compiler: generateNumberValidation — null coerces to 0 for non-nullable number
- **File**: [validator.ts:227](src/compiler/validator.ts#L227)
- **Symbol**: generateNumberValidation
- **Category**: correctness
- **Confidence**: HIGH (90) — execution traced, JS semantics verified
- **Evidence**: `+null === 0`, `isNaN(0) === false`. Non-nullable number field accepts null and silently coerces to 0. Validator returns `{ ok: true, data: { foo: 0 } }` for `{ foo: null }`.
- **Recommendation**: Add explicit `${varname} === null ||` before `typeof` check when `prop.nullable` is false
- **LOC delta**: +2 / -0

#### F-CORR-NEW-1: generateTupleValidation — nullable tuple rejects null
- **File**: [validator.ts:445](src/compiler/validator.ts#L445)
- **Symbol**: generateTupleValidation
- **Category**: correctness
- **Confidence**: HIGH (90) — pattern comparison with generateArrayValidation confirmed
- **Evidence**: Guard `!Array.isArray(varname)` has no nullable short-circuit. `!Array.isArray(null)` = true → always rejects null for `[T] | null` fields.
- **Recommendation**: Add `${prop.nullable && \`${varname} !== null &&\`}` before `(!Array.isArray(...))`
- **LOC delta**: +1 / -1

#### F-CORR-NEW-2: generatePropertyExtraction — nullable object property dereferences null
- **File**: [validator.ts:306](src/compiler/validator.ts#L306)
- **Symbol**: generatePropertyExtraction
- **Category**: correctness
- **Confidence**: HIGH (90) — code path traced
- **Evidence**: `else if (prop.type === 'object' && prop.properties)` recurses without checking `prop.nullable`. When runtime value is null, generated code accesses `null.subProp` → TypeError crash.
- **Recommendation**: Guard recursive extraction with null check when `prop.nullable`
- **LOC delta**: +4 / -1

#### F-CORR-NEW-3-sbc: decodeTagEnd — silent wrong result for truncated nested tag-8/18 header
- **File**: [index.ts:789](src/sbc/index.ts#L789)
- **Symbol**: decodeTagEnd
- **Category**: correctness
- **Confidence**: HIGH (90) — JS semantics verified (undefined | 0 === 0)
- **Evidence**: `buf[offset+5..8]` reads without bounds check. For truncated buffers, undefined bytes produce dataLen=0, returning wrong end offset. Subsequent decode reads garbage.
- **Recommendation**: Add `if (offset + 9 > buf.length) throw new Error('Codec2: truncated tag-8/18 header')` before the u32 read
- **LOC delta**: +1 / -0

#### S-NEW-1: compileCompressedDecoder — missing bounds check on string/bytes fields
- **File**: [codegen.ts:726](src/sbc/codegen.ts#L726)
- **Symbol**: compileCompressedDecoder
- **Category**: security
- **Confidence**: HIGH (90) — asymmetry with regular decoder grep-verified
- **Evidence**: Regular decoder has `if(p+l>b.length)throw` at lines 426-430. Compressed decoder at lines 726, 729 omits this guard. Crafted buffer can cause silent data corruption or info-leak.
- **Recommendation**: Add `if(p+l>b.length)throw new Error('Codec2: truncated string/bytes')` in compressed decoder string/bytes cases
- **LOC delta**: +3 / -0

#### F-PERF-1: encodeSbc Map.forEach closure — per-call allocation on hot path
- **File**: [index.ts:1015](src/sbc/index.ts#L1015)
- **Symbol**: encodeSbc
- **Category**: optimize
- **Confidence**: HIGH (90) — closure allocation pattern verified
- **Evidence**: `value.forEach((v,k) => { p = encodeSbc(k, buf, p); ... })` allocates closure per Map encode. Fix: `for (let [k,v] of value)`. Estimated 15-30% for Map-heavy paths.
- **LOC delta**: +2 / -1

### P1 — This Sprint (score 40-79)

#### F-PERF-3: decodeSbc packed uint8 — element-by-element copy instead of subarray
- **File**: [index.ts:620](src/sbc/index.ts#L620)
- **Symbol**: decodeSbc
- **Category**: optimize
- **Confidence**: MEDIUM (70) — directionally valid, exact gain depends on array size
- **Evidence**: `for(i) arr[i] = buf[p+i]` loop instead of `Array.from(buf.subarray(...))`. 20-50% gain for large packed uint8 arrays (n > 1000).
- **LOC delta**: +1 / -3

#### T-NEW-2: extractField map/set/typedarray skip — zero test coverage
- **File**: [index.ts:1808](src/sbc/index.ts#L1808)
- **Symbol**: extractField
- **Category**: test-quality
- **Confidence**: HIGH (90) — newly added code with 0 test refs
- **Evidence**: The map/set/typedarray skip cases added in the recent fix (lines 1808-1812) have no test exercising them as preceding fields.
- **Missing test**: `defineSchema([{name:'meta',type:'map'},{name:'id',type:'uint8'}])`, encode, `extractField(buf, 'id')` → should return value
- **LOC delta**: +15 / -0 (test file)

#### T-NEW-1: generateRecordValidation — record index-type validation untested
- **File**: [validator.ts:329](src/compiler/validator.ts#L329)
- **Symbol**: generateRecordValidation
- **Category**: test-quality
- **Confidence**: HIGH (90) — grep verified 0 test refs for switch cases
- **Evidence**: `Record<string, boolean|number|string>` switch cases at lines 329-335 never tested with wrong value types.
- **Missing test**: `{ value: Record<string, number> }` with `{ a: 'wrong' }` → should reject
- **LOC delta**: +10 / -0 (test file)

#### F-TEST-10: generateValidator customValidatorCode guard untested
- **File**: [validator.ts:548](src/compiler/validator.ts#L548)
- **Symbol**: generateValidator
- **Category**: test-quality
- **Confidence**: HIGH (90)
- **Evidence**: `if (!_errors) { customValidatorCode }` guard — no test verifies field errors suppress custom validator
- **LOC delta**: +8 / -0 (test file)

#### F-ARCH-1: resolvePath dead export (0 external callers)
- **File**: [error.ts:47](src/compiler/error.ts#L47)
- **Symbol**: resolvePath
- **Category**: loc
- **Confidence**: HIGH (90) — grep-proven 0 external callers
- **LOC delta**: +0 / -1

#### F-ARCH-5: readU32/writeU32 dead methods on CodegenDriver
- **File**: [platform.ts:154](src/sbc/platform.ts#L154)
- **Symbol**: CodegenDriver.readU32, CodegenDriver.writeU32
- **Category**: loc
- **Confidence**: HIGH (90) — grep-proven 0 callers
- **LOC delta**: +0 / -6

#### F-ARCH-2: sbc/index.ts reorg (2223 LOC, 4 concerns)
- **File**: [index.ts](src/sbc/index.ts)
- **Symbol**: entire file
- **Category**: reorg
- **Confidence**: HIGH (90) — LOC verified, concerns enumerated
- **LOC delta**: +50 / -0 (new files for split)

### Excluded (P2 < 40 or INVALID)

- **F-ARCH-4** (score 33): codegen.ts typed array switch dedup — below P1 threshold
- **S-NEW-2** (LOW confidence): latent injection surface in buildLiteralChecks — not currently exploitable
- **F-PERF-2**: Below 10% threshold — not actionable
- **F-PERF-4**: INVALIDATED — `for...in` is faster than `Object.keys().length`

### Previously Open — Status Changes

| Finding | Old Status | New Status | Reason |
|---------|-----------|------------|--------|
| F-CORR-10 | open | resolved | extractField array uses full decode now |
| F-CORR-11 | open | resolved | map/set/typedarray skip cases added |
| F-PERF-4 | open | invalid | for...in is actually optimal |
| F-PERF-2 | open | downgraded | below 10% threshold |
| F-TEST-14 | open | resolved | negative bigint roundtrip tested |
| F-TEST-15 | open | resolved | bigint in union tested |
| F-TEST-16 | open | resolved | optional tuple tested |
| F-TEST-18 | open | resolved | decodeAt truncation guard tested |
| F-TEST-19 | open | resolved | extractField bounds guard tested |
| F-TEST-20 | open | resolved | defineSchema field name validation tested |
| F-TEST-21 | open | resolved | deserializeRegistry field name validation tested |
| F-TEST-22 | open | resolved | computeSize nested >=128 bytes tested |
| F-TEST-23 | open | resolved | decode hint len >= 9 tested |

## Summary

- Audit agents dispatched: 6 (correctness: 2, security: 1, performance: 1, architecture: 1, testing: 1)
- **Audit mode**: incremental (2 changed, 1 propagated, 71 skipped)
- Files audited: 3 / 74 (4%)
- **Total findings** (post-judge): 13
- Findings rejected/excluded: 4 (F-ARCH-4, S-NEW-2, F-PERF-2, F-PERF-4)
- Findings by category: correctness 4 | security 1 | optimize 2 | loc 2 | reorg 1 | test-quality 3
- Findings by priority: P0 6 | P1 7 | P2 (excluded) 2
- Previously open resolved this run: 13
- Estimated total LOC delta: +97 / -13

## SQALE Technical Debt Rating

**Grade: D** (6 P0 findings)

## Convergence Status

### Per-Category
| Category | Runs | Last | Yield Curve | Status |
|----------|------|------|-------------|--------|
| correctness | 8 | ok | 4,1,4,7,2,7,4,4 | NOT_CONVERGED |
| security | 8 | ok | 0,1,4,1,3,3,0,1 | NOT_CONVERGED |
| performance | 8 | ok | 4,2,2,4,3,2,3,0 | APPROACHING |
| architecture | 8 | ok | 5,1,2,4,1,3,2,1 | NOT_CONVERGED |
| testing | 9 | ok | 5,8,8,8,14,2,14,9,3 | APPROACHING |

### Overall: NOT_CONVERGED
Reason: Correctness still finding new bugs (4 this run). Security found 1 new. Code is actively being modified.
Clean symbols at confidence >= 3: 7 / ~70 total
SQALE trend: stable (D for 3 consecutive runs)

### Recommendation
Re-run after implementing Batch 1 P0 fixes. Correctness category needs the most attention — nullable handling is a systematic gap across validators.

## Implementation Batches

### Batch 1: P0 Correctness + Security — 6 findings

All in `src/compiler/validator.ts` and `src/sbc/`:

1. **F-CORR-NEW-3-compiler**: null coerces to 0 for non-nullable number (validator.ts:227)
2. **F-CORR-NEW-1**: nullable tuple rejects null (validator.ts:445)
3. **F-CORR-NEW-2**: nullable object extraction dereferences null (validator.ts:306)
4. **F-CORR-NEW-3-sbc**: decodeTagEnd truncated nested header (sbc/index.ts:789)
5. **S-NEW-1**: compressed decoder missing string/bytes bounds check (sbc/codegen.ts:726)
6. **F-PERF-1**: Map.forEach closure on hot encode path (sbc/index.ts:1015)

### Batch 2: P1 Testing + Architecture — 7 findings

7. **T-NEW-2**: extractField map/set/typedarray skip test coverage
8. **T-NEW-1**: Record index-type validation test coverage
9. **F-TEST-10**: Custom validator guard suppression test
10. **F-ARCH-1**: Remove resolvePath from error.ts exports
11. **F-ARCH-5**: Remove readU32/writeU32 dead methods
12. **F-ARCH-2**: sbc/index.ts reorg (2223 LOC)
13. **F-PERF-3**: Packed uint8 subarray optimization

## Next Steps

```
/spec-implementation storage/audit-data-2026-04-09.md --filter "Batch 1"
```
