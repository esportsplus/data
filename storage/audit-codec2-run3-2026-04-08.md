# Code Audit: src/codec2 — Run 3 (Convergence Check)

**Status**: COMPLETE
**Date**: 2026-04-08
**Commit**: b7da57e
**Mode**: re-run (all 3 files changed since Run 2)
**Scope**: src/codec2/ (3 files, 1266 LOC)

---

## Summary

- Audit agents dispatched: 3 (correctness: 1, security: 1, combined perf+arch+test: 1)
- Files audited: 3 / 3 (100%)
- **New findings (post-judge): 2**
- Findings by priority: **P0: 1** | **P1: 1** | P2 (excluded): 3

## SQALE Technical Debt Rating

**Grade: B** — improved from C (1 P0 remaining, down from 4)

---

## Findings — P0

### F-001: MAX_ARRAY_COUNT guard missing in compiled decoder array path
- **Category**: security
- **Priority**: P0 — Score: 93
- **Agents**: Correctness, Security (multi-agent agreement)
- **File**: src/codec2/codegen.ts:226
- **Evidence**: The compiled decoder reads u32 `l` and calls `new Array(l)` without bounds check. The `MAX_ARRAY_COUNT` guard was added to all 4 `decodeSbc` array tags (7/12/13/14) in Batch 3, but the codegen-compiled `array` field path is separate code that bypasses it entirely. A crafted schema field with count=0xFFFFFFFF causes OOM.
- **Fix**: Add `if(l>1048576)throw new Error('Codec2: array count exceeds limit');` in codegen before `new Array(l)`.

---

## Findings — P1

### F-002: Buffer over-read on truncated string/bytes — no bounds check before readStr
- **Category**: security
- **Priority**: P1 — Score: 65
- **Agents**: Security
- **File**: src/codec2/index.ts:244, codegen.ts:218
- **Evidence**: Tag 5 (string) reads `sLen` as u32 from wire, then calls `readStr(buf, offset+5, sLen)` without verifying `offset + 5 + sLen <= buf.length`. On truncated input, `readShortStrAscii` reads `undefined` bytes (returns NUL chars), and `utf8Slice`/`TextDecoder` silently truncate. Same pattern for tag 6 (bytes) with `subarray` clamping. Silent data corruption on malformed input.

---

## Excluded (P2 / pre-existing / accepted)

- Object.create(null) breaks `.hasOwnProperty()` — standard practice for safe dicts, not a bug
- dvCache uninitialized on Node — latent, never called on Node path
- CodegenDriver readU32/writeU32 dead interface methods — minor, type-only cost
- Codegen vs encodeSbc use different array flag schemes — by design, self-consistent
- for...in in matchSchema — accepted performance tradeoff

---

## Convergence Status

### Per-Category Yield Curves
| Category | Run 1 | Run 2 | Run 3 | Status |
|----------|-------|-------|-------|--------|
| correctness | 6 | 3 | 1 | APPROACHING (6→3→1) |
| security | 4 | 3 | 1 | APPROACHING (4→3→1) |
| performance | 7 | 4 | 0 | CONVERGED (first zero) |
| architecture | 7 | 2 | 0 | CONVERGED (first zero) |
| testing | 14 | 7 | 1 | APPROACHING (14→7→1) |

### Overall: APPROACHING
Performance and architecture converged. Correctness/security/testing declining toward zero. One more cycle after implementing F-001 should reach full convergence.

### Recommendation
Fix the compiled decoder array guard (F-001) — one-line fix. Then Run 4 should produce 0 findings across all categories, achieving convergence.
