---
type: fix
recommended-model: opus
status: DEFERRED
priority: P1
source: findings D3, D9, D12, D13, D14 (audit section D)
depends-on: [relocate-tests-and-benches, sbc-schema-preregistration]
files-own: [src/sbc/index.ts, src/sbc/tagged.ts, src/sbc/codegen.ts, test/sbc/encode-safety.test.ts]
tests: [test/sbc/encode-safety.test.ts]
blocked-reason: dependency validator-boolean-coercion did not land — reverted
---

# Encode/decode fail loud: bigint ranges, hinted mismatches, non-encodables

## Rationale

D3 (P1): `tryEncodeSbc` (`src/sbc/index.ts:473-492`, mirrored `:452-471`) treats ANY `RangeError` as "buffer too small" and doubles — `writeBigInt64LE` throws `RangeError` outside int64, so `codec().encode(2n**64n)` doubles until `Array buffer allocation failed` (measured: OOM after 1122ms). D12 (P2): against a non-nullable hinted schema, missing/null fields throw RAW TypeErrors from generated code, and type mismatches corrupt silently — `encode({v:300}, uint8)` decodes `{v:44}`; `encode({v:'not a number'}, uint8)` → `{v:0}`. D13 (P2): `ArrayBuffer`/`DataView`/`RegExp`/`Error` values silently become `{}`; `function` → `null` (`src/sbc/tagged.ts:807-810`). D14 (P2): an empty buffer decodes to `undefined` instead of throwing (`tagged.ts:40-42`). D9 (P2): bytes/`Uint8Array` fields decode as Node `Buffer` (`tagged.ts:72-74`, `codegen.ts:433`) while README:80 documents `Uint8Array` — breaking userland deep-equality and `structuredClone`.

## Changes

Error discipline across the encode/decode surface: precise range checks before variable-width writes, named `Codec2:` errors for every failure class, spec-true decode types.

## Design

Settled decisions:

- **bigint range check up front (D3).** Before an int64 write, `v >= -(2n**63n) && v < 2n**63n` — out of range throws `Codec2: bigint out of int64 range` immediately. The grow-loop's catch narrows: only the codec's OWN needs-more-space signal grows the buffer; a foreign `RangeError` rethrows. No unbounded doubling path survives.
- **Hinted-path validation (D12, Q4 default).** When an EXPLICIT schema hint drives fixed-width writes: out-of-range numerics, non-numeric values for numeric fields, and missing/null on non-nullable fields throw `Codec2: field '<name>' …` errors naming the field — never raw TypeErrors, never silent truncation. Scope: the hinted path only; the inference path already narrows widths from values. (Optional question Q4 in the index records the perf trade; default is check-and-throw — silent corruption contradicts a validation library's headline.)
- **Non-encodable values throw (D13).** `RegExp`, `Error`, `DataView`, `ArrayBuffer`, functions at any depth throw `Codec2: unencodable value (<type>) at '<path>'`. DELIBERATELY KEPT: `undefined` → `null` and array holes → `null` (msgpack-family parity; readme-accuracy documents it).
- **Empty/truncated buffer throws (D14).** `decode` on a zero-length input throws `Codec2: empty buffer`.
- **Bytes decode as `Uint8Array` (D9).** Byte fields materialize as a plain `Uint8Array` COPY (constructor === Uint8Array, no pooled-buffer aliasing, `structuredClone`-safe), at `tagged.ts:72-74` and `codegen.ts:433`.
- Discretion point: whether hinted-path checks compile into the generated per-schema encoder (codegen.ts) or wrap in the driver; criterion — zero added work on the un-hinted inference path, one check per field on the hinted path.

Test plan (new `test/sbc/encode-safety.test.ts`): `2n**64n` throws `Codec2:` in <100ms with stable memory (no doubling); `-(2n**63n)` and `2n**63n - 1n` still round-trip; `{v:300}` + uint8 hint throws naming `v`; `{v:'x'}` + uint8 hint throws; missing non-nullable hinted field throws named error; RegExp/Error/DataView/ArrayBuffer/function fields throw with path; `{a:undefined,b:1}` still yields `{a:null,b:1}` (kept behavior); `decode(new Uint8Array(0))` throws; encoded `Uint8Array` decodes with `constructor === Uint8Array` and deep-equals the input; the 15/19 malformed-input errors verified at baseline stay intact.

## Reads

- src/sbc/platform.ts — writeBI64/readBI64 and buffer alloc primitives the range check fronts
- src/sbc/constants.ts — FIELD_SIZES for hinted-width checks

## Acceptance

- Every measured repro in the Rationale flips to a named `Codec2:` error or the spec-true type; kept behaviors (undefined→null, holes→null) unchanged and now asserted.
- 0 regressions in test/sbc/encode-safety.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/encode-safety.test.ts
- npx tsc --noEmit

## Notes

src/sbc/index.ts (grow-loop catch narrowing) is deliberately shared surface with sbc-schema-preregistration — the planner welds the two items and the depends-on edge orders them; expected, not a slicing error.
DEFERRED 2026-07-26T08:28:15.367Z run=f177cf28 class=dependency reason="dependency validator-boolean-coercion did not land — reverted" salvage=none
