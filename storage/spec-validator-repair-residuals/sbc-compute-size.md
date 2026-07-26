---
type: fix
recommended-model: opus
status: PENDING
priority: P2
source: finding D6 (predecessor audit section D)
depends-on: [bigint-int64-parity, infer-nullable-not-mixed, unify-packed-numeric-tags]
files-own: [src/sbc/size.ts, test/sbc/index.test.ts, test/sbc/size.test.ts]
files-shared: [src/sbc/index.ts, README.md]
tests: [test/sbc/size.test.ts, test/sbc/index.test.ts]
removes-tests: [test/sbc/index.test.ts]
---

# computeSize returns the exact encoded length; the -1 sentinel dies

## Rationale

Verified current at HEAD: `computeSize` (`src/sbc/size.ts:22-179`) returns an undocumented-by-type
`-1` at eight sites — non-Uint8Array views (:55), arrays (:59), schema'd arrays without a fixed
element rule (:89, :110), nested typed objects with any variable-width field (:142, :149, :156),
and every unlisted field type (:171) — and `SizeContext` does not even carry the codec's
`compress` flag, so compressed sizing is impossible today. README:262-285 now honestly documents
the sentinel, the compress inexactness, AND that a Map/Set returns a bogus positive number while
`encode` throws — documentation of defects this item deletes. The predecessor acceptance clause
requiring Map sizing (`-1 → 13`) is VOID: Map/Set are non-encodable at HEAD
(`src/sbc/types.ts:19-23`; encode throws `Codec2:`), so computeSize must throw there too, not size
them.

## Changes

`computeSize` becomes total over encode's exact domain: for every value `encode(v)` accepts,
`computeSize(v) === encode(v).length` — arrays, packed arrays under the unified tag-12 layout,
all typed arrays, nested objects with variable-width fields, nullable fields, and compressed mode
included; for every value `encode(v)` throws on, `computeSize(v)` throws the matching `Codec2:`
error. The `-1` sentinel is removed entirely, and the README section documenting it is rewritten
to the new contract (discharging the predecessor's open README follow-up).

## Design

Settled decisions. The invariant is DOMAIN AND SIZE AGREEMENT with encode, mirrored layout by
layout; the property corpus (below) is the enforcement mechanism, so the implementer can iterate
against it.

- **Public surface unchanged:** `computeSize<T>(value: T & Encodable<T>): number`
  (`src/sbc/index.ts:155`, `:925`). `SizeContext` gains `compress: boolean`, wired from the codec
  options where `sizeCtx` is built (`src/sbc/index.ts:911-918`).
- **Tagged (generic) values — mirror `encodeSbc` sizes:** null/undefined 1; boolean 1; number
  2 / 5 / 9 (uint8 / int32 / float64, same integer + `-0` rules); bigint 9 with the SAME range
  check — out of int64 throws `Codec2: bigint out of int64 range` (domain agreement, matching
  `src/sbc/tagged.ts:399-406`); string 5 + byteLen; Date 9; Uint8Array 5 + length; other
  TypedArrays 6 + byteLength (tag 17); DataView throws (encode's isView guard excludes it →
  unrepresentable); `number[]` classified via the shared `classifyPackedArray` from
  `src/sbc/platform.ts` — packable → 6 + bpe * length (tag 12), else 5 + Σ recursive element
  sizes (tag 7); non-plain objects (Map, Set, RegExp, class instances, functions, symbols) throw
  exactly the error the encode path they'd hit throws (`Codec2: unrepresentable value of type X`
  on the tagged path, `Codec2: unencodable value (X)` via encodeObj — mirror the path, not one
  blanket message).
- **Schema'd objects, uncompressed — extend the existing walker** (fixed fields and
  string/bytes/refHash-fixed cases already exact): arrays with `elementType` follow the codegen
  arms (fixed widths: varint count + count * width; string/bytes elements: varint count +
  per-element varint + payload; object(hash) elements: varint count + per-element varint prefix +
  recursive fields; container elements: varint count + tagged element sizes); generic arrays
  follow the flag layout (5 + count * bpe from the classifier, or 5 + tagged element sizes);
  nested typed objects (refHash) recurse over the ref schema's FULL field list — fixed AND
  variable — sizing `varintSize(nestedSize) + nestedSize` (the fixed-only walk at :121-160 with
  its -1 bailouts is replaced); `mixed`/`typedarray` fields size their value through the tagged
  rules; nullable fields: null → 0 bytes (bitmap already counted via `9 + schema.bitmapBytes`).
  A shape carrying a still-UNRESOLVED provisional field (infer-nullable landed first) sizes
  exactly what its provisional encode emits.
- **Compressed mode** (`ctx.compress && schema.compressible && schema.compressedEncodeFn` — the
  same predicate encode uses, `src/sbc/index.ts:635`): 9-byte outer header + null bitmap bytes +
  bool bitmap bytes (`ceil(boolFields/8)`) + pass-1 fixed (bigint/date 8, uint8/int8 1; booleans
  live in the bitmap; null fields skip) + pass-2 ints (`varintSize(zigzagEncode(v))` for
  int16/int32, `varintSize(v)` for uint16/uint32) + pass-3 adaptive float64 (integer within int32
  → 1 + `varintSize(zigzagEncode(v))`, else 1 + 8) + pass-4 variable fields sized as in the
  uncompressed arms. Mirror WHICH encoder each nesting level picks: ref-compiled nested objects
  always use the uncompressed `encodeFn`; `_encObj` nesting re-applies the compress predicate —
  follow `src/sbc/codegen.ts` compileCompressedEncoder (:895-1231) as the layout source of truth.
- **Sharing rule (carried discretion point, sharpened):** reuse the exported width primitives —
  `varintSize` (`src/sbc/schema.ts:59`), `zigzagEncode`-equivalent arithmetic, `byteLen`,
  `TYPED_ARRAY_BPE`, `classifyPackedArray` — one authority per width rule; NEVER import the
  codegen driver or compiled functions into size.ts. Where a layout rule exists only inside an
  emitted code string, a literal mirror in size.ts with a comment naming the codegen anchor is
  the accepted realization.
- **Registration side effect stays:** computeSize on an unseen shape already runs
  `inferAndRegister` (:66) — unchanged, and it is what makes size/encode agree on schema identity.

Test plan (`test/sbc/size.test.ts` — NEW mirror for `src/sbc/size.ts`; seed from the dropped
test(author) commit aab73c1 on tag `salvage/5776b305-u1` — recover with `git show aab73c1` from
the repo root, then DROP its Map/Set sizing cases per the void predecessor clause and replace them with
throw assertions):

1. Property corpus asserting `computeSize(v) === c.encode(v).length` on the SAME codec instance:
   primitives at every width boundary (0/255/256/±2^31-edges/-0/3.14/NaN/Infinity), bigint at the
   int64 edges (in-range sizes, out-of-range THROWS), strings (empty/ASCII 16-17 boundary/
   multibyte/surrogate pairs), Date, Uint8Array (0/3/big), every TypedArray type (6 + byteLength),
   packed arrays at each classified width (`[0,65535]`, `[-5,5]`, `[1.5]`, `[2**40]`), generic and
   nested arrays, plain/nested objects across the varint prefix boundaries (126/127/128/200/5000),
   nullable fields null and non-null, first-sample-null (provisional) shapes, declared schemas
   with variable fields.
2. The same corpus under `codec({ compress: true })` — bool bitmaps at the 1/8/9/16-bool
   boundaries, zigzag negatives, adaptive float64 integer-vs-real, nullable interactions.
3. Domain agreement: Map, Set, RegExp, class instance, function, symbol, DataView — computeSize
   throws, and the thrown message equals the one `encode` throws for the same value.
4. `test/sbc/index.test.ts` rewrites (REPLACED one-for-one, listed in removes-tests): 'returns -1
   for typed array' (:1908-1910) → exact 6 + byteLength equality; 'returns -1 for array'
   (:1912-1914) → exact equality; drop the `if (size !== -1)` tolerance guard at :1888. The
   first-sample-null case (formerly 'returns -1 for object with mixed field', :1916-1919) arrives
   ALREADY rewritten to encode-length equality by infer-nullable-not-mixed — verify it still
   holds under the total walker; do not expect a '-1' assertion to remain.

## Reads

- src/sbc/codegen.ts — the three encoder layouts being mirrored (compileEncoder :105-346,
  compileCompressedEncoder :895-1231)
- src/sbc/tagged.ts — encodeSbc's per-tag sizes (:392-722)
- src/sbc/schema.ts — varintSize (:59-77), inferAndRegister
- src/sbc/platform.ts — byteLen, TYPED_ARRAY_BPE, classifyPackedArray, zigzag arithmetic
- src/sbc/constants.ts — FIELD_SIZES (int64 key post-rename)
- src/sbc/types.ts — Encodable domain comment (:13-35), the type-level mirror of the runtime domain

## Acceptance

- The full corpus holds `computeSize === encode().length`, compress off AND on; the formerly
  documented divergences (array/typed-array → -1, compress inexact, Map/Set bogus positive) are
  all gone — no `-1` remains anywhere in `src/sbc/size.ts`.
- Non-encodable values throw the same `Codec2:` errors as encode; out-of-int64 bigints throw at
  computeSize.
- README's "Computing Encoded Size" section documents the exact-size + throw contract with no
  sentinel language (discharges the predecessor follow-up).
- 0 regressions in test/sbc/size.test.ts and test/sbc/index.test.ts, run scoped;
  `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/size.test.ts test/sbc/index.test.ts
- npx tsc --noEmit

## Directives

1. src/sbc/size.ts, src/sbc/index.ts — the total walker (tagged mirror, schema'd variable-field recursion, packed classification) plus SizeContext.compress and the compressed-layout sizing
2. test/sbc/size.test.ts — the mirror corpus, seeded from salvage aab73c1 with Map/Set cases converted to domain-agreement throw assertions
3. test/sbc/index.test.ts, README.md — the four sentinel assertions rewritten to exact equality; the "Computing Encoded Size" section (:262-285) rewritten to the new contract

## Notes

`test/sbc/types.test.ts:47-48` (`@ts-expect-error` on `computeSize(new Map())`) is TYPE-level and
stays valid unedited — the runtime throw for the same call is asserted in size.test.ts. This item
lands LAST in the sbc chain by design: it mirrors the final layouts (post-rename vocabulary, the
unified tag-12/flag layout, nullable inference), so any earlier sequencing would size dead
formats.
