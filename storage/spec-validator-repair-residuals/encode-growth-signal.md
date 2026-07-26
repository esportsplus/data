---
type: fix
recommended-model: opus
status: PENDING
priority: P1
depends-on: none
files-own: [src/sbc/codegen.ts, src/sbc/index.ts, src/sbc/tagged.ts, test/sbc/encode-safety.test.ts]
tests: [test/sbc/encode-safety.test.ts, test/sbc/index.test.ts]
---

# Encode overflow stops signalling through RangeError; growth stays bounded

## Rationale

Re-anchored against HEAD — roughly half the predecessor item has already landed and must NOT be
re-implemented: the growth loop is bounded (`MAX_ENCODE_BUF = 0x7fffffff` at `src/sbc/index.ts:31`,
cap checks inside both catch blocks at `:589-593` and `:616-620`), the bigint value-range checks
that produced the original hang now sit at every call site (`src/sbc/tagged.ts:399-406`, compiled
arms in `src/sbc/codegen.ts`), and the tagged string/bytes/typed-array paths already use a
write-if-fits protocol (`src/sbc/tagged.ts:476-480`, `:500-504`, `:525-529` — bounds-check, skip
the write when it does not fit, return the `needed` position past the buffer so the success-path
check `end <= encodeBuf.length` triggers growth).

The REMAINING defect is the original root cause: buffer overflow and genuine value errors still
share one channel. `tryEncode` (`src/sbc/index.ts:573-598`) and `tryEncodeSbc` (`:600-625`) treat
ANY `RangeError` as buffer-too-small. Two live consequences at HEAD: (1) a `RangeError` raised by
user code (e.g. a property getter) during encode triggers up to ~15 spurious buffer doublings —
allocating up to 2 GB — before the cap rethrows, and leaves `encodeBuf` permanently grown; (2)
worse, a getter that throws a `RangeError` ONCE and then returns normally has its error swallowed
entirely — the catch grows the buffer, the retry calls the getter again, and encode SUCCEEDS.
Error-as-control-flow of exactly the kind the coding standards ban.

## Changes

Buffer overflow stops being signalled through an exception type anywhere on the encode path: every
write that can throw `RangeError` on overflow (the Node `Buffer.prototype` fixed-width writers, the
browser `DataView` writers, `b.set`, the UTF-8 writers) becomes a guarded write-if-fits site in both
the tagged encoder and all three compiled-encoder generators. With no overflow source left that
throws, both `catch` blocks in the retry loops are DELETED outright; growth happens only through the
success-path `needed`-position check, still bounded by `MAX_ENCODE_BUF` plus a defensive iteration
cap. A `RangeError` escaping encode then means what it says.

## Design

Settled decisions. Root cause: overflow and value errors share the RangeError channel; the fix is
to make overflow never throw, then delete the catch — never to narrow it.

- **The protocol (already precedent at HEAD).** A write site that would overflow is skipped, but
  the position variable still advances as if it had been written; the retry wrapper's success-path
  check (`end <= encodeBuf.length` at `src/sbc/index.ts:578`, `:605`) detects the overshoot, grows
  the buffer to `Math.max(end, encodeBuf.length) * 2`, and retries. `b[p] = x` on a `Uint8Array`
  past the end is silently discarded, so bare byte writes need no guard.
- **Tagged encoder — guard the four unguarded throwing sites** in `src/sbc/tagged.ts` `encodeSbc`:
  the bigint write (`writeBI64.call` at `:405` — guard `pos + 9 <= buf.length`), the float64 number
  write (`writeF64.call` at `:433`), the date write (`:486`), and the packed float64 element loop
  (`:634-641` — hoist ONE guard for `pos + 5 + len * 8` before the loop; when it fails, skip the
  loop entirely and return the needed end). Strings, bytes, typed arrays are already guarded.
- **Compiled encoders — emit guarded writes** in `compileEncoder` and `compileCompressedEncoder`
  (`src/sbc/codegen.ts`): guard every emitted `_wF64.call` / `_wBI64.call` (fixed-width: guard
  `p + 8 <= b.length`, always advance `p += 8`), every `d.writeStr(...)` (guard `p + l <= b.length`
  after the varint prefix; `writeVarint`'s own `b[pos++]` writes are silent-discard-safe), every
  `b.set(v, p)` in the bytes arms, and hoist one guard per fixed-width element LOOP (float64/date/
  bigint array arms, packed flag=3 arm) rather than per element. Nested ref-encoder calls need no
  extra handling — the nested compiled encoder follows the same protocol and returns a position
  past the buffer, and `b.copyWithin` clamps silently. `encodeObj` (`src/sbc/index.ts:212`) runs
  compiled encoders, so it is covered by the same emission change.
- **Delete both catch blocks** (`src/sbc/index.ts:584-597`, `:611-624`) — deleted, not narrowed.
  Move the bound to the success path: before growing, if the needed end exceeds `MAX_ENCODE_BUF`,
  throw `Codec2: encode buffer growth exceeded`; additionally cap the retry loop at a hard
  iteration limit (32) with the same error as defence in depth. Rewrite the now-stale comments at
  `:28-31` and `:571-572` (they describe the RangeError-catch design).
- **Named unknown, made irrelevant:** `Buffer.prototype.utf8Write`'s overflow behavior on Node is
  unverified — the uniform guard in front of every `writeStr` site makes its behavior moot.
- **Discretion point:** exact guard placement/shape in the emitted code strings — criterion: at
  most one bounds compare per fixed-width field and one per element loop, never one per element;
  the emitted fast path for a fitting buffer must not gain more than the compare itself.
- **Perf sanity, not a gate:** this is not a `type: perf` item; after implementation, an eyeball
  run of `pnpm agent:bench bench/sbc/sbc-standalone.bench.ts` against a pre-change run is prudent
  since the guards sit on the hot path.

Test plan (`test/sbc/encode-safety.test.ts`, new describe block):

1. THE REPRO — a plain object with a getter that throws `new RangeError('user range error')` on
   its FIRST read and returns a number afterwards: `encode` must THROW that exact error. Fails
   before the fix (the catch grows the buffer, retries, and the second read succeeds — the error
   is swallowed and encode returns bytes).
2. A getter that always throws `RangeError` propagates it unchanged (message asserted) with no
   multi-second growth stall.
3. A `bytes` field larger than the initial 65536 buffer still round-trips; a payload over 1 MB
   (string + packed float64 array + nested objects) still round-trips — growth survives the catch
   deletion, on both the tagged and compiled paths.
4. `encode(2n ** 64n)` still throws `Codec2: bigint out of int64 range` immediately (existing D3
   coverage in this file — must stay green, proving the value-range guard and the growth rewrite
   compose).
5. The existing `buffer growth` suite in `test/sbc/index.test.ts:690-730` stays green unmodified —
   it is regression coverage for this item, listed in `tests` but not edited.

## Reads

- src/sbc/platform.ts — allocBuf/copyBuf and the writeBI64/writeF64/writeUtf8 bindings whose throw
  behavior the guards neutralize (Node Buffer prototypes vs browser DataView wrappers)
- src/sbc/size.ts — the presize path that can avoid the retry loop; unchanged here
- test/sbc/index.test.ts — the buffer-growth suite (:690-730) that must stay green unmodified
- bench/sbc/sbc-standalone.bench.ts — the optional perf-sanity target named in Design; RUN-ONLY,
  never edited (this item is not `type: perf` and carries no bench gate)

## Acceptance

- The once-throwing-getter repro: encode THROWS the user's `RangeError` instead of succeeding —
  fails before the fix, passes after.
- An always-throwing user `RangeError` propagates unchanged; no `catch` inspecting
  `instanceof RangeError` remains anywhere in `src/sbc/` (source-level review check).
- A bytes field > 64 KB and a > 1 MB mixed payload round-trip on both tagged and compiled paths.
- `encode(2n ** 64n)` still throws immediately (D3 stays green).
- 0 regressions in test/sbc/encode-safety.test.ts and test/sbc/index.test.ts, run scoped;
  `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/encode-safety.test.ts test/sbc/index.test.ts
- npx tsc --noEmit

## Directives

1. src/sbc/tagged.ts — guard the four unguarded throwing write sites (bigint, float64, date, packed-float64 loop) with write-if-fits bounds checks that still advance the position
2. src/sbc/codegen.ts — emit bounds-guarded writes in compileEncoder and compileCompressedEncoder (per-field guard for fixed-width `_wF64`/`_wBI64`, guarded `writeStr`/`b.set`, one hoisted guard per element loop)
3. src/sbc/index.ts — delete both RangeError catch blocks; enforce MAX_ENCODE_BUF plus a hard iteration cap on the success-path growth, throwing `Codec2: encode buffer growth exceeded`; rewrite the stale comments at :28-31 and :571-572
4. test/sbc/encode-safety.test.ts — add the once-throwing-getter repro, the always-throwing propagation case, and the large-payload growth cases

## Notes

Directive order is load-bearing: the catch deletion (directive 3) is only safe after directives 1-2
have removed every overflow-throw source; each intermediate state keeps the catch and stays green.
The predecessor's impl seat (run 5776b305) exited completed with no commits; salvage tag
`salvage/5776b305-u1` carries no test material for this item — the test plan above is authored
fresh against HEAD. The `MAX_ENCODE_BUF` bound itself landed between predecessor authoring and
HEAD; do not re-add a second constant.
