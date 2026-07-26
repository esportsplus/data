---
type: refactor
recommended-model: opus
status: PENDING
priority: P2
depends-on: [remove-map-set-tags]
files-own: [src/sbc/tagged.ts, src/sbc/codegen.ts, src/sbc/size.ts, test/sbc/index.test.ts, test/sbc/codegen.test.ts]
files-shared: [src/sbc/platform.ts]
tests: [test/sbc/index.test.ts, test/sbc/codegen.test.ts]
---

# Unify packed numeric arrays onto one typeId-carrying tag

## Rationale

Tags 12/13/14 hardcode three element widths because commit c15016f added them as a msgpackr benchmark experiment before tag 17 introduced a general typeId mechanism in 86baaa6; nobody unified them. The result is six switch arms where two suffice, a second copy of the same three-width enumeration emitted as flag=1/2/3 inside generated code (src/sbc/codegen.ts:265-277, :546-550), and arrays that fall to int32 at 4 bytes per element when int8 or uint16 would hold them losslessly. Collapsing onto tag 17's payload layout costs one header byte and buys eight more widths plus a single width authority.

## Changes

Tag 12 is redefined to carry a `u8 typeId` plus `u32 byteLen` — tag 17's payload layout — and tags 13/14 are permanently retired; the classifier in `src/sbc/tagged.ts` widens from three widths to seven, `src/sbc/codegen.ts` replaces its duplicate `flag=1/2/3` enumeration with the same `typeId`, `src/sbc/size.ts` follows the new 6-byte header, and `src/sbc/platform.ts`'s `TYPED_ARRAY_BPE`/`TYPED_ARRAY_IDS` tables become the single width authority for both the tagged and compiled paths. Public API break: the packed-array wire layout changes.

## Design

Settled decisions. Root cause of the three-tag split, from the commit log: `c15016f experiment(3): packed numeric array encoding in codegen — 4.37x encode, 5.70x decode vs msgpackr` added tags 12/13/14 hardcoding the exact three widths its classifier emitted; tag 17's general `typeId` mechanism arrived LATER in `86baaa6 feat(codec2): add Map, Set, and typed array value types (tags 15-17)` and the two were never unified. This item unifies them.

- **One tag replaces three.** Tag 12 is retained and redefined as `[12][u8 typeId][u32 byteLen][raw bytes]` — byte-for-byte the payload layout of tag 17. Tags 13 and 14 are PERMANENTLY RETIRED and never reassigned. Header grows 5 → 6 bytes per packed array; that single byte buys the other eight element widths.
- **Reuse the FORMAT, never the functions.** Do NOT materialize an intermediate TypedArray on encode: the classification scan already picks a width, so write the 6-byte header and then the elements DIRECTLY into `buf` at that width. Converting to a TypedArray first costs an allocation plus a copy and would be slower than the code being replaced. Do NOT call tag 17's decoder either: `src/sbc/tagged.ts:296-301` does `buf.buffer.slice(start, start + bLen)` to obtain an aligned backing buffer for the constructor, which a plain-array decode does not need — read unaligned into a single `new Array(count)` instead of allocating a TypedArray and then copying out of it.
- **Tag 17 stays a separate tag.** Tag 12 returns a plain `number[]` (`src/sbc/tagged.ts:175-182`); tag 17 returns the TypedArray. That fidelity distinction is the entire reason both exist and it is preserved exactly.
- **Widen the classifier.** The three-phase scan at `src/sbc/tagged.ts:639-689` currently resolves to uint8 / int32 / float64 only. Extend it to select the NARROWEST `TYPED_ARRAY_IDS` width that losslessly holds every element — int8, uint8, int16, uint16, int32, uint32, float64 — keeping its early-exit structure so a float in position 0 still short-circuits to float64 in one pass. Do not add float32: a JS number is a double and narrowing to float32 is LOSSY, so it is excluded by construction. `bigint64`/`biguint64` are likewise excluded — a `number[]` never contains bigints.
- **Kill the duplicate enumeration in codegen.** `src/sbc/codegen.ts:265-277` and `:546-550` carry a SECOND copy of the same three widths as `flag=1` / `flag=2` / `flag=3` emitted into generated code for schema'd array fields. Replace the flag byte with the same `typeId` from `TYPED_ARRAY_IDS`, so one table in `src/sbc/platform.ts` (`TYPED_ARRAY_BPE`, `TYPED_ARRAY_CTORS`, `TYPED_ARRAY_IDS`) is the sole width authority for both the tagged path and the compiled path. Leaving this duplicate behind is an explicit failure of this item.
- **Size accounting follows.** `src/sbc/size.ts` must presize a `number[]` under the new layout; where it currently bails or assumes a 5-byte header for packed arrays, update to 6 + `bpe * count` using the same classifier so `computeSize` stays exact.

Test plan (`test/sbc/index.test.ts` owns the tag surface; `test/sbc/codegen.test.ts` the compiled path):

1. Rewrite the byte-literal assertions at `test/sbc/index.test.ts:208-226` ('packed uint8 array', 'packed int32 array', 'packed float64 array') to the new 6-byte header and `typeId` — rewritten, never deleted.
2. Rewrite the truncation suite at `:1094-1140` (F-TEST-3), including the direct `decodeSbc` cases at `:1132-1140`, to the new layout; every truncation still throws its named error.
3. Narrowing coverage: `[0, 65535]` encodes at 2 bytes/element (uint16), `[-5, 5]` at 1 byte/element (int8), `[1.5]` at 8 (float64), and each round-trips to a plain `number[]` with `Array.isArray` true and values `toEqual` the input.
4. `new Uint8Array([...])` still encodes as tag 17 and decodes to a `Uint8Array` — the two tags stay distinguishable.
5. A hand-built buffer with tag 13 or tag 14 throws `Codec2: unknown tag`; a schema'd array field round-trips through the compiled path with `typeId` and its bytes match the tagged path's payload for the same data.
6. `computeSize` on each narrowing case equals the actual `encode(...).length`.

## Reads

- src/sbc/index.ts — the tag registry comment block (:34-39), rewritten to the unified layout
- src/sbc/extract.ts — field extraction over array fields, verified to need no header change

## Acceptance

- A `number[]` round-trips as a plain `number[]` at the narrowest lossless width: `[0, 65535]` costs 2 bytes/element, `[-5, 5]` costs 1, `[1.5]` costs 8.
- Tags 13 and 14 throw on decode; tag 17 still returns a TypedArray; codegen emits `typeId` rather than `flag=1/2/3`, with one width table shared by both paths.
- `computeSize` equals `encode(...).length` for every narrowing case.
- 0 regressions in test/sbc/index.test.ts and test/sbc/codegen.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/index.test.ts test/sbc/codegen.test.ts
- npx tsc --noEmit

## Notes

DEFERRED 2026-07-26T08:28:15.245Z run=f177cf28 class=dependency reason="dependency validator-boolean-coercion did not land — reverted" salvage=none
