---
type: fix
recommended-model: opus
status: DEFERRED
priority: P0
files-own: [src/sbc/index.ts, src/sbc/tagged.ts, src/sbc/codegen.ts, test/sbc/index.test.ts]
tests: [test/sbc/index.test.ts]
blocked-reason: dependency validator-boolean-coercion did not land — reverted
---

# Stop reading buffer overflow out of RangeError; bound the retry loop

## Rationale

tryEncode and tryEncodeSbc (src/sbc/index.ts:453-470, :474-491) treat ANY RangeError as buffer-too-small, doubling encodeBuf inside while(true). Verified this session: Buffer.prototype.writeBigInt64LE(2n**64n) throws Node ERR_OUT_OF_RANGE, which IS a RangeError, and the compiled encoder emits _wBI64.call with no range check at src/sbc/codegen.ts:162. So encoding an out-of-int64 bigint on Node does not throw — it hangs, doubling the buffer until allocation fails. The catch exists to absorb overflow from b.set() alone and accidentally swallows every other RangeError in the program, which is error-as-control-flow of the kind the coding standards ban.

## Changes

Buffer overflow stops being signalled through an exception type: the `bytes` write paths in `src/sbc/tagged.ts` and `src/sbc/codegen.ts` bounds-check before `b.set(...)` and report a `needed` position past the buffer, so the `catch (e) { if (!(e instanceof RangeError)) throw e; … }` blocks in both retry loops in `src/sbc/index.ts` are DELETED rather than narrowed, and both `while (true)` loops gain a hard iteration cap throwing `Codec2: encode buffer growth exceeded`. A RangeError escaping encode then means what it says instead of triggering an unbounded grow loop.

## Design

Settled decisions. Root cause: buffer overflow and genuine value errors are signalled through the SAME channel, so the retry loop cannot tell them apart.

- **The defect.** `tryEncode` (`src/sbc/index.ts:453-470`) and `tryEncodeSbc` (`:474-491`) wrap the encode call in `while (true)`, and their `catch` treats ANY `RangeError` as "the buffer was too small": it doubles `encodeBuf` and retries. Verified this session — `Buffer.prototype.writeBigInt64LE(2n ** 64n)` throws Node's `ERR_OUT_OF_RANGE`, which IS a `RangeError` — and the compiled encoder emits `_wBI64.call(b, …)` at `src/sbc/codegen.ts:162` with no range check. So `encode({v: 2n ** 64n})` on Node never throws: it loops, doubling the buffer until allocation itself fails. A hang plus OOM in place of an error.
- **Why the catch exists at all.** `b[p] = x` past the end of a Uint8Array is silently discarded, so overflow is normally detected by the `end <= encodeBuf.length` check on the SUCCESS path (`:456`, `:478`). The `catch` is there only for `b.set(v, p)`, which DOES throw `RangeError` on overflow. So the catch guards exactly one overflow source and accidentally swallows every other `RangeError` in the program.
- **Decision — make overflow explicit, stop reading it out of an exception type.** Before the retry loop, ensure the buffer is large enough for the one operation that can throw: in the compiled and tagged `bytes` paths, bounds-check the destination before `b.set(...)` and return a `needed` position past `buf.length` (the protocol the tagged encoder already uses at `src/sbc/tagged.ts:560` and `:586`) instead of letting `set` throw. With `set` no longer throwing on overflow, the `catch` blocks in both retry loops are DELETED outright — not narrowed, not re-thrown-conditionally. A `RangeError` escaping encode then means what it says.
- **Bound the loop regardless.** Both `while (true)` loops gain a hard iteration cap (buffer doubling from 65536 reaches any legitimate payload in well under 20 rounds) and throw `Codec2: encode buffer growth exceeded` on exhaustion. This is defence in depth, NOT the fix — an unbounded retry over a deterministic operation is a latent hang whatever the trigger, and the cap must not become the excuse to leave the catch in place.
- **Do NOT swallow the bigint case here.** `bigint-int64-parity` installs the call-site range check that stops the out-of-range value at source; this item makes sure that if any future value error reaches the retry loop it surfaces instead of hanging. Both are required and neither substitutes for the other.

Test plan (`test/sbc/index.test.ts`):

1. The repro: `encode({v: 2n ** 64n})` TERMINATES and throws — asserted with a vitest timeout so a regression fails as a timeout rather than hanging the suite. This test must fail before the fix.
2. A `bytes` field larger than the initial 65536 buffer still encodes correctly, proving the growth path survives the `catch` removal.
3. A value whose encode raises a `RangeError` from user code (an object with a getter that throws `new RangeError('x')`) propagates that exact error to the caller instead of triggering growth.
4. Growth is bounded: a stub encode function that always reports a position past the buffer throws `Codec2: encode buffer growth exceeded` rather than looping.
5. A large legitimate payload (over 1 MB) still round-trips, proving the iteration cap is not too tight.

## Reads

- src/sbc/platform.ts — allocBuf / copyBuf, the growth primitives the retry loops call
- src/sbc/size.ts — computeSize, the presizing path that avoids the loop entirely when it can answer

## Acceptance

- `encode({v: 2n ** 64n})` TERMINATES and throws, asserted under a vitest timeout so a regression fails as a timeout rather than hanging the suite — this fails before the fix.
- A user-thrown `RangeError` raised from a getter during encode propagates unchanged to the caller instead of triggering buffer growth.
- Growth is bounded: an encode reporting a position past the buffer forever throws `Codec2: encode buffer growth exceeded`.
- A `bytes` field larger than the initial 65536 buffer and a payload over 1 MB both still round-trip, proving the growth path survives the catch removal and the cap is not too tight.
- 0 regressions in test/sbc/index.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/index.test.ts
- npx tsc --noEmit

## Notes

DEFERRED 2026-07-26T08:28:15.116Z run=f177cf28 class=dependency reason="dependency validator-boolean-coercion did not land — reverted" salvage=none
