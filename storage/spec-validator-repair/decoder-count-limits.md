---
type: fix
recommended-model: opus
status: DEFERRED
priority: P0
depends-on: [encode-growth-signal]
files-own: [src/sbc/codegen.ts, src/sbc/extract.ts, test/sbc/codegen.test.ts, test/sbc/extract.test.ts]
files-shared: [src/sbc/constants.ts]
tests: [test/sbc/codegen.test.ts, test/sbc/extract.test.ts, test/sbc/index.test.ts]
blocked-reason: dependency validator-boolean-coercion did not land — reverted
---

# Carry MAX_ARRAY_COUNT into the compiled decoder and extractField

## Rationale

MAX_ARRAY_COUNT appears 15 times in src/sbc/tagged.ts, zero times in src/sbc/codegen.ts and zero times in src/sbc/extract.ts. Six generated allocation sites (src/sbc/codegen.ts:447, :498, :506, :517, :527, :536) build new Array(l) straight from a wire varint with no cap, and a seventh at :543 guards with the magic literal 1048576 instead of the constant. src/sbc/extract.ts:136 and :171-177 advance pos by an unchecked count and then read behind non-null assertions, returning silent garbage. The result is a decoder divergence: bytes the tagged path rejects, the compiled path accepts.

## Changes

`MAX_ARRAY_COUNT` becomes the single count limit for every decode path: `src/sbc/codegen.ts` interpolates it into the guard emitted ahead of all seven generated `new Array(l)` sites — replacing the magic literal `1048576` at its one existing guard — and `src/sbc/extract.ts` imports it, capping each wire count and bounds-checking `pos` after every skip so a hostile count throws a named error instead of walking past the buffer into `undefined` reads. `src/sbc/constants.ts` stays the sole definition.

## Design

Settled decisions. Root cause: the DoS guards the tagged decoder enforces were never carried into the two paths that were extracted from it.

- **The evidence.** `MAX_ARRAY_COUNT` (`src/sbc/constants.ts:3`, 2^20) appears 15 times in `src/sbc/tagged.ts`, ZERO times in `src/sbc/codegen.ts`, and ZERO times in `src/sbc/extract.ts`. The same bytes are therefore rejected by the tagged decoder and accepted by the compiled one — a decoder divergence in a codec whose stated premise is that the two paths agree.
- **Compiled decoder — six unguarded allocation sites.** `src/sbc/codegen.ts:447`, `:498`, `:506`, `:517`, `:527` and `:536` each read a varint count into `l` and immediately emit `let a=new Array(l);` with no cap. A seventh site, `:543`, DOES guard but with the magic literal `1048576` rather than the imported constant — a fourth copy of a number `src/sbc/constants.ts` owns. Every one of the seven emits the same guard, generated from `MAX_ARRAY_COUNT`, throwing the same `Codec2: array count <n> exceeds limit` message the tagged path already uses.
- **extract.ts — unchecked position arithmetic.** `src/sbc/extract.ts:136` (`pos += count * elemSize`) and `:171`, `:174`, `:177` advance `pos` by a wire-supplied count with no cap and no post-advance bounds check. `pos` walks past the buffer and subsequent `buffer[pos]!` reads yield `undefined` behind non-null assertions, so the function returns silent garbage instead of throwing. Add the count cap AND a `pos > buffer.length` check after each skip, throwing the existing truncation-style named error.
- **One constant, imported everywhere.** No path may restate the limit as a literal. `src/sbc/codegen.ts` interpolates `MAX_ARRAY_COUNT` into the generated source; `src/sbc/extract.ts` imports it. After this item a repo-wide grep for `1048576` outside `src/sbc/constants.ts` returns nothing.
- **Guard placement matters.** In the compiled decoder the check must precede `new Array(l)`, not follow it — the allocation is the operation being defended against, and a guard after it defends nothing.

Test plan (`test/sbc/codegen.test.ts` and `test/sbc/extract.test.ts`, plus cross-path parity in `test/sbc/index.test.ts`):

1. Parity harness: for each of a hand-built buffer declaring a count above 2^20 in a typed-array field, an array-of-string field, an array-of-bytes field, and an array-of-object field, BOTH the tagged decoder and the compiled decoder throw `Codec2: array count <n> exceeds limit`. Same bytes, same verdict — this is the acceptance bar.
2. A count exactly at 2^20 is accepted by both paths (the boundary is inclusive as in `src/sbc/tagged.ts`).
3. `extractField` on a buffer whose array count would walk `pos` past the end throws a named error rather than returning `undefined` or a partial value.
4. A repo-wide source assertion in the suite: the literal `1048576` appears only in `src/sbc/constants.ts`.
5. Normal payloads across every affected field shape round-trip unchanged, proving the guards cost nothing on the happy path.

## Reads

- src/sbc/tagged.ts — the 15 existing MAX_ARRAY_COUNT guards and their exact error message, which the new guards must match
- src/sbc/index.ts — the decode entry points that dispatch between the tagged and compiled paths

## Acceptance

- Parity bar: for a hand-built buffer declaring a count above 2^20 in a typed-array, array-of-string, array-of-bytes, and array-of-object field, the tagged decoder AND the compiled decoder both throw `Codec2: array count <n> exceeds limit` — same bytes, same verdict.
- A count of exactly 2^20 is accepted by both paths.
- `extractField` on a buffer whose count would walk `pos` past the end throws a named error rather than returning `undefined` or a partial value.
- The literal `1048576` appears only in src/sbc/constants.ts, asserted by a source-level check in the suite.
- 0 regressions in test/sbc/codegen.test.ts, test/sbc/extract.test.ts and test/sbc/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/codegen.test.ts test/sbc/extract.test.ts test/sbc/index.test.ts
- npx tsc --noEmit

## Notes

DEFERRED 2026-07-26T08:28:15.172Z run=f177cf28 class=dependency reason="dependency validator-boolean-coercion did not land — reverted" salvage=none
