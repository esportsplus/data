# AutoResearch Results — 2026-04-08

**Goal**: Optimize codec2 encode/decode performance without losing functionality
**Targets**: `src/codec2/index.ts`, `src/codec2/codegen.ts`, `src/codec2/platform.ts`
**Metrics**: encode ratio, decode ratio, combined ratio (vs MsgPack, maximize)
**Branch**: autoresearch/2026-04-08

## Summary
- Iterations: 14
- Kept: 2 (14%)
- Best encode: 2.64x (baseline: 2.56x, **+3.4%**)
- Best decode: 2.04x (baseline: 1.83x, **+11.5%**)
- Best combined: 2.31x (baseline: 2.19x, **+5.8%**)

## Wire Size Improvements (exp 13)
| Scenario | Before | After | Savings |
|----------|--------|-------|---------|
| Simple `{name}` | 18B | 15B | **-17%** |
| Multi `{active,age,name}` | 20B | 17B | **-15%** |
| Nested `{address,name}` | 43B | 34B | **-21%** |
| Array `{items[100]}` | 114B | 114B | 0% |
| Large `{6 fields}` | 55B | 46B | **-16%** |

## Kept Experiments
| # | Target | Encode | Decode | Combined | Description |
|---|--------|--------|--------|----------|-------------|
| 5 | index.ts | 2.59x | 2.04x | 2.32x | Separate tag-8 decode fast path with cached lastDecodeFn |
| 13 | codegen.ts+index.ts | 2.64x | 1.99x | 2.31x | Varint string/bytes lengths in schema-compiled fields |

## All Experiments
| # | Target | Combined | Status | Description |
|---|--------|----------|--------|-------------|
| 1 | codegen.ts | — | discard | Object.create(null) → {} — breaks __proto__ tests |
| 2 | index.ts | — | discard | Buffer.slice for encode — wrong Node.js Buffer semantics |
| 3 | index.ts | 2.19x | discard | Ring buffer 4→8 — no measurable impact |
| 4 | codegen.ts | 1.85x | discard | Object literal + setPrototypeOf — catastrophic regression |
| 5 | index.ts | 2.32x | **keep** | Cached lastDecodeFn on decode fast path |
| 6 | index.ts | 2.29x | discard | Cache lastEncodeSchema — no improvement |
| 7 | platform.ts | 2.15x | discard | Single-pass readShortStrAscii — decode regressed -11% |
| 8 | index.ts | 2.31x | discard | Object.keys().length in matchSchema — no measurable impact |
| 9 | index.ts | 2.28x | discard | Map/Set forEach → for...of — neutral (not benchmarked) |
| 10 | codegen.ts | — | discard | Object literal computed keys — breaks null prototype tests |
| 11 | codegen.ts | 2.23x | discard | Pre-shaped null-proto factory — decode regressed -5% |
| 12 | index.ts | 2.23x | discard | Cache lastEncodeObj identity — WeakMap already fast |
| 13 | codegen.ts+index.ts | 2.31x | **keep** | Varint string/bytes lengths in JIT codegen |
| 14 | codegen.ts+index.ts | 2.28x | discard | Varint array counts — decode regressed -3.5% |

## Findings
- **Object.create(null)** is required for __proto__ safety — no viable replacement found. All alternatives (plain `{}`, `Object.setPrototypeOf`, pre-shaped factory) either break security tests or regress decode performance
- **Varint for string/bytes lengths** saves 3 bytes per field (u32 → 1-byte varint for lengths < 128). Improves both encode speed (+3.4%) and wire size (-15-21%)
- **Varint for array counts hurts** — the conditional branch overhead per decode outweighs the 3-byte wire savings
- **readShortStrAscii two-pass is optimal** — the V8 JIT already optimizes the dual-loop + switch pattern well; shared-array alternatives add indirection
- **WeakMap.get is fast** — identity caching (`===`) doesn't beat it for the encode hot path
- **V8 hidden class transitions** for `Object.create(null)` + sequential property assignment are already efficient after warmup; pre-shaping doesn't help
- The encode path has reached diminishing returns — V8 inlines the JIT-compiled byte writes very well
- The "large" decode (0.81-0.84x vs MsgPack) remains the weakest scenario — dominated by 3 string reads + `Object.create(null)` + 6 property assignments

## Recommendations
- **decodeInto(buffer, existingObj)** API could eliminate Object.create(null) allocation for hot paths where callers provide a pre-allocated output object
- **Native addon** for decode object creation would bypass V8's null-prototype hidden class overhead
- Further wire size reduction via **varint for SBC tag-5 strings** (not schema-compiled) — would help Map/Set/mixed encode
- **Compressed mode benchmarking** — the compressed codec path (tag 18, bool bitmaps, zigzag varints) is untested; adding compressed scenarios could reveal new optimization opportunities
