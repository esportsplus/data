---
type: fix
recommended-model: opus
status: DEFERRED
priority: P0
depends-on: [relocate-tests-and-benches, encode-growth-signal]
files-own: [src/sbc/tagged.ts, src/sbc/constants.ts, src/sbc/schema.ts, test/sbc/platform.test.ts]
files-shared: [src/sbc/codegen.ts, src/sbc/extract.ts]
tests: [test/sbc/platform.test.ts, test/sbc/index.test.ts]
blocked-reason: dependency validator-boolean-coercion did not land — reverted
---

# One int64 range behavior across Node and browser; rename the vocabulary

## Rationale

writeBI64 binds to Buffer.prototype.writeBigInt64LE on Node and to a DataView.setBigInt64 wrapper in the browser (src/sbc/platform.ts:127-129). Node throws ERR_OUT_OF_RANGE outside int64; setBigInt64 applies ToBigInt64 and wraps modulo 2 to the 64 silently, per spec. The same encode call therefore throws on the server and produces a corrupt-but-accepted buffer on the client. Tag 9 also advertises arbitrary-precision bigint while storing exactly 8 bytes, so the schema vocabulary is misnamed as well.

## Changes

The int64 range check moves to the call site in `src/sbc/tagged.ts` so Node and browser share ONE behavior — a named throw — instead of Node throwing while the browser wraps silently; and the schema vocabulary renames `bigint` to `int64` in `src/sbc/constants.ts`, `src/sbc/schema.ts`, and every enumerating arm in `src/sbc/codegen.ts` and `src/sbc/extract.ts`. Tag 9's wire layout is unchanged. Public API break: the FieldSpec type string changes, so shapes carrying it re-hash.

## Design

Settled decisions. Root cause: the bigint write path resolves to two different implementations with two different out-of-range behaviors, chosen by `isNode` at module load.

- **The divergence.** `src/sbc/platform.ts:127-129` binds `writeBI64` to `Buffer.prototype.writeBigInt64LE` on Node and to a `DataView.setBigInt64` wrapper in the browser. Node's method THROWS `ERR_OUT_OF_RANGE` for a value outside int64; `DataView.setBigInt64` applies `ToBigInt64`, which WRAPS modulo 2^64 silently, per spec. The same `encode(2n ** 64n)` therefore throws in Node and produces a corrupt-but-accepted buffer in a browser. `readBI64` (`:119-121`) has the mirrored asymmetry on the read side.
- **The name is also wrong.** Tag 9 and the `bigint` FieldSpec type (`src/sbc/constants.ts:14`, `:28`) advertise arbitrary-precision `bigint` while storing exactly 8 bytes. It is an int64, and the vocabulary should say so.
- **Decision — one behavior, checked before the write, on both platforms.** In `encodeSbc`'s `case 'bigint':` arm (`src/sbc/tagged.ts:463-466`), range-check against `-(2n ** 63n)` and `2n ** 63n - 1n` BEFORE calling `writeBI64`, throwing `Codec2: bigint out of int64 range: <value>`. The check lives at the call site, not inside the two platform bindings, so both paths get identical behavior from one guard and neither binding is wrapped in a closure that would cost a call on the hot path.
- **Rename the vocabulary, keep the tag.** `bigint` becomes `int64` in `FIELD_SIZES` and `KNOWN_TYPES` (`src/sbc/constants.ts:14`, `:28`), in `inferType`'s `case 'bigint': return 'bigint'` (`src/sbc/schema.ts:116`), and in every codegen/extract switch arm naming it. Tag 9 keeps its number — the wire layout is unchanged, only the schema-vocabulary string moves. Note this shifts `computeShapeHash` for any shape containing such a field, which is acceptable under this spec's no-back-compat directive.
- **Do NOT add a wide-bigint encoding.** A varint-length arbitrary-precision bigint is a real feature request, not a defect fix, and it would put an unbounded allocation on the decode path. Recorded as a follow-up; out of scope here.

Test plan (`test/sbc/platform.test.ts` for the bindings, `test/sbc/index.test.ts` for the codec surface):

1. `encode(2n ** 63n)` and `encode(-(2n ** 63n) - 1n)` each throw `Codec2: bigint out of int64 range` — asserted on the message, so the test is platform-independent and catches the browser path regressing to silent wrapping.
2. Boundary values `2n ** 63n - 1n` and `-(2n ** 63n)` encode and round-trip exactly.
3. The browser binding is exercised directly (construct the `DataView` wrapper from `src/sbc/platform.ts` rather than relying on `isNode`) and produces the same throw via the call-site guard — this is the assertion that proves the divergence is closed, and it is the reason the guard is at the call site.
4. `KNOWN_TYPES` carries `int64` and not `bigint`; a schema field typed `'bigint'` is refused by the existing unknown-type path.
5. A schema containing an int64 field round-trips through the compiled path and its `computeSize` equals the encoded length.

## Reads

- src/sbc/platform.ts — the writeBI64 / readBI64 bindings (:119-129) whose divergence this closes
- src/sbc/types.ts — FieldSpec, where the renamed type string is declared

## Acceptance

- Out-of-int64 values throw `Codec2: bigint out of int64 range` on BOTH the Node binding and the DataView binding, each exercised directly rather than through `isNode`.
- Boundary values `2n ** 63n - 1n` and `-(2n ** 63n)` encode and round-trip exactly.
- `KNOWN_TYPES` carries `int64` and not `bigint`; a field typed `'bigint'` is refused by the existing unknown-type path.
- 0 regressions in test/sbc/platform.test.ts and test/sbc/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/platform.test.ts test/sbc/index.test.ts
- npx tsc --noEmit

## Notes

2026-07-25 — SEVERITY RAISED to P0 by the deep audit. The divergence is worse than authored: on Node the out-of-range write throws ERR_OUT_OF_RANGE, which IS a RangeError, and tryEncode (src/sbc/index.ts:463-469) reads any RangeError as buffer-too-small — so encode({v: 2n**64n}) does not throw, it doubles the buffer inside while(true) until allocation fails. Hang plus OOM on the server, silent wrap to 0n in the browser (both verified by direct execution). encode-growth-signal is now a hard dependency and removes the swallowing catch; this item's call-site range check stops the value at source. Both are required — neither substitutes for the other.
DEFERRED 2026-07-26T08:28:15.318Z run=f177cf28 class=dependency reason="dependency validator-boolean-coercion did not land — reverted" salvage=none
