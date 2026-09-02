# @esportsplus/data Audit Fix and Upgrade Spec

## Purpose

Land the fixes, cleanup, and performance work from the 2026-09-01 audit so the runtime codec (SBC)
and compiler surface are stable enough for `D:/lmdbx-js` to move from `@esportsplus/data` 0.8.4 to
the current major. Every item below was verified against HEAD `d1e0b61` and, where marked, reproduced
with a scratch test. Items are ordered so that observable-behavior fixes land first, mechanical
cleanup second, refactors third, and benchmark-gated changes last.

## Baseline

- **Commit**: `d1e0b61` (chore: bump version to 0.9.0), clean tree.
- **Non-compiler suites**: `vitest run test/sbc test/validators test/runtime test/layout.test.ts`
  → 20 files / 1312 passed.
- **Compiler suites**: 24 of 25 files pass. `test/compiler/json-schema.test.ts` fails because the
  TypeScript 7 sync RPC child hangs on recursive types and dies (see item 11); the file takes
  minutes instead of seconds. `tsc --noEmit` fails only on `test/utils.ts:23` against the linked
  `@esportsplus/typescript` 0.31.0 (repo pins ^0.29.5).
- **Environment note**: `pnpm-workspace.yaml` overrides `@esportsplus/typescript` to `link:../typescript`,
  which dangles inside a git worktree. `pnpm install` then runs `prepare` → `tsc -p tsconfig.build.json`
  with a missing `extends`, emitting ES5 `.js` beside every source file. Item 12 hardens this.

## Consumer constraints (lmdbx-js)

`D:/lmdbx-js` is the only downstream consumer. Verified usage at `src/store/helpers.ts`,
`src/store/buffers.ts`, `src/store/cursor.ts`, `src/modules/{encrypted,ttl}.ts`:

- `codec({ store })` on the DEFAULT shared cache with a persistent `__sbc` schema DB. Never passes
  `cache`, `compress`, or a schema hint.
- `encode(value, true)` (boolean view overload) via `viewEncode`.
- `decodeAt(buf, offset)` for every range/scan decode.
- `decode(bytes, length)` for point gets, where `bytes` is an OVERSIZED reusable scratch buffer and
  `length` is the real value length. The numeric overload is load-bearing.
- Types `PersistentStore`, `StoredSchema`.
- Relies on the `decode`/`decodeAt` cross-call cache staying coherent (subprocess regression
  `tests/regressions/getrange-sbc-cold-decode-2026-07-05.ts`).
- Still imports `encodeTypedArrayInto`, `decodeTypedArray`, `getTypedArrayType`, `TYPED_ARRAY_MARKER`
  (12 sites) — already removed here. Handled by the migration section at the end, not by this repo.
- Does NOT use `extractField`, `computeSize`, `defineSchema`, `serializeRegistry`,
  `deserializeRegistry`, or `Schema` internals.

Hard rules derived from the above:

1. Never remove or change the numeric `decode(buffer, length)` overload or the boolean `encode(value, view)`
   overload.
2. Never change how an EXISTING schema hash is computed or matched. Persisted `__sbc` registries key
   values by hash; a hash shift makes existing LMDB databases unreadable.
3. `decodeAt` must keep `lastDecodeHash`/`lastDecodeFn`/`lastDecodeSchema` paired.
   `test/sbc/decode-interleave.test.ts` is the gate.
4. No per-call allocation added to `decode`, `decodeAt`, or `encode(value, true)`.

## Features

### Stage 0 — behavior fixes (each with a regression test)

#### 1. plain-uint8array-decode
- **Bug**: `readStr` (`src/sbc/platform.ts:92`) calls `buf.utf8Slice`, a `Buffer`-only method. Any
  decode of a >16-byte or non-ASCII string from a plain `Uint8Array` throws
  `buf.utf8Slice is not a function`. Affects `decode`, `decodeAt`, `extractField`,
  `deserializeRegistry`, and every compiled decoder (`_rStr`).
- **Fix**: in the Node branch, check `typeof buf.utf8Slice === 'function'` once per call and fall back
  to `textDecoder.decode(buf.subarray(start, start + len))`. Do not wrap inputs in `Buffer.from` at
  the API boundary (allocation on lmdbx's hot path violates rule 4).
- **Test**: round-trip object, tagged string, `extractField`, and `deserializeRegistry` through
  `new Uint8Array(buf)` copies.

#### 2. compute-size-revalidates
- **Bug**: `resolveObjSchema` (`src/sbc/size.ts:128`) takes a `weakCache` hit without
  `revalidateCached`; after mutating a field's type family, `computeSize` returned 10 where `encode`
  produced 22 bytes.
- **Fix**: add `revalidateCached` to `SizeContext` and mirror `encode`'s resolution order exactly
  (weakCache → revalidate → matchSchema → inferAndRegister).
- **Test**: encode, mutate a field across type families, assert `computeSize(v) === encode(v).length`.

#### 3. cache-isolation-inference
- **Bug**: `inferAndRegister` (`src/sbc/schema.ts:386`) writes to the module singleton `cache`
  regardless of `CodecOptions.cache`. A codec built with `createCache()` still publishes every
  inferred shape globally; a default-cache codec decoded its buffer.
- **Fix**: thread the codec's `schemaCache` into `inferAndRegister` (add a parameter next to `store`;
  callers: `src/sbc/index.ts` ×2, `src/sbc/tagged.ts`, `src/sbc/size.ts`). Drop the direct
  `import cache from './cache'` in `schema.ts`.
- **Test**: the inverse of the existing `cache.test.ts` isolation cases (isolated codec encodes,
  default codec must NOT decode).
- **lmdbx-js impact**: none — it uses the default cache, which keeps receiving inferred shapes.

#### 4. decode-length-bound
- **Bug**: `decodeSbc` (`src/sbc/tagged.ts:42`) uses `len` only for the `len === 0` check; all bounds
  use `buf.length`. `decode(buf, 3)` of an 11-element array returned all 11 elements.
- **Fix**: pass an explicit `end` offset through `decodeSbc`/`decodeTagEnd` and use it in every
  bounds check. NO `subarray`. Keep the overload.
- **Perf rider**: the tag-8/18 fast paths in `decode()` require `len === buffer.length`, so lmdbx's
  oversized scratch buffers never take them. Relax to `9 + dataLen <= len && len <= buffer.length`.
  Compiled decoders then read from `pos` inside the larger buffer, which they already support.
- **Test**: truncated-by-`len` decodes throw `Codec2:`; oversized-buffer-with-exact-`len` decodes via
  the fast path (assert `lastDecodeFn` dispatch through a spy or by timing-independent contract).

#### 5. fixed-width-truncation-guards
- **Bug**: tags 3, 4, 9, 10, 11 have no bounds check in `decodeSbc` or `decodeTagEnd`; `[3]` decoded
  to `undefined`, `[11, 1]` to `1`, a truncated array to `[5, null]`. Tag 17 reads its header before
  checking `offset + 6`. Compiled float64/date/int64 typed-array arms have no truncation check and all
  typed-array arms allocate `new Array(l)` BEFORE the bounds check.
- **Fix**: add `Codec2:` bounds checks for every fixed-width tag in both functions (using the `end`
  from item 4); in codegen move the truncation check ahead of the allocation and add the missing
  8-byte-element checks.
- **Test**: one truncated buffer per tag; a hostile count with a tiny buffer must throw before
  allocating.

#### 6. extract-field-bytes-copy
- **Bug**: `src/sbc/extract.ts:252` uses `buffer.slice`, which on a `Buffer` aliases the source.
  README promises a copy.
- **Fix**: `new Uint8Array(buffer.subarray(p, p + l))`. While there: reuse the already-resolved
  `schema` instead of re-fetching `ctx.schemas.get(hash)` in the `array`/`object` arms, drop the
  redundant "all preceding fixed" pre-scan (the general scan already handles fixed fields), and
  read the nullable bitmap once.
- **Test**: `ext.buffer !== source.buffer`, `ext.constructor === Uint8Array`.

#### 7. hinted-array-validation
- **Bug**: `validateHinted` (`src/sbc/index.ts:46`) skips `array`, `object`, `mixed`, `typedarray`.
  A hinted `array<uint8>` holding a string encoded silently to `0`.
- **Fix**: validate typed-element arrays (`array<primitive>`) element-wise with the same
  `validateHintedInt`/type checks; `array<object(hash)>` elements must be non-null plain objects.
  Leave `mixed`/`typedarray` (tagged path already validates).
- **Test**: hinted `array<uint8>` with a bad element throws `Codec2:`.

#### 8. runtime-schema-node-clone
- **Bug**: `object()` (`src/runtime/index.ts:120`) mutates each child's `name`; sharing one node across
  two properties collapses them to one emitted property.
- **Fix**: shallow-clone the node before assigning `name`.
- **Test**: `schema.object({ a: s, b: s })` emits both properties.

#### 9. own-key-matching
- **Bug**: `matchSchema` and `revalidateCached` use `f.name in obj`, so a field named `toString` or
  `constructor` matches an object that lacks it.
- **Fix**: `Object.hasOwn`. Measure: `Object.hasOwn` vs `in` on the ring-buffer scan is within noise
  on V8; if not, fall back to `in` plus a one-time `INHERITED_KEYS` guard on schema fields.
- **Test**: schema with a `toString` field does not match `{ other: 1 }`.

### Stage 1 — dead code and duplication (mechanical, no behavior change)

#### 10. remove-dead-and-duplicate
Delete or merge, then re-run the full suite; expected byte-identical wire output.

- Never-read fields: `Schema.id` + `registry.nextId`, `Schema.fixedSize`, `Schema.compFixedSize`,
  `Schema.float64Fields`, `Schema.intFields`, `Schema.provisional` (keep the local in
  `inferAndRegister`), `FieldDef.offset`, `DecodeContext.setCache`.
- Dead driver members: `CodegenDriver.preamble`, `CodegenDriver.byteLen`, the `_rUtf8` decoder
  binding (both drivers).
- Duplicates in `src/sbc`: merge `resolveSchemaForDecode`/`resolveSchemaForEncode` → `resolveSchemaHint`;
  `tryEncodeSbc` → `tryEncode(boundEncodeSbc, …)`; `encodeObj` in `index.ts` delegates to the shared
  plain-object arm (extract `encodePlainObject(ectx, obj, buf, pos)` in `tagged.ts` and call it from
  both); export `zigzagEncode`, `unrepresentable`, and move `INT64_MIN`/`INT64_OVERFLOW` to
  `src/sbc/constants.ts` so `size.ts`, `tagged.ts`, `index.ts` share one copy.
- Compiler side: export `resolvePath` from `src/compiler/error.ts` and delete `renderChildPath` +
  `IDENTIFIER_SAFE_SOURCE` from `validator.ts`; one identifier regex in `src/constants.ts` replacing
  `VALID_IDENTIFIER`, `IDENTIFIER`, `IDENTIFIER_SAFE_SOURCE`, `FIELD_NAME_RE`; one `LiteralValue`
  type (in `src/types.ts`) replacing the four copies; one `FieldSpec` (`src/sbc/types.ts`) replacing
  the copies in `cache.ts` and `compiler/sbc/index.ts`; one `compare` and one regex-escape helper.
  Remove `EMITTERS.enum` (`src/json-schema.ts:282`), the unread `VALIDATOR_ALIASES` shared-context
  write, and the test-only `extractConstraints` export (tests call `extractConfig(...).constraints`).
- Config: delete `vitest.bench.config.ts` (unreferenced, wrong include path); drop the `"-"`/`"--"`
  placeholder scripts and the `agent:*` aliases from `package.json` unless the orchestrator needs them.

### Stage 2 — refactors (wire-format snapshot gated)

#### 11. type-analyzer-cycle-detection
- **Bug**: `analyzeObjectShape` (`src/compiler/type-analyzer.ts:114`) keys `visited` on `ts.Type`
  object identity. Under the TypeScript 7 sync API a back-edge can surface as a distinct wrapper for
  the same type, so `type Node = { next: Node }` recurses through the RPC channel until the child
  dies (278 s, then EOF). `defName` (line 449) also throws for alias symbols the newer API resolves
  differently.
- **Fix**: key `visited` and `defs` on the numeric type `id` exposed by the API (fall back to the
  object when absent); add a depth ceiling in `analyzePropertyType` that throws
  `TypeAnalyzer: recursion depth exceeded` instead of looping; resolve the def name through
  `getAliasSymbol() ?? getSymbol()` with the declaration's name as a final fallback.
- **Toolchain**: bump `@esportsplus/typescript` to the linked version and update `test/utils.ts:23`
  (2-argument `scratch`) in the same change. Gate: `test/compiler` completes in seconds and
  `tsc --noEmit` is clean.

#### 12. codegen-shared-emitters
- `compileDecoder` and `compileCompressedDecoder` have byte-identical `array`/`object` arms; the two
  encoders share their variable-field pass. Extract `emitArrayEncode`, `emitArrayDecode`,
  `emitObjectEncode`, `emitObjectDecode`, `emitStringEncode` taking `(field, index, driver, refHashes)`
  and returning source. Expected ~400 lines removed from `src/sbc/codegen.ts`.
- **Gate**: a new `test/sbc/wire-snapshot.test.ts` that encodes a fixed corpus (every field type,
  nullable, nested ref, packed array, compressed and uncompressed) and compares hex against
  checked-in snapshots generated BEFORE the refactor. `decode-interleave.test.ts` stays green.

#### 13. build-hardening
- `prepare` runs `pnpm build` on every install, including consumer installs that never need it and
  worktrees where the `extends` target can dangle. Guard `prepare` with a check that the base
  tsconfig resolves, or move the build to `prepublishOnly` only (already present). Add `src/**/*.js`,
  `test/**/*.js` (excluding `test/compiler/fixtures/*.js`) to `.gitignore` as a backstop.
- `residue.ts` `positionOf` is quadratic; precompute line starts once per file.

### Stage 3 — benchmark-gated (decide with lmdbx-js benches)

#### 14. weak-cache-evaluation
- `weakCache` was added for lmdbx-js. Decoded objects never enter it (the decode-side `setCache` is
  unused), so it only helps re-encoding the SAME object instance; every fresh object pays a
  `WeakMap.set` and every hit pays `revalidateCached`, which costs about one ring-buffer slot compare.
- **Action**: run `D:/lmdbx-js/scripts/bench` (put/get, range scan, encrypted, ttl lanes) with and
  without the weakCache branch. Keep it only if lmdbx-js shows ≥ 5 % on any lane; otherwise delete
  `weakCache`, `revalidateCached`, and `SizeContext.weakCache` (item 2 then simplifies to
  matchSchema → infer).

#### 15. numeric-width-convergence
- Inference registers a new schema per numeric width combination (2 fields × 4 widths = 16 compiled
  schemas, each 2–4 `new Function`s), and the registry/sibling lists/cache grow without bound.
- **Action**: in `inferAndRegister`'s sibling pass, when a sibling exists whose only difference is a
  WIDER numeric width for some fields, choose the sibling (widen) instead of registering a narrower
  variant; when the incoming record is wider, register the wider schema and leave the narrower one
  resolvable. Existing hashes and their field lists are never rewritten (rule 2). Gate with a
  regression that the 16-combination case converges to ≤ 4 schemas and with the lmdbx-js benches
  (widening costs bytes on the wire for small ints).

## Verification gate (every stage)

- `npx tsc --noEmit -p tsconfig.json` clean.
- `npx vitest run` — all files pass; `test/compiler/json-schema.test.ts` under 10 s after item 11.
- `test/sbc/wire-snapshot.test.ts` byte-identical across stages 1–3 except where item 15 deliberately
  changes NEW-encode schema choice (snapshot the old bytes as "still decodes").
- `test/layout.test.ts` updated for the deleted `vitest.bench.config.ts` (it is not listed there today;
  confirm nothing else references it).

## lmdbx-js migration (out of this repo, sequenced after Stage 2)

1. Bump `@esportsplus/data` to the released version containing Stages 0–2.
2. Replace the removed typed-array helpers. SBC now encodes typed arrays natively (tag 17, copy on
   decode), so `TYPED_ARRAY_MARKER` pre-checks in `src/store/buffers.ts` `decodeScanEntry`/`decodeValue`
   and the `encodeTypedArrayInto` write path can go. Values PERSISTED under the old marker format must
   remain readable: keep a read-only marker decoder inside lmdbx-js (port the 4-byte header + raw
   bytes reader) until a rewrite pass migrates stored values, then delete it.
3. Keep passing the real `length` to `decode(bytes, length)`; after item 4 it is enforced, so any
   caller passing a stale/oversized `length` will surface as a `Codec2:` error rather than a silent
   over-read — run the full lmdbx-js suite plus the cold-decode subprocess regression.
4. Re-run `scripts/bench` before/after; the item 4 fast-path relaxation should show up as a point-get
   improvement.

## Out of scope

- Compiler-generated validator semantics (coercion rules, message resolution) — no defects found.
- Validator regexes (`src/validators/*`) — reviewed a sample; no ReDoS-class patterns, no changes.
- The `ai-orchestrator` follow-up (was carried in the now-deleted `storage/spec-validator-repair-residuals/followups.md`).

## Implementation status (2026-09-01)

Orchestrated via codex `gpt-5.6-terra` subagents, one commit per item, gate verified after each. Baseline `d1e0b61`; final gate `npx tsc --noEmit -p tsconfig.json` clean and `npx vitest run` = 48 files / 1953 passed.

| Item | Slug | Commit | Status |
| --- | --- | --- | --- |
| 1 | plain-uint8array-decode | `1f23020` | landed |
| 2 | compute-size-revalidates | `a65a4cc` | landed |
| 3 | cache-isolation-inference | `e0f2c72` | landed |
| 4 | decode-length-bound | `5d799ab` | landed |
| 5 | fixed-width-truncation-guards | `29bec2f` | landed |
| 6 | extract-field-bytes-copy | `2661715` | landed |
| 7 | hinted-array-validation | `acc809d` | landed |
| 8 | runtime-schema-node-clone | `2b97958` | landed |
| 9 | own-key-matching | `45f76f3` | landed |
| 10 | remove-dead-and-duplicate | `e8d8dbc` | landed |
| 11 | type-analyzer-cycle-detection | `21fb423` | landed (json-schema test 278s→0.8s; tsc fully clean; ts bumped ^0.31.0) |
| 12 | codegen-shared-emitters | `80026c0` | landed (wire-snapshot gate added, byte-identical) |
| 13 | build-hardening | `f0da9cd` | landed |
| 14 | weak-cache-evaluation | — | **deferred** — delete/keep gate needs `D:/lmdbx-js` benches, which require the out-of-repo lmdbx migration first; weakCache left untouched |
| 15 | numeric-width-convergence | `6c675b1` | landed in-repo (convergence + "old bytes still decode" regression); wire byte-cost bench deferred with item 14 |

The lmdbx-js migration section and item 14's benchmark decision remain open for a follow-up against `D:/lmdbx-js`.
