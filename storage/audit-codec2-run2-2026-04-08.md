# Code Audit: src/codec2 — Run 2 (Post-Implementation)

**Status**: COMPLETE
**Date**: 2026-04-08
**Commit**: b32c96e
**Mode**: re-run (all 3 files changed since Run 1)
**Scope**: src/codec2/ (3 files, 1265 LOC)
**Previous**: Run 1 found 23 findings, 15 implemented (Batch 1 + 2)

---

## Summary

- Audit agents dispatched: 5 (correctness: 1, security: 1, performance: 1, architecture: 1, testing: 1)
- Files audited: 3 / 3 (100%)
- **New findings (post-judge): 7**
- Recurring from Run 1 (already documented): 3
- Findings by priority: **P0: 4** | **P1: 3** | P2 (excluded): 3+

## SQALE Technical Debt Rating

**Grade: C** — improved from D (Run 1 had 9 P0, now 4 P0)

---

## Findings — P0 (Immediate)

### F-001: Prototype pollution via `__proto__` field name in compiled decoder
- **Category**: security
- **Priority**: P0 — Score: 99
- **Agents**: Security
- **File**: src/codec2/codegen.ts:252-261
- **Evidence**: The compiled decoder builds a return-object literal: `return {"__proto__":f1}`. In JS, `__proto__` in an object literal is a prototype setter, not a data property. An attacker encoding an object with key `__proto__` overwrites the decoded object's prototype. Fix: use `Object.create(null)` + computed property assignment, or reject `__proto__`/`constructor`/`prototype` as field names.

### F-002: DoS via unbounded `new Array(count)` — u32 count from untrusted wire
- **Category**: security
- **Priority**: P0 — Score: 93
- **Agents**: Security
- **File**: src/codec2/index.ts:256, 292, 305, 319 (tags 7, 12, 13, 14)
- **Evidence**: After the u16→u32 upgrade, `count` can be up to 4,294,967,295. `new Array(count)` with a u32 from untrusted input causes multi-GB allocation or OOM crash. A 9-byte payload crashes the process. Fix: add `MAX_ARRAY_COUNT` guard (e.g., 1,048,576) before every `new Array(count)`.

### F-003: `decode()` fast path ignores the `length` parameter
- **Category**: correctness
- **Priority**: P0 — Score: 93
- **Agents**: Correctness
- **File**: src/codec2/index.ts:644-656
- **Evidence**: When `buffer[0] === 8` and schema is found, `decodeFn(buffer, 9, 0)` is called without regard for `length`. Callers using `length` to bound reads into a shared buffer get silent data corruption — the compiled decoder reads past the intended boundary into adjacent data.

### F-004: Browser `_bl` uses `Blob.size` — diverges from `writeUtf8`'s `encodeInto`
- **Category**: security
- **Priority**: P0 — Score: 83
- **Agents**: Security
- **File**: src/codec2/platform.ts:226
- **Evidence**: Browser codegen `encoderBindArgs` supplies `_bl` as `(str) => new Blob([str]).size`. The `_bl` result is written as the 4-byte string length prefix. But the actual bytes are written by `writeUtf8` (now using `encodeInto`). For strings with unpaired surrogates, `Blob.size` and `TextEncoder` disagree on byte count → length prefix mismatch → decoder reads wrong slice. Fix: replace `Blob.size` with the module-level `byteLen` function.

---

## Findings — P1 (This Sprint)

### F-005: Fresh-object encode regression — inferType in ring buffer is 60-80% of hot path cost
- **Category**: optimize
- **Priority**: P1 — Score: 114
- **Agents**: Performance
- **File**: src/codec2/index.ts:626-633
- **Evidence**: After Batch 1 added type-checking to matchSchema, fresh-object encode dropped from 2x to 0.31x vs msgpackr. The ring buffer now calls `inferType` per field per slot (up to 4×N calls). Fix: remove inferType from ring buffer match (key-name-only check), rely on hash verification at registration time. Pre-compute keys+types once and pass to `inferAndRegister` to avoid redundant work.

### F-006: 5 dead variable declarations remain in platform.ts (20 LOC)
- **Category**: loc
- **Priority**: P1 — Score: 43
- **Agents**: Architecture
- **File**: src/codec2/platform.ts:128-155
- **Evidence**: `readU16`, `readU32`, `readUtf8`, `writeU16`, `writeU32` were removed from the export list in Batch 2 but their variable declarations remain. Each branches on `isNode` and allocates a closure. 20 LOC of dead allocations.

### F-007: Stale "u16" tag comments after u32 upgrade
- **Category**: correctness (documentation)
- **Priority**: P1 — Score: 40
- **Agents**: Correctness
- **File**: src/codec2/index.ts:179, 181, 186-188
- **Evidence**: Lines 179, 181, 186, 187, 188 say "u16" but code uses u32. External decoder implementors using these comments would produce wire-format incompatibilities.

---

## Recurring Findings (from Run 1, already documented)

- **Hash collision throw** (index.ts:139) — unconditional throw with no recovery. Birthday problem makes collision likely at ~65K schemas. Known limitation.
- **`for...in` vs `Object.keys` in matchSchema** (index.ts:611) — performance tradeoff from Batch 1 fix revert. Accepted.
- **Node `readU32` missing parens** (platform.ts:202) — latent, unused helper.

---

## Test Coverage Gaps (from Testing agent)

| Priority | Gap | Specific Test |
|----------|-----|---------------|
| 1 | `decodeTagEnd` default throw (distinct site from decodeSbc) | Craft array with unknown tag byte inside |
| 2 | Object field with int32/float64 array (codegen flag=2/3) | `{ ids: [256, -1, 100000] }` round-trip |
| 3 | Packed array wire tags 12/13/14 assertions | `expect(codec.encode([0,1,255])[0]).toBe(12)` |
| 4 | `decode(buf, 0)` returns undefined | Explicit early-return branch |
| 5 | Unknown hash returns null (positive assertion) | Cross-instance decode asserts null |
| 6 | Special-char keys in codegen (quote, backslash) | `{ "it's": 1, "a\\b": 2 }` round-trip |
| 7 | `view=true` on non-object (generic path) | `codec.encode(42, true)` |

---

## Implementation Batches

### Batch 3: Security + Correctness (F-001 through F-004) — 4 findings

1. **F-001**: Fix prototype pollution — use `Object.create(null)` in compiled decoder, or reject dangerous field names
2. **F-002**: Add `MAX_ARRAY_COUNT` guard before `new Array(count)` in all decode array paths
3. **F-003**: Pass `length` through decode fast path to `decodeFn`, or skip fast path when `length` is provided
4. **F-004**: Replace `Blob.size` with `byteLen` in browser `encoderBindArgs`

### Batch 4: Performance + Cleanup (F-005 through F-007) — 3 findings

1. **F-005**: Remove inferType from ring buffer, use key-name-only match + hash verification
2. **F-006**: Delete dead variable declarations (readU16/readU32/readUtf8/writeU16/writeU32)
3. **F-007**: Fix stale u16 comments to u32

---

## Convergence Status

### Per-Category
| Category | Runs | Yield Curve | Status |
|----------|------|-------------|--------|
| correctness | 2 | [6, 3] | APPROACHING (declining: 6 → 3) |
| security | 2 | [4, 3] | APPROACHING (declining: 4 → 3) |
| performance | 2 | [7, 4] | APPROACHING (declining: 7 → 4) |
| architecture | 2 | [7, 2] | APPROACHING (declining: 7 → 2) |
| testing | 2 | [14, 7] | APPROACHING (declining: 14 → 7) |

### Overall: APPROACHING
All categories show declining yield curves. 1-2 more audit+implement cycles expected before convergence.

### Recommendation
Implement Batch 3 (4 P0 findings), then re-run. Security and correctness categories should converge to 0 on next pass. Performance category will converge after the fresh-object regression fix.
