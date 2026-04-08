# AutoResearch Results — 2026-04-08

**Goal**: Optimize codec2 encode/decode performance without losing functionality
**Targets**: `src/codec2/index.ts`, `src/codec2/codegen.ts`, `src/codec2/platform.ts`
**Metrics**: encode ratio, decode ratio, combined ratio (vs MsgPack, maximize)
**Branch**: autoresearch/2026-04-08

## Summary
- Iterations: 6
- Kept: 1 (17%)
- Best encode: 2.59x (baseline: 2.56x, +1.4%)
- Best decode: 2.04x (baseline: 1.83x, +11.5%)
- Best combined: 2.32x (baseline: 2.19x, +5.6%)

## Kept Experiments
| # | Target | Encode | Decode | Combined | Description |
|---|--------|--------|--------|----------|-------------|
| 5 | index.ts | 2.59x | 2.04x | 2.32x | Separate tag-8 decode fast path with cached lastDecodeFn |

## All Experiments
| # | Target | Combined | Status | Description |
|---|--------|----------|--------|-------------|
| 1 | codegen.ts | — | discard | Object.create(null) → {} — breaks __proto__ tests |
| 2 | index.ts | — | discard | Buffer.slice for encode — wrong Node.js Buffer semantics |
| 3 | index.ts | 2.19x | discard | Ring buffer 4→8 — no measurable impact |
| 4 | codegen.ts | 1.85x | discard | Object literal + setPrototypeOf — catastrophic regression |
| 5 | index.ts | 2.32x | **keep** | Cached lastDecodeFn on decode fast path |
| 6 | index.ts | 2.29x | discard | Cache lastEncodeSchema — no improvement |

## Findings
- `Object.create(null)` is required for __proto__ safety and cannot be replaced
- `Object.setPrototypeOf(obj, null)` is extremely slow in V8 — destroys hidden class optimization (-33% decode)
- Separating tag-8 and tag-18 decode paths and caching the decodeFn directly eliminates a conditional + schema property access per decode
- The encode path is already well-optimized — V8 inlines the 4-byte hash writes efficiently, and caching doesn't help
- The ring buffer cache size (4 vs 8) doesn't matter for the benchmark scenarios (5 schemas)
- Node.js Buffer.slice returns views (not copies), unlike Uint8Array.prototype.slice

## Recommendations
- The decode path still has room: the `Object.create(null)` + property assignments is the dominant cost. A custom V8 fast API or a native addon could eliminate this
- The "large" decode scenario (0.94x vs MsgPack) is still the weakest — the 3 string reads + 6 property assignments dominate
- Consider implementing a decode-to-existing-object API: `decodeInto(buffer, existingObj)` to avoid allocation entirely for hot paths
- Delta-coded integer arrays (spec Phase 3.6) and conditional-delta float64 arrays (3.7) were spec'd but not benchmarked — worth testing with real workloads
