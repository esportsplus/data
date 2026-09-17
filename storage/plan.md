# SBC Compile-Time-Only Refactor — Implementation Plan

> Merged plan from two independent read-only audits of `@esportsplus/data`:
> `gpt-6-astra` (codex) produced the audit + feasibility study; `claude-fable-5.1` verified every
> "Confirmed" claim with its own in-memory probes and corrected emphasis, counts, and sequencing.
> No files were modified. Builds and the full test suite were NOT run — compiler findings are
> source-inspection based; SBC findings were reproduced in-memory by both models.

## Verdict

**Doable-with-caveats.** No dynamic feature fundamentally requires `new Function`: the generated
code is a straight-line field walk over `FieldDef`, and `src/sbc/size.ts` already *interprets* the
same layout. The runtime JIT can be replaced by (a) an **interpreter** covering all dynamic schemas
and (b) an optional **AOT generator** for declared types.

What is **not** achievable: removing all runtime schema *processing* while keeping an unrestricted
dynamic schema API. Arbitrary first-seen shapes and remotely fetched schemas need runtime
interpretation; strict pre-generation only covers a closed set of declared schemas.

**A versioned wire contract is unavoidable** (not optional) — see Blocker B1.

### `new Function` inventory (corrected)

Six call sites in `src/sbc/codegen.ts`, but only **four carry real generated bodies** — the encode/
decode factories at `:545`, `:682`, `:815`, `:1061`. The two `Ctor` sites at `:673` and `:806` are
empty constructors, each replaceable by a one-line function declaration. All six must leave the
static client dependency graph.

---

## Empirical verification (2026-09-17)

Every testable finding below was reproduced with **real, committed vitest specs** under
`test/audit/` (68 tests, all passing; full suite green at 57 files / 2050 tests). Each test asserts
the *current* buggy behavior, so **PASS = bug PROVEN** — a future fix flips the test to red. This
replaces the earlier ephemeral in-memory probes. Specs written by `deepseek-flash` agents, reviewed
here.

| Finding | Status | Spec |
|---|---|---|
| B1 registration-order wire divergence | **PROVEN** (incl. fresh-codec/shared-cache reachability → `SBC: truncated`) | `sbc-wire.test.ts` |
| B2 JIT fires mid-decode | **PROVEN** (store get 0→1, set 3→4 with innerHash during `decode()`) | `sbc-decode-safety.test.ts` |
| B3 numeric-width contract | Not a bug — design decision; nullable-hint byte divergence proven under H3 | — |
| B4 hash ambiguity + silent alias | **PROVEN** (both shapes hash `472543302`; defineSchema aliases) | `sbc-wire.test.ts` |
| H1 frame boundary / depth | **PROVEN** (a/b/c: zeroed frame decodes 43981; `decodeAt` header→`{a:0}`; depth 100 no guard) | `sbc-decode-safety.test.ts` |
| H2 nested truncation | **PROVEN** (`{x:300}`→`{x:44}`, hint + plain + array paths) | `sbc-wire.test.ts` |
| H3 compiler parity-or-omit false | **PROVEN** (3/3: nullable hash divergence, optional→null, extra-prop dropped) | `compiler.test.ts` |
| H4 caller options lost | **PROVEN** (3/3: schema override, `{...bool}`, numeric length discarded) | `compiler.test.ts` |
| H5 config vanishes / async unawaited | **PROVEN** (5/5) | `compiler.test.ts` |
| H6 scope / control-flow break | **PROVEN** (4/4: raw `return` escape, hoist TDZ ×2, typeToString dedup collision) | `compiler.test.ts` |
| H7 validators wider than type | **PROVEN** (4/4: never pass-through, template-literal, bigint literal) | `compiler.test.ts` |
| H8 createCache(0) infinite loop | **PROVEN** — *safely* via child-process SIGKILL/ETIMEDOUT (~2021ms), no in-process loop | `sbc-limits-types.test.ts` |
| M1 −0 loss / surrogate mis-size | **PROVEN** (a/b; M1b confirmed as a wire divergence, 4 vs 5 bytes) | `sbc-lossless-ingestion.test.ts` |
| M2 junk type / hash wrap | **PROVEN** (a/b; M2a needs the `{schema:hash}` hint — bare encode re-infers) | `sbc-lossless-ingestion.test.ts` |
| M3 encode/decode limit asymmetry | **PROVEN** (a/b: 1,048,577 array & 1025 schemas encode but fail decode) | `sbc-decode-safety.test.ts` |
| M4 cache set/async data loss | **PROVEN** (a/b) | `sbc-lossless-ingestion.test.ts` |
| M5 JSON-schema info loss | **PROVEN** (a/b/c via runtime `analyzeRootType`/`generateJsonSchema` — no build needed) | `validators-jsonschema.test.ts` |
| M6 validator boundary bugs | **PROVEN** (a/b/c/d) | `validators-jsonschema.test.ts` |
| M7a typedSchemaFieldCounts leak | **PARTIAL** — leak proven by source (add-only) + path reachable (13→10 B); consequence not API-observable (private closure state) | `sbc-limits-types.test.ts` |
| M7b DataView admitted, runtime rejects | **PROVEN** (cast-free `encode(DataView)` throws `unrepresentable`) | `sbc-limits-types.test.ts` |
| M7c decode<T> unchecked | **PROVEN** (`decode<{a:string}>`→`{a:5}`, `typeof==='number'`) | `sbc-limits-types.test.ts` |
| M9 loose plugin detection | **PROVEN** (2/2: SBC duck-typing false positive; shadowed `v.set` brand) | `compiler.test.ts` |
| M8 duplication, M10 test gaps, L1 docs | Not unit-testable (architectural / meta / trivially true) — not asserted | — |

**Result: 25 findings PROVEN, 1 PARTIAL (M7a), 0 DISPROVEN.** No finding fell over under test.
Line-number corrections surfaced during verification: H8 no-op return is `cache.ts:43-45` (loop at
`:106`); M7c unchecked cast is `index.ts:558` (not the `:184` signature); M7b runtime rejection is
`tagged.ts:594`/`469`.

---

## Implementation status (2026-09-17)

Fixes implemented in parallel (5 agents by source-area ownership) and verified together:
**`tsc -p tsconfig.build.json --noEmit` clean; full suite 58 files / 2076 tests green.** Each fix has
a permanent regression guard under `test/audit/fixes/` (sbc-core, sbc-cache, validators, json-schema,
compiler). The original "prove-the-bug" characterization specs were retired once superseded.

| Finding | Status | Notes |
|---|---|---|
| B1 | **FIXED** | Canonical `[varint payloadLen][child fields]` ref layout, order-independent; `WIRE_VERSION=2`. |
| B4 | **FIXED** | Length-prefixed hashing; definition comparison on hash hit; inference collisions recoverable via linear probe. |
| H1 | **FIXED** | Payload-end bound threaded through compiled/tagged/extract decoders; depth budget on the `object(hash)` recursion. |
| H2 | **FIXED** | Referenced child schemas validated recursively (explicit + plain paths). |
| H8 | **FIXED** | `createCache` rejects capacity < 1; insert loop always terminates. |
| M1a/M1b | **FIXED** | -0 preserved through compression; browser UTF-8 sizing matches TextEncoder (wire divergence closed). |
| M2 | **FIXED** | `Object.hasOwn` type check; object hash > uint32 rejected (no wrap). |
| M3 | **FIXED** | Array-count + schema-count limits enforced on the encode/serialize side too. |
| M4a/M4b | **FIXED** | `set` overwrites existing key; async batch returns fetched results directly + dedupes misses. |
| M5a/M5b/M5c | **FIXED** | Null-proto dict; tuple rest emitted as `items`; nested annotations recursed. |
| M6a/M6b/M6c/M6d | **FIXED** | Exponential-notation multipleOf; calendar-valid ISO datetime; hostful https; small-year dateString. |
| M7b | **FIXED (type)** | `EncodablePrimitive` excludes DataView; runtime already rejected it. |
| H5/H6/H7 | **FIXED** | Compiler: error-on-unsupported config + async-by-type; contained brand control-flow + scope/TDZ guards + identity-keyed dedup; `never`/template-literal/bigint-literal validation. |
| M9 | **FIXED** | Detection resolves the real `@esportsplus/data` import identity (no duck-typing / identifier-text matching). |
| M7a | **PARTIAL / deferred** | Leak real but not API-observable; documented, guard retained in `test/audit/sbc-limits-types.test.ts`. |
| M7c | **INTENTIONAL** | `decode<T>` unchecked-cast contract; JSDoc'd; contract pinned by test. |
| B2 | **DEFERRED** | JIT reachable mid-decode — this is the refactor target, not a bug fix. Standing test retained. |
| B3 | **DEFERRED** | Numeric-width contract — a design decision folded into the refactor. |
| H3/H4 | **DEFERRED** | Compiler SBC-hint parity/options — depend on the new wire contract; retire+redo with the static-hint work. Their original tests were retired (M9's detection tightening invalidated the structural-`codec` fixtures). |

**Caveat carried from the B4 fix:** inference-path collision recovery uses linear probing, so a
*genuine* FNV-1a/32 collision between distinct shapes yields a registration-order-dependent probed
hash that won't round-trip through `serializeRegistry`. No longer constructible via field names (B4's
main vector is closed); a fully order-independent fix would need a wider hash or a compound
(hash+definition) registry key.

---

## Performance landscape (web research, 2026-09-17)

**No current published benchmark shows any alternative beating SBC on equivalent workloads.** SBC's
architecture (specialize-once-per-shape, reuse, drop field names, pack numerics) is already
competitive; "more performant" is workload-dependent. Shortlist to benchmark against (priority, not a
measured ranking): **msgpackr shared-records**, **Protobuf-ES 2.14+**, **avsc (Avro)**, **Apache
Fory**, **static protobuf.js** (eval-free control), **FlatBuffers/Cap'n Proto** (only win on sparse
reads).

Actionable: the repo's `bench/sbc/sbc-vs-msgpack.bench.ts` uses top-level `pack()/unpack()` (plain
MessagePack maps) — it does **not** exercise msgpackr's shared-record mode, so today's comparison is
not apples-to-apples. Fix the bench before drawing conclusions.

**Corrections to the eval-removal rationale (this reshapes the refactor motivation):**
- Cloudflare Workers no longer blanket-ban codegen — `allow_eval_during_startup` is default for compat
  dates ≥ 2025-06-01. Startup compilation of known schemas is allowed; *request-time* inference and
  remote schema-miss resolution remain the real constraint.
- Hermes/React Native implements the `Function` constructor; the restriction is local lexical `eval`.
- Strict-CSP browsers remain the genuine hard blocker.
- **Protobuf-ES 2.14 (Aug 2026): ~5× encode / 2× decode by caching field reader/writer *closures* —
  no source-string codegen, no `Function`.** This is a third refactor option alongside interpreter and
  AOT: keep runtime specialization *without* eval via closure/function-table dispatch.

Net: eval removal is driven more by strict-CSP + auditability than by "it's banned"; and the
throughput cost of removal need not be large (closure dispatch is a proven middle path).

---

## Blockers (must resolve before any static design is locked)

These are design-level, not ordinary bugs. They gate the wire contract and the static API shape.

### B1 — Reference layout is ambiguous and order-dependent → forces a wire version. *(was Finding 1, understated)*
`src/sbc/codegen.ts:54`, `:66` (`collectRefHashes`), `:225`, `:390`; `src/sbc/index.ts:234`.
When a referenced child schema is already compiled, the parent emits **length-prefixed child
fields**; otherwise it emits a **tagged object** — and the parent hash does not distinguish the two
layouts. This is **not** limited to manual mis-ordering: a fresh codec decoding a nested explicit
schema through the default shared cache throws `SBC: truncated`, because
`resolveSchemaFromCacheOrStore` compiles the parent before the child exists in the local registry,
so `collectRefHashes` picks the tagged layout. A registry serialized parent-first hits the same
path. **This breaks the deferred/remote resolution path the whole feasibility verdict relies on.**
Fix: choose one canonical reference layout independent of registry state; version the wire.

### B2 — JIT can fire mid-decode, not just at entry. *(net-new, missed by original audit)*
`src/sbc/codegen.ts:409` (non-ref object path) calls `_lk` = `resolveSchemaFromCacheOrStore` →
`defineSchema` → `compileSchema`. A static/`new Function`-free entry point must replace this **inner
lookup**, not merely the top-level `decode`/`encode`. Any "no-codegen" client that still routes
through this path will re-enter the JIT.

### B3 — Numeric width inference is a wire-changing contract decision. *(underweighted)*
`src/sbc/schema.ts:271`. Static mode cannot reproduce per-value narrowing + sibling widening
without runtime state. Every `number` field needs an explicit width contract (fixed, or
pre-generated adaptive branches), and that decision changes bytes for existing data. Must be settled
before the static API and the wire version are finalized.

### B4 — Hash scheme is ambiguous and collisions are fatal. *(Finding 3 + net-new)*
`src/sbc/schema.ts:10` (delimiters are also legal field-name chars — `a`/`b` and
`"aÿuint8þb"` both hash to `472543302`); `src/sbc/index.ts:730` (`defineSchema` returns an
existing hash with no definition comparison). Additionally, an inference-path collision throws an
**unrecoverable** error at `src/sbc/schema.ts:240` — rare with 32-bit FNV but fatal at thousands of
shapes. The redesign must use length-prefixed canonical input, compare definitions at every
registration boundary, and make collisions recoverable. Changing the hash requires the B1 wire
version.

---

## Correctness findings (fix before porting behavior into a generator)

Ranked high → low. All SBC items below were reproduced in-memory by both models; compiler items are
source-verified.

### High

**H1 — Object decoders don't enforce payload boundaries or depth.** *(Finding 2)*
`src/sbc/index.ts:477`, `:513`; `src/sbc/codegen.ts:554`, `:390`; `src/sbc/extract.ts:20`.
Zero-length frame still decoded a trailing `uint16` (`n:43981`); truncated buffer decoded the
missing value as `0`; 100-deep nesting bypassed the tagged decoder's depth guard. Nuance: the
`decode(buffer, 9)` overread only occurs when the frame length is *also* zeroed — with the real
length it throws at `index.ts:513`. Pass and enforce an explicit end/depth budget through every
decode and extract path.

**H2 — Explicit nested schemas silently truncate values.** *(Finding 4)*
`src/sbc/index.ts:40`, `:368`, `:406` (`matchesTypedField` only checks object-ness);
`src/sbc/codegen.ts:196`, `:237`. `{child:{x:300}}` against a `uint8` child decoded as
`{child:{x:44}}` — on both the hinted path *and* plain `encode`. Validate referenced schemas
recursively.

**H3 — Compiler "parity-or-omit" guarantee is false.** *(Finding 5, + error-behavior nuance)*
`src/compiler/sbc/index.ts:45`, `:156`; `src/sbc/schema.ts:213`. Nullable string hint produced
different bytes; absent optional decoded as an own `{"s":null}` key; extra own props dropped. Also:
the hinted `encode` path throws through `validateHinted` (`src/sbc/index.ts:586`) for inputs the
untransformed call accepted — the transform changes **error behavior**, not just bytes. Restrict
transparent optimization sharply, or expose an explicit contract whose divergence from inference is
documented.

**H4 — Compiler rewriting loses caller options.** *(Finding 6)*
`src/compiler/sbc/index.ts:233`, `:267` (injected `schema` appended after existing props, so it
wins), `:271` (spreads a boolean variable), `:298` (discards numeric decode length). Preserve
explicit options and evaluation semantics; leave ambiguous calls unchanged.

**H5 — Validator config silently vanishes; async runs un-awaited.** *(Finding 7)*
`src/compiler/index.ts:59` (`isAsyncFunction` only sees inline syntax), `:155` (non-literal config →
empty); `src/compiler/validator.ts:141`. Resolve supported static forms, reject unsupported ones,
detect async from call signatures.

**H6 — Hoisting/brand-inlining break scope and control flow.** *(Finding 8)*
`src/compiler/index.ts:204`, `:510`; `src/compiler/validator.ts:693` (brand bodies spliced as raw
text into a block, so a `return` exits the generated validator and free vars aren't carried);
`src/compiler/validators.ts:275`, `:299`; dedup keys on `typeToString` (`index.ts:511`). Preserve
lexical scope and callable boundaries; key caches on resolved identity.

**H7 — Generated validators accept values their return type excludes.** *(Finding 9)*
`src/compiler/validator.ts:65` (no `never` entry in `TYPE_VALIDATORS`), `:686` (template brand
skipped), `:966`, `:1190`; `src/compiler/type-analyzer.ts:267`, `:272` (bigint literals lose their
value). Implement these or emit build errors instead of widening.

**H8 — Resource limits incomplete/inconsistent.** *(Finding 10)*
`src/sbc/cache.ts:34`, `:106` (`createCache(0)`/negative loops forever — `evictOne` no-ops on empty
list); `src/sbc/schema.ts:375`; `src/sbc/tagged.ts:37`. Validate capacities; add coherent limits for
schemas, fields, nesting, payloads, traversal (incl. a cycle budget).

### Medium

**M1 — Lossless encoding: compression + cross-platform edges.** *(Finding 11)*
`src/sbc/codegen.ts:957` (compressed `-0` → `+0`); `src/sbc/size.ts:273` &
`src/sbc/platform.ts:59` (browser UTF-8 sizing mis-handles surrogates: `"\ud800é"` counted as 4
bytes vs Node/`TextEncoder` 5). Note: the surrogate case is a **cross-platform wire divergence**, not
just a sizing bug.

**M2 — Schema ingestion needs strict, transactional validation.** *(Finding 12)*
`src/sbc/schema.ts:79` (`type in KNOWN_TYPES` accepts inherited `toString` → encodes then decodes
`undefined`), `:375` (object hash > uint32 wraps; `object(4294967296)` → hash 0);
`src/sbc/index.ts:705`; `src/sbc/registry.ts:27` (import commits earlier entries before validating
later). Reject duplicate field names; canonicalize and validate the whole batch before committing.

**M3 — Encoder produces data its own decoder refuses.** *(Finding 13)*
`src/sbc/constants.ts:5`; `src/sbc/tagged.ts:95`; `src/sbc/registry.ts:23`, `:124`. 1,048,577-element
array and 1,025-schema registry encode/serialize but fail decode/deserialize. Enforce symmetric
limits; validate all u16/u32 counts.

**M4 — Cache APIs lose data.** *(Finding 14)*
`src/sbc/cache.ts:97` (`set` on existing key doesn't update); `src/sbc/async.ts:27`, `:97` (misses
not deduped; results rebuilt from bounded cache after insert — capacity 1 loses one of two fetched).
Return fetched results directly; define replacement semantics.

**M5 — JSON Schema generation loses info.** *(Finding 15)*
`src/json-schema.ts:86` (`__proto__` prop lost via ordinary assignment), `:148` (tuples always emit
`items:false`, ignoring rest); `src/runtime/index.ts:133` (annotations only from root props). Use
safe dictionaries; recurse metadata + tuple structure.

**M6 — Built-in assertions: boundary bugs.** *(Finding 16)*
`src/validators/multiple-of.ts:5` (`multipleOf(1e-7)` rejects `2e-7`); `src/validators/iso.ts:60`
(accepts Feb 31); `src/validators/url.ts:39` (`https://?` passes `url.https()`);
`src/validators/date-string.ts:19` (`0099` rejected via `Date.UTC` small-year handling).

**M7 — Public types obscure runtime distinctions.** *(Finding 17)*
`src/index.ts:29`, `:39` (explicit SBC `Schema` shadows generic `Schema<T>` from `src/types.ts:101`
through `export *`); `src/sbc/index.ts:184` (`decode<T>()` is an unchecked assertion),
`:802` (`typedSchemaFieldCounts` never shrinks on name-hash-collision delete — minor perf leak,
net-new); `src/sbc/types.ts:44` (`EncodablePrimitive` includes `DataView` which runtime rejects).
Export distinct `ValidatorSchema<T>`, `SbcSchema`, `SbcCodec`; tie safe typed decode to a codec def.

**M8 — Duplication makes optimization + AOT harder.** *(Finding 18)*
`src/sbc/codegen.ts:87`; `src/sbc/index.ts:705`; `src/sbc/size.ts:127`; `src/sbc/platform.ts:204`.
Layout built twice (inference vs explicit); encode/decode/size/extract each redescribe the wire;
compression compiles even when disabled; compiler field arrays re-sorted/re-hashed; `computeSize`
can compile+register. Separate layout construction from execution; hoist static defs.

**M9 — Plugin detection / residue checks too weak for a strict guarantee.** *(Finding 19)*
`src/compiler/sbc/index.ts:217` (matches any receiver with callable `defineSchema`);
`src/compiler/index.ts:337` (identifier-text matching); `src/compiler/residue.ts:23` (covers select
ESM spellings in `.js`, ignores SBC). Use semantic API identity + an independent emitted-bundle scan
for dynamic-eval and static-codec markers.

**M10 — Test coverage gaps.** *(Finding 20)*
`test/compiler/sbc/index.test.ts:24`; `test/compiler/plugins.test.ts:4`; `test/utils.ts:127`;
`test/sbc/codegen.test.ts:206`. Plugin tests inspect factory shapes; some compiler tests extract
hints instead of executing production output. Add real Vite/ts-patch builds, registration-order
permutations, nullable byte parity, scope captures, malformed-frame fuzzing, and differential tests
across interpreter/AOT/JIT.

### Low

**L1 — Docs + scaffolding cleanup.** *(Finding 21)*
`README.md:708` (`trim.start()`/`trim.end()` documented but absent from
`src/transformers/trim.ts`); stale error-prefix docs; redundant `void` exprs and stale comments at
`src/sbc/codegen.ts:136`, `src/sbc/size.ts:30`. Do dead-code removal after the module split.

---

## How the existing compiler relates to the JIT

Two different "compile times" today:
- Validator compilation emits **executable functions** + JSON Schema (`src/compiler/index.ts:529`).
- SBC compilation emits **field-spec hints passed back into the runtime codec**
  (`src/compiler/sbc/index.ts:233`) — it does **not** turn generated source into app functions.

Vite/tsc adapters register both (`src/compiler/plugins/vite.ts:8`, `tsc.ts:7`). The runtime JIT stays
reachable via: first-seen inference → `inferAndRegister` → `compileSchema`; explicit schemas/hints →
`defineSchema` → `compileSchema`; registry deserialization → `defineSchema`; cache/store/deferred
resolution → `defineSchema`; `computeSize` of an unseen object. The reusable foundation
(compiler adapters, type analysis, schema metadata, source emitters, primitive binary helpers, wire
tests) is meaningful; the missing pieces are an **interpreter** and an **AOT generator** that don't
import the JIT.

### Strict pre-generation feasibility by feature

| Feature | Strict pre-generation |
|---|---|
| Explicit literal schemas | Fully feasible, incl. referenced graph. |
| Closed TS object types | Feasible with explicit numeric/optional/nullable/extra-prop policies. |
| Arrays & recursive declared types | Feasible; loops/recursion run at runtime. |
| Plain `number` | Feasible with a fixed/adaptive **contract** (B3); exact historical inference is not reproducible statically. |
| Arbitrary first-seen keys | Not enumerable at build time → interpreter or restriction. |
| Null-first resolution/widening | Replace with declared contracts; current behavior needs runtime state. |
| Runtime `defineSchema` / unknown serialized schemas | Interpreter, unless every definition was pre-built. |
| Deferred remote resolution | Works via interpreter; static mode resolves only pre-generated defs. |
| Registry/cache | Runtime lookup structures; no codegen needed. |
| Compression / sizing / extraction | Generate from the same canonical layout. |

---

## Implementation plan (interpreter-first)

Sequencing reflects the reviewer's key correction: **build the interpreter first** — it's the fast
path to a `new Function`-free client, covers remote/first-seen schemas, and serves as the reference
oracle for differential-testing the AOT path. AOT becomes an optional optimization for declared
types.

### Phase 0 — Lock the wire contract & fix blockers. *(~2–3 weeks)*
Resolve B1–B4: one canonical reference layout independent of registry state; length-prefixed
canonical hashing with definition comparison at every boundary and recoverable collisions; the
numeric-width contract (B3). Fix correctness prerequisites H1, H2, M1 (surrogate divergence), M2,
M3. Introduce a **versioned wire format** with compatibility fixtures. (Original "1–2 weeks" was
light; hashing + layout + versioning + fixtures is the bulk.)

### Phase 1 — Extract a shared schema/layout representation. *(~1 week)*
Move field grammar, canonicalization, references, nullable layout, and compression rules into a
compiler-independent module. Keep executable functions separate from schema descriptions. Drive
encode/decode/size/extract from one representation (kills M8 duplication).

### Phase 2 — Build the interpreter (reference implementation). *(~1–2 weeks)*
Interpreter encoder ≈ `size.ts` with writes; interpreter decoder ≈ `extract.ts` generalized. No
`new Function`. Replace the **inner** lookup at `src/sbc/codegen.ts:409` / `resolveSchemaFromCacheOrStore`
(B2), not just top-level entry points. This alone yields a JIT-free client that still supports
dynamic, remote, and first-seen schemas. Cache/store/resolver APIs then operate on descriptions.

### Phase 3 — AOT source emitter (optional optimization). *(~1–2 weeks)*
Refactor `codegen.ts` to **return source/AST + helper requirements** instead of `eval`-ing it. Emit
ordinary functions (and replace the two empty `Ctor` sites with one-line declarations). Resolve refs
independent of registration order, incl. recursive graphs. Choose browser/Node target explicitly
rather than inheriting the build machine. Differential-test every output against the Phase 2
interpreter.

### Phase 4 — Explicit static API + mode separation. *(~1–2 weeks)*
New proposed API:

```ts
import { defineCodec } from '@esportsplus/data/sbc/static';

type Event = { name: string; active: boolean };

export const eventCodec = defineCodec<Event>();

const bytes = eventCodec.encode({ name: 'login', active: true });
const event = eventCodec.decode(bytes);
```

The plugin replaces `defineCodec<Event>()` with a pre-generated codec; unsupported/unresolved
definitions **fail the build**. Numeric widths and optional/null handling are documented contract
choices; output types reflect any normalization. Provide a **static entry point** (no inference/
codegen imports) alongside the existing dynamic API for incremental migration. Fix H3–H7 in the
compiler path here.

### Phase 5 — Packaging & compatibility verification. *(~1–2 weeks)*
Real Vite + ts-patch builds; assert emitted bundles contain neither dynamic eval nor compiler
modules (harden M9 residue scan). Run under disabled dynamic eval (CSP), test browser/Node
interchange, and diff bytes/decode/size/extract across interpreter vs AOT (M10). Measure bundle
size, startup, memory, throughput.

### Effort summary
- Interpreter-only, `new Function`-free client: **~4–6 weeks** (Phases 0–2).
- Full production static mode incl. AOT: **~7–11 weeks** (all phases).
Estimates assume one experienced maintainer; implementation estimates, not scheduled dates.

### Breaking changes
Versioned wire contract (unavoidable, B1/B3/B4); explicit codec definitions; static mode rejects
unknown schemas; mandatory build integration for static mode; corrected output typing. Shipping
static mode beside the existing API allows incremental migration.

---

## Traceability

Both models inspected `README.md`, package/build/test config, `src/index.ts`, shared types/
constants, all `src/sbc/` modules, all `src/compiler/` modules (both plugins + residue), `src/json-
schema.ts`, `src/runtime/index.ts`, validators/transformers, representative tests, test helpers, and
benchmarks. `claude-fable-5.1` additionally reproduced findings 1–5, 11–14 with in-memory Node probes
and spot-checked brand inlining (`validator.ts:693`) and `never` handling. Builds and full test suite
were not run.
