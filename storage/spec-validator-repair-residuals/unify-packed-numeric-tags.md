---
type: refactor
recommended-model: opus
status: PENDING
priority: P2
depends-on: none
files-own: [src/sbc/codegen.ts, src/sbc/extract.ts, src/sbc/tagged.ts, test/sbc/codegen.test.ts, test/sbc/extract.test.ts, test/sbc/index.test.ts]
files-shared: [src/sbc/index.ts, src/sbc/platform.ts, README.md]
tests: [test/sbc/index.test.ts, test/sbc/codegen.test.ts, test/sbc/extract.test.ts]
removes-tests: [test/sbc/index.test.ts]
---

# Unify packed numeric arrays onto one typeId-carrying tag

## Rationale

Verified current at HEAD: tags 12/13/14 hardcode three element widths (decode arms
`src/sbc/tagged.ts:168-234`, `decodeTagEnd` `:331-369`); the tagged classifier is a three-phase
uint8/int32/float64 scan (`:537-643`); and the compiled generic-array path carries a SECOND copy of
the same three widths as `flag=1/2/3` emitted into generated code (`src/sbc/codegen.ts:267-281`
encoder, `:829-834` decoder, `:1145-1150` compressed encoder), which `src/sbc/extract.ts:172-207`
parses a THIRD time for field-skip math. History (predecessor commit-log evidence): c15016f added
12/13/14 as a msgpackr benchmark experiment; tag 17's general typeId mechanism arrived later in
86baaa6; nobody unified them. Result: arrays fall to int32 at 4 bytes/element where int8/int16/
uint16 would hold them losslessly, and three copies of one width enumeration. Collapsing onto tag
17's payload layout costs one header byte and buys the missing widths plus a single width
authority.

## Changes

Tag 12 is redefined to tag 17's payload layout — `[12][u8 typeId][u32 byteLen][raw bytes]` — and
tags 13/14 are permanently retired (never reassigned; decode throws unknown tag). The tagged
classifier widens from three widths to seven, selecting the narrowest lossless element width in one
pass. The compiled generic-array flag byte replaces its private 1/2/3 enumeration with the same
typeId (offset by one so flag 0 keeps meaning "generic tagged elements"), and field extraction
follows the same rule — leaving `TYPED_ARRAY_BPE`/`TYPED_ARRAY_IDS` plus one shared classifier as
the sole width authority for all three consumers. Tag 17 itself is untouched: it still returns a
TypedArray, tag 12 still returns a plain `number[]` — that fidelity split is the reason both
exist. Packed wire layout changes are version-bump-scoped under the carried no-back-compat
directive. `src/sbc/size.ts` is NOT touched: verified at HEAD it returns -1 for every array (no
packed sizing exists to update — the predecessor's claim was stale); sbc-compute-size, ordered
after this item, sizes the new layout.

## Design

Settled decisions.

- **Wire layout, tag 12:** `[12][u8 typeId][u32 byteLen][raw little-endian elements]` — byte-for-
  byte tag 17's payload layout (`src/sbc/tagged.ts:236-261`). Header grows 5 → 6 bytes. Decode
  derives `count = byteLen / bpe`, guards `byteLen % bpe === 0` (`Codec2: packed array byteLength
  not aligned`), guards count against `MAX_ARRAY_COUNT`, and reads UNALIGNED into a plain
  `new Array(count)` — do NOT copy to an aligned buffer (that `buf.buffer.slice` at :257-258 is
  tag 17's TypedArray-constructor need only) and do NOT materialize a TypedArray on either encode
  or decode (allocation + copy, slower than the code replaced). `decodeTagEnd` case 12 becomes
  `offset + 6 + byteLen`; cases 13/14 are deleted so both fall to the existing unknown-tag throw.
- **In-schema flag layout (compiled generic-array fields) keeps ELEMENT COUNT:**
  `[flag u8][u32 count][elements]`, but flag is redefined as `0 = generic tagged elements`,
  `else typeId + 1`. SETTLED — the offset is mandatory, not stylistic: raw typeId 0 is
  Float32Array and would collide with flag 0's generic meaning. Two length conventions are
  deliberate: tag 12 carries byteLen for wire parity with tag 17; the in-schema flag knows its
  width from the flag itself, and count keeps extract's skip math one multiply.
- **One classifier, one home.** Add `classifyPackedArray(a: number[]): number` (returns a
  `TYPED_ARRAY_IDS` typeId, or -1 for not-packable) to `src/sbc/platform.ts` beside the width
  tables — platform imports nothing, so every consumer (tagged, codegen-emitted code via bind
  args, extract, later size.ts) can share it without a cycle. Width rule, one pass tracking
  allNumber/allInteger/min/max with early exit on the first non-number: not all integers →
  float64; integers outside int32/uint32 range → float64 (a JS double is exact to 2^53); else the
  narrowest of uint8, int8, uint16, int16, uint32, int32 by [min, max] range, preferring unsigned
  at equal byte width when min >= 0 (preserves today's uint8-first behavior). float32 is excluded
  by construction (lossy for JS numbers); bigint64/biguint64 excluded (a number[] holds no
  bigints).
- **Encode writes elements directly into `buf` at the classified width** — the write-if-fits
  guard protocol from encode-growth-signal applies (one hoisted bounds check per element loop,
  positions always advance).
- **Kill the duplicate enumerations.** The codegen `flag=1/2/3` blocks (encoder :267-281, decoder
  :829-834, compressed encoder :1145-1150) are replaced with classifier-driven `typeId + 1`
  emission and a width-table-driven decode loop; `src/sbc/extract.ts:172-207` replaces its
  flag 1/2/3 arms with `flag > 0 → pos += count * TYPED_ARRAY_BPE[flag - 1]`. Leaving any 1/2/3
  width literal behind is an explicit failure of this item.
- **Tag registry comment** (`src/sbc/index.ts:135-152`): rewrite the tag-12 line to the new
  layout, delete the 13/14 lines (annotated retired, never reassign), and ALSO delete the stale
  15/16 map/set lines — verified still present at HEAD although remove-map-set-tags retired those
  tags. README wire-format table rows :88-90 collapse to one packed-array row naming the typeId
  layout.
- **Discretion point:** the decode element-read loop shape (per-width switch outside the loop vs
  a DataView-per-width helper) — criterion: no per-element branching on width, no per-element
  allocation.

Test plan (`test/sbc/index.test.ts` owns the tag surface, `test/sbc/codegen.test.ts` the compiled
path, `test/sbc/extract.test.ts` extraction):

1. REWRITE, never delete: the packed round-trips at :244-264 — now also asserting bytes:
   `encoded[0] === 12`, the typeId byte, and byteLen for a known input. The classifier-phase suite
   at :3987-4025 rewrites to the new expectations — note `[256, 1000, -1]` now packs as int16 at
   2 bytes/element (was tag 14 int32): assert the narrower width deliberately.
2. REWRITE the truncation suite at :1127-1183: tag-12 truncation (header and payload) still throws
   a named error via both `decodeTagEnd` and direct decode; the tag-13/14 truncation cases become
   unknown-tag assertions (`Codec2: unknown tag 13/14`); the huge-count guard at :1060 becomes a
   byteLen/bpe-derived count guard test; add a misaligned-byteLen throw case.
3. Narrowing table: `[0, 65535]` → 2 B/element (uint16), `[-5, 5]` → 1 B/element (int8),
   `[0, 255]` → uint8, `[1.5]` → float64, `[2 ** 40]` → float64, `[0, 300, 3.14]` → float64 —
   each round-trips to a plain `number[]` (`Array.isArray` true, `toEqual` input).
4. `new Uint8Array([...])` still encodes as tag 17 and decodes to `Uint8Array` — the fidelity
   split holds.
5. codegen.test.ts: a schema'd `number[]` field round-trips through the compiled path (all three
   compilers) with the new flag; its element payload bytes equal the tagged path's for the same
   data; no `flag=1/2/3` width literals remain in emitted code.
6. extract.test.ts: rewrite the :44 fixture to the new flag semantic; extraction skips past packed
   fields of each width correctly; the count cap still fires before position math.

## Reads

- src/sbc/constants.ts — MAX_ARRAY_COUNT, the count guard both layouts keep
- src/sbc/size.ts — verified untouched here (arrays still return -1 until sbc-compute-size)
- test/sbc/encode-safety.test.ts and test/sbc/types.test.ts — existing unknown-tag-15/16
  assertions as the pattern for the new 13/14 ones (not edited)

## Acceptance

- A `number[]` round-trips as a plain `number[]` at the narrowest lossless width per the table
  above; tags 13/14 throw `Codec2: unknown tag` on decode; tag 17 still returns a TypedArray.
- One width authority: the classifier + TYPED_ARRAY tables serve tagged, compiled, and extract
  paths; no 1/2/3 flag literals remain in `src/sbc/codegen.ts` emission or `src/sbc/extract.ts`.
- Compiled-path payload bytes match tagged-path payload bytes for the same data.
- 0 regressions in test/sbc/index.test.ts, test/sbc/codegen.test.ts and test/sbc/extract.test.ts,
  run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/index.test.ts test/sbc/codegen.test.ts test/sbc/extract.test.ts
- npx tsc --noEmit

## Directives

1. src/sbc/platform.ts — add classifyPackedArray beside TYPED_ARRAY_BPE/TYPED_ARRAY_IDS (the single width authority; pure function, no new imports)
2. src/sbc/tagged.ts, test/sbc/index.test.ts — redefine tag 12, retire 13/14, decodeTagEnd, widened classifier usage; rewrite the tag-surface, truncation, and classifier-phase tests in the same dispatch so the tree stays green
3. src/sbc/codegen.ts, test/sbc/codegen.test.ts — typeId+1 flag emission and decode in all three compilers; compiled-vs-tagged payload parity tests
4. src/sbc/extract.ts, test/sbc/extract.test.ts — flag-aware skip math; rewritten fixture
5. src/sbc/index.ts, README.md — tag registry comment rewrite (new 12, retired 13/14, drop stale 15/16 lines) and README wire-table rows :88-90

## Notes

Directives 2 and 3 touch INDEPENDENT wire regions (top-level tag 12 vs in-schema flag byte), so
the intermediate states are green: after directive 2 the compiled path still emits/decodes its old
flags. The salvage tag `salvage/5776b305-u1` carries no usable test material for this item (its
test commits covered schema and size only). `removes-tests` covers the net removal of the tag-13/14
truncation cases from test/sbc/index.test.ts; every other rewrite is one-for-one.
`depends-on: none` — the shared surfaces with encode-growth-signal (src/sbc/tagged.ts,
src/sbc/codegen.ts, files-own both) and with bigint-int64-parity (test/sbc/index.test.ts,
files-own both) are same-file contention the files-own weld serializes; index.md `## Features`
order runs both before this item. The guard-protocol reference in Design converges in either
order (encode-growth-signal guards whatever element loops exist when it runs).
