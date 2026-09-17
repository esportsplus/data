# SBC Eval-Free Architecture Spike — Benchmark Plan

> Goal: generate fair, apples-to-apples evidence comparing candidate EVAL-FREE codec
> architectures against the CURRENT (fixed) SBC, BEFORE any refactor. This is a spike to
> produce NUMBERS, not to ship. Nothing experimental merges to production `src/` in this round.
> Source: gpt-6-astra planning pass, 2026-09-17.

## 0. Experimental boundaries (measure these separately, never blended)

1. **Public API**: full encode/decode incl. schema matching, inference, validation, framing, copy.
2. **Field execution** (diagnostic only): precompiled schema, supplied buffer, no inference/alloc.
3. **Columnar API**: reconstructing ordinary JS values vs returning column views — separate results.
4. **Compression**: explicit `false` and `true` tracks; never combine into one score.
5. **Eval-freedom**: applies to the whole candidate runtime dependency graph (incl. nested schema
   resolution / cache-store / size / extract paths), not just entry functions.

Grounding facts from source: wire/hash version is **2**; decode depth is bounded at **64**
(depth-100 is an expected-rejection case, do NOT weaken the limit for a throughput number); schemas
allow at most **16 nullable fields**; the default schema cache is process-wide (every experimental
codec needs an explicit private cache); `computeSize()` can trigger inference/compilation (must not
prewarm cold measurements); SBC already packs homogeneous numeric arrays (columnar must beat that,
not a naive element-tagged baseline); the compiler emits `{schema: FieldDef[]}` specs, not codec
functions (not true AOT).

## 1. Phase 0 — Frozen baseline

- Baseline **B** = the committed, verified working state (all audit fixes + eval-free Ctor cleanup),
  `tsc -p tsconfig.build.json --noEmit` clean, full suite green. Tag `sbc-spike-baseline-v1`.
- Build baseline SBC **once from B** with a pinned recipe; publish an immutable artifact dir
  (baseline JS + source provenance + lockfile hash + build options + SHA-256 hashes). Every
  worktree's baseline adapter imports THAT exact artifact and fails startup on hash mismatch.
- Worktrees (siblings outside `G:\data`), created with `git worktree add -b <branch> <dir> <commit>`:

  | Worktree | Branch | From |
  |---|---|---|
  | `G:\sbc-spikes\harness` | `bench/sbc-harness` | B |
  | `G:\sbc-spikes\vm` | `bench/sbc-vm` | H |
  | `G:\sbc-spikes\closures` | `bench/sbc-closures` | H |
  | `G:\sbc-spikes\columnar` | `bench/sbc-columnar` | H |

- Harness owner completes Phase 1, commits as **H** (descendant of B), tag `sbc-spike-harness-v1`.
  All spike branches descend from H. Production `src/` stays untouched on every spike branch;
  experiments live under `bench/spike/`. Record B, H, candidate commit, baseline+candidate artifact
  hashes, fixture hash, and tool versions in every result.

## 2. Phase 1 — Shared harness (owned by the harness agent)

Under `bench/spike/`: deterministic fixture generators + schema manifests; baseline/candidate/
msgpackr adapters; correctness + ownership checks; a thin Vitest entry for smoke runs; a **standalone
compiled Node runner** that owns authoritative warm/cold/memory measurement; a parent process that
schedules isolated workers and aggregates raw results; JSONL + CSV + Markdown output + manifest
verifier. Commands: `spike:verify`, `spike:bench`, `spike:cold`, `spike:memory`, `spike:report`.

**Common runtime scaffold**: a benchmark-only copy of the frozen SBC runtime whose two
`compileSchema` imports (in `index.ts`, `schema.ts`) are redirected to a build-time-selected backend
(no global mutable selector). Everything else identical (parse, hash, match, validate, tagged
helpers, buffers, registry, size, extract). Nested inference, cache/store resolution, and size must
reach the selected backend too. Candidate bundles must NOT retain the original codegen module. First
ship a **pass-through backend using original codegen**, verify byte parity + comparable public-API
timing vs the immutable baseline — this validates the scaffold before spikes begin.

**Uniform adapter surface**: `create(config)`, `prepare(schemaManifest)` (never in warm timing),
`encode(value, handle?)`, `decode(bytes)`, `exportDefinitions()`/`importDefinitions()`,
`diagnostics()` (outside timing), optional `encodePayload`/`decodePayload` diagnostics. Columnar adds
`encodeColumns()`/`decodeColumns()`. Unsupported combos reported `N/A: reason`, never silently
substituted.

**Schema modes (run separately)**: Inferred (fresh codec, replay identical training stream);
Declared (explicit shared `FieldSpec[]`, child-first registration, root hash for objects, identical
widths/nullability across wire-compatible candidates); Payload diagnostic (prepared `FieldDef[]`, no
matching — never the headline claim). Object batches use `{items: rows}`; declared mode registers a
row schema + wrapper `array<object(rowHash)>` and compares against that stronger SBC batch path AND
inferred SBC.

## 3. Phase 2 — Per-agent implementation specs

### Agent V — Bytecode VM + superinstruction ablation (one worktree, two modes: `vm-basic`, `vm-fused`)
- Compile each schema into immutable `Uint32Array` instruction storage; names/refs in side tables;
  cache programs by schema hash (keep definition-equality/collision behavior).
- Uncompressed AND compressed encode/decode entry functions through existing `Schema` slots; one
  encode + one decode interpreter (static switches, ordinary functions). Support every field type in
  the matrix (bigint, dates, strings, bytes, nullable, declared arrays, nested refs, generic arrays,
  mixed tagged). Preserve compressed layout/passes/adaptive numerics, packed-array helpers (width
  dispatch outside the element loop), bounded reads, depth budget, buffer-growth retry, safe object
  construction. Nested misses resolve through the VM backend — no hidden codegen fallback. Recursive
  interpreter OK within the depth budget.
- **Fusion rules (fixed before measuring)**: runs of 2–8 adjacent non-nullable same-type fixed-width
  fields; runs of 2–8 adjacent non-nullable string fields; one static `uint32,float64,float64`
  kernel; compressed boolean bitmap as a block op. Never cross nullable branches, child calls, or
  compressed-pass boundaries. No fixture-specific assumptions. (A basic string op already does
  len+utf8; that alone is not a "superinstruction".)
- Deliver both modes (identical except fusion), instruction/bytecode/side-table counts + fusion
  coverage per schema, correctness + disassembly, honest memory accounting (side tables + metadata +
  wrappers + constructors).

### Agent C — Closure/combinator control (one worktree)
- Compile fields into arrays of ordinary encode/decode closures (capture key, nullability, primitive
  op, nested refs); execute via a simple loop; separate sequences where compressed needs separate
  passes. Share frozen schema handling, primitive helpers, packed arrays, bounds checks, allocation
  policy, ordered prototype-safe construction. Ordinary constructors/functions only — no source
  strings, `Function`, proxies, or baseline fallback. Deliver closure counts + retained memory +
  throughput. (Test of the strategy; don't assume it loses to the VM.)

### Agent K — Columnar batch spike (one worktree, independent)
- Supported subset: homogeneous numeric arrays; arrays of flat same-shape records (uint32/int32/
  float64/bool/string + nullable). Explicit schema descriptions. Deep/heterogeneous/arbitrary nested
  → report unsupported for MVP.
- **Fixed format** (separate identifier, never SBC tag 8/18): header `COL1` magic + schema hash +
  row count + column count + root-kind + frame length; fixed-size directory entries (type, flags,
  validity loc, offsets loc, data loc, data len); little-endian, numeric sections 8-byte aligned to
  frame; 1 byte/bool MVP; nullable validity bitmap (numeric keeps one slot/row); strings = N+1 uint32
  offsets + concatenated UTF-8; schema metadata external (accounted like SBC registry); validate all
  offsets/counts before building views.
- **Variants**: (1) rows→bytes→rows (encode includes transposition, decode rebuilds fresh rows/
  strings); (2) columns→bytes→column-views (prep reported separately); (3) rows→bytes→column-views
  (not equivalent to SBC full decode); (4) numeric JS arrays: owned decode → `number[]`, typed-array
  views separate. Include an **unaligned-input** case and charge any required copy. No dictionaries/
  compression/nested/streaming. Compare uncompressed columnar vs BOTH compressed and uncompressed
  SBC.

### True AOT — NOT in round one (current JIT SBC is the warm straight-line reference). If motivated,
round two emits literal encode/decode functions at build, measures module load + generated size,
declares unsupported dynamic schemas.

## 4. Shared data matrix (deterministic PRNG seed `0x5BC2026`; fresh objects every message)

Small flat (1-field, 4-field); Wide mixed (32/128/512 fields, non-nullable); Wide fixed/fusion
(contiguous uint32/float64 blocks + `uint32,float64,float64` triplets); Deep objects (leaf wrapped
8/32/100× — inferred generic AND declared `object(hash)` chains separately; depth 100 =
expected-rejection on decode); Object batches `{items}` N=1/16/256/4096/65536 (numeric row
`{id,x,y,active}`, mixed row + 24-char label); Nullable batches (0/50/90% null, N=16/4096/65536);
Integer arrays (uint8/int16/int32, N=16/1024/65536, width boundaries; root + `{items}`); Float arrays
(float64; JS `number[]` vs real `Float64Array`; `Int32Array` control); String-heavy (8 fields ×
16/128/4096 bytes; ASCII vs mixed Unicode é/漢/emoji); Heterogeneous `{items}` len 32/1024 cycling
null/bool/int/float/string/bytes/date/bigint/small-object/nested-array; Mixed-shape stream (4/32/128
distinct schemas, deterministic shuffle); Nullable fields (4 and 16, 0/50/90%); Optional fields (8
presence masks; absent key vs own-undefined vs explicit null; declared vs inferred semantics differ);
Buffer growth/binary (`{data: Uint8Array}` 256B/65535B/65537B/1MiB + small/large alternation). Use
out-of-narrow-range values (uint32 > 65535, int32 < −32768, non-integral floats) to expose width
differences. Correctness-only edge corpus: empty arrays/objects, 127/128 + 16383/16384 boundaries,
all width boundaries, −0, NaN, ±Infinity, bigint bounds, lone surrogates, dangerous field names,
unaligned views, malformed lengths, truncated child frames, missing schemas, out-of-range declared.

## 5. Correctness & ownership gates (run BEFORE accepting any perf result)

Deep comparator (NOT `JSON.stringify`): own props/values, arrays, `Object.is` for −0/NaN, bigint/
date/typed-array type+content, binary, prototype safety separate from value equality. Round-trip
equality for supported values; documented expected values where SBC intentionally changes
representation (undefined/hole→null, absent declared nullable→null, lone-surrogate replacement).
Differential (VM/closures, both compression modes): candidate bytes == baseline bytes for identical
schema state + input order; each decoder reads the other's bytes; child-first AND parent-first
registration; fresh decoder imports definitions with no encoder state; nested resolution stays
eval-free; size/extract match frozen contracts. Ownership: encoded bytes survive later encodes;
decoded binary doesn't alias input; ordinary numeric arrays stay ordinary; batches return fully
materialized rows (separate `view:true`/column-view tracks). Eval-free proof: build candidate-only
artifacts, run correctness under `--disallow-code-generation-from-strings`, inspect dependency graph
(incl. inference/miss/import/size/extract). Baseline JIT tested separately without the flag.

## 6. Fair msgpackr baseline

msgpackr **2.1.0** (in lockfile), **shared records**: dedicated `Packr` `useRecords:true` + explicit
`structures` + `maxSharedStructures:1024`; train structures outside warm timing; independent
`Unpackr` from transferred structures; `sequential:false`; `copyBuffers:true` owned; `moreTypes:true`;
`encodeUndefinedAsNil:true` where matching SBC. Report message bytes AND definition bytes separately;
**session bytes = definitions + Σ message bytes** at 1/10/1000/100000 messages. Plain `pack/unpack`
kept only as a labelled maps control. Record native-addon availability, lock across runs. External
reference, not an eval-free candidate.

## 7. Measurement protocol

Pin Node **26.8.1** + pnpm **11.10.0** + lockfile. Record CPU/OS/arch/Node/V8/power/flags/deps/addon/
artifact hashes. One frozen build recipe; no dev server/transform/coverage/profiler during timing.
Implementations concurrent; **no benchmark overlaps another job on the measurement machine**.

Warm: per approach×case×mode×direction — fresh worker (one approach only), prepare/replay training,
separate warm-up inputs, warm ≥2s (2000 ops; 200 for >64KiB), 20 samples ≈100ms, 7 independent
worker processes, randomized approach order (seeded). Baseline runs in every block; ratios paired
within block. One timed adapter callsite per worker (no shared polymorphic callsite). Fresh inputs:
pre-generate a bounded batch, consume each once, refill outside timer; fixed chunk length/case; cap
fixtures 32MiB (except one big message); calibrate via discarded baseline pilot; do NOT recycle a
small-object ring (SBC WeakMap would measure repeat-instance behavior). Also report a secondary
generate+encode workload (do not subtract generator time). Decode uses an independently-encoded
corpus; decoded objects freshly produced. Consume results via a shared lightweight sink (identical
per case); benchmark+report empty-sink overhead, don't auto-subtract.

Cold (30 fresh-process obs for small/wide-128/deep-32/batch-4096/string-heavy/mixed-stream): instance
setup; declared prepare; first encode declared; first encode inferred; first decode from definitions
(import reported separately); nested miss (in-memory store); warm-engine new schema; process startup.
No correctness/size/encode may touch the measured codec beforehand.

Stats: per process median/mean/stddev/CoV; across 7 runs median + bootstrap 95% CI on paired ratio.
If baseline CoV > 5% or paired baseline medians drift > 5%, diagnose and repeat the block (keep
rejected raw data + reason). Don't drop slow samples for GC — warm throughput includes normal GC.
Memory (separate `--expose-gc` profiling runs, never GC between timed ops): heapUsed/external/
arrayBuffers/RSS deltas; peak RSS; post-GC retained at 1/32/128/512 schemas; program/source bytes +
side tables + closure counts; sampled alloc + GC time. Report allocations as estimates.

## 8. Results & deliverables

One JSONL record/sample (provenance, env, case/seed/size/mode/compression/ownership/direction/rep,
op count, elapsed ns, bytes, metadata bytes, checksum, correctness status, warm-up, compile
diagnostics). Table per case × semantic track: Approach | Status | Encode ops/s | Encode ns/op |
Decode ops/s | Decode ns/op | Bytes/msg | Encode ratio | Decode ratio | Cold prepare µs | First
encode µs | Retained schema KiB. Ratio = candidate/SBC throughput (>1 faster); show CIs. Batches also
rows/s, ns/row, bytes/row (one op = one message). Separate tables: inferred API, declared API,
compression on/off, borrowed output, payload diagnostics, column views/precolumnar, cold lifecycle,
memory, expected-rejection/unsupported. Summary = family-balanced geometric mean (aggregate within
family, then across families — numeric-array sizes must not dominate). Each agent returns commit,
capability manifest, correctness report, raw results, honest wins+losses. Harness owner reruns
accepted artifacts centrally before the decision.

## 9. Success criteria / decision rule (preregistered; "justify further work", not "ship")

- **Basic VM**: justify if encode AND decode ≥ **0.85× SBC** family-balanced public API, mixed+deep
  accepted ≥0.85×, no family <0.70×, and prepare-time or retained schema memory ≥2× better. Stop if
  persistent <0.70× on mixed/deep/wide, unresolved semantic diffs, or hidden codegen.
- **Fused VM**: justify if ≥ **1.10× basic VM** on fixed/wide (both directions, CI excludes parity),
  no >5% general regression, program size growth ≤25%. Else keep basic VM.
- **Closures**: justify if meets VM public-API threshold, or within 5% of best VM with materially
  less complexity + cold/memory win. Stop if >20% behind VM on mixed/wide/deep.
- **Columnar full rows**: justify if at N≥4096 ≥ **1.25× the faster SBC compression mode** (row
  encode + full-row decode, numeric batches), no mixed-batch regression, ≤10% byte increase, ≤1.5×
  peak memory. Reject as transparent replacement if wins vanish once transposition/materialization
  timed.
- **Columnar views**: justify (opt-in batch/view API only) if ≥ **2× SBC full decode** on eligible
  large batches with documented ownership + consumer-read costs.
- Any correctness/bounds/ownership/eval-free failure disqualifies the result. Require BOTH declared
  and inferred evidence for a general dynamic-replacement claim. Compressed results independent. Ties
  → smaller impl + lower retained memory. If nothing passes, keep SBC; decide whether an explicitly
  slower eval-free mode or true AOT is worth a round two. Do NOT merge experiments to production.
