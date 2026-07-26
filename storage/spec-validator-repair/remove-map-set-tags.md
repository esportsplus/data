---
type: refactor
recommended-model: opus
status: PENDING
priority: P1
depends-on: [relocate-tests-and-benches]
files-own: [src/sbc/tagged.ts, src/sbc/constants.ts, src/sbc/schema.ts, src/sbc/size.ts, src/sbc/extract.ts, test/sbc/index.test.ts]
files-shared: [src/sbc/codegen.ts, src/sbc/index.ts]
tests: [test/sbc/index.test.ts]
---

# Remove Map and Set value types (tags 15/16)

## Rationale

Map and Set are the only KNOWN_TYPES that bail out of the compiled fast path without earning it: tags 15/16 recurse encodeSbc per key and per value with no schema hash and no packing (src/sbc/tagged.ts:595-634), computeSize refuses to presize them (src/sbc/size.ts:54-56), and they are the reason finding D1 exists at all — the compile-time analyzer has no case for them, so a Map field silently encodes to an empty object. Under the no-back-compat directive they are removed rather than repaired; tag 17 keeps typed-array fidelity and the object path keeps records.

## Changes

Map and Set cease to exist as value types: tags 15/16 are permanently retired, their encode and decode arms in `src/sbc/tagged.ts` are deleted, `map` and `set` leave `KNOWN_TYPES` in `src/sbc/constants.ts`, `inferType` stops classifying them in `src/sbc/schema.ts`, the `computeSize` bail in `src/sbc/size.ts` goes with them, and every enumerating switch arm in `src/sbc/codegen.ts` and `src/sbc/extract.ts` drops to `typedarray` plus `mixed`. Public API break: encoding a Map or Set is no longer supported, and a v0.8.4 buffer carrying one now fails loud on decode.

## Design

Settled decisions. The user's standing directive for this spec block: no backward-compatibility carrying, public-API breaks are permitted, target is clean/lean/fast.

- **Delete the Map branch and the Set branch from the tagged encoder** (`src/sbc/tagged.ts:595-615` Map, `:617-634` Set) and their decoders (case 15 and case 16). Tags 15 and 16 become PERMANENTLY RETIRED — they are never reassigned, because tag 17 (typed array) must keep its current number for wire compatibility with the packed-numeric unification landing alongside this item.
- **`decodeSbc`'s `default:` throw (`src/sbc/tagged.ts:304-305`, `Codec2: unknown tag <n>`) becomes the handler for tags 15/16 automatically** — a buffer produced by v0.8.4 carrying a Map now fails LOUD on decode instead of silently producing a wrong value. This is the intended behavior and needs no new code; assert it in the suite.
- **Remove `map` and `set` from `KNOWN_TYPES`** (`src/sbc/constants.ts:36`, `:39`). They are FieldSpec vocabulary; with the tags gone a schema can no longer name them.
- **Remove them from every switch that enumerates them:** the codegen bail group `case 'map': case 'set': case 'typedarray': case 'mixed':` at `src/sbc/codegen.ts:865` and `:1187` keeps only `typedarray` and `mixed`; `src/sbc/codegen.ts:308` and `:593` (`case 'typedarray':` neighborhood) drop any map/set arm; `src/sbc/extract.ts` drops its map/set arms; `src/sbc/schema.ts:151-157` (`inferType`'s `instanceof Map` / `instanceof Set` returns) is deleted so a Map now infers as `object`.
- **Remove the Map/Set bail from `computeSize`** (`src/sbc/size.ts:54-56` returns -1 for `value instanceof Map || value instanceof Set`). With the types gone the bail is dead; `ArrayBuffer.isView` (`:58-60`) and the array bail (`:62-64`) stay.

Encoder behavior after removal — this is the ONE decision that must not be improvised. A Map reaching `encodeSbc` falls through `Array.isArray` to the generic object arm, where `Object.keys(map)` yields `[]` and the value silently encodes as `{}`. That is total data loss and is REFUSED. `encodable-type-constraint` (the next item) installs the named throw for every value the encoder cannot represent, and it owns that code. This item therefore lands with `encodable-type-constraint` as a hard successor: until that item lands, the suite MUST carry an xfail-free explicit test asserting the current fall-through is unreachable from typed call sites, and this item's own tests only cover decode-side rejection plus the symbol/vocabulary removals. Do NOT add a bespoke Map/Set throw here — one guard, one owner.

Test plan (`test/sbc/index.test.ts`, the suite that owns the tag surface):

1. Every existing Map and Set round-trip case in `test/sbc/index.test.ts` is DELETED, not skipped — grep `instanceof Map`, `new Map(`, `new Set(` in that file and remove each case with its describe wrapper when the wrapper empties.
2. A hand-built buffer `new Uint8Array([15, 0, 0, 0, 0])` throws `Codec2: unknown tag 15`; the same for tag 16. These are the retirement regression tests and they are permanent.
3. `KNOWN_TYPES` carries neither `map` nor `set`; `defineSchema` with a field typed `'map'` is refused by the existing unknown-type path.
4. A typed array still round-trips (tag 17 is untouched by this item) and a plain object still takes the tag-8 schema path — proves the switch surgery removed only the two arms.
5. `computeSize` on a plain object and on a typed array behaves exactly as at baseline (the `-1` bails that remain are unchanged).

## Reads

- src/sbc/index.ts — the tag registry comment block (:22-39) recording which tag numbers are live
- README.md — Map/Set claims that readme-accuracy must then correct

## Acceptance

- Tags 15 and 16 decode to a thrown `Codec2: unknown tag`; no `map` or `set` remains in `KNOWN_TYPES`, `inferType`, `computeSize`, or any codegen/extract switch arm.
- Typed arrays and plain objects round-trip exactly as at baseline (tag 17 and the tag-8 schema path are untouched).
- 0 regressions in test/sbc/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/index.test.ts
- npx tsc --noEmit

## Notes

2026-07-25 — SCOPE GUARD. src/compiler/validator.ts's TYPE_VALIDATORS carries its own 'map' and 'set' entries (:53, :58) which validate USER DATA typed as Map/Set. That is a completely separate feature from the SBC codec's tag-15/16 value types this item deletes, and it MUST survive. Do not grep for map/set across src/ and delete matches — this item's surface is src/sbc/ plus the codegen and extract switch arms named in Design, and nothing under src/compiler/. validator-container-fidelity is concurrently REPAIRING the validator's Map/Set path.
