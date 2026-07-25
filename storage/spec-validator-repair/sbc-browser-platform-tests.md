---
type: test
recommended-model: opus
status: BLOCKED
blocked-reason: blocked pending user review of the SBC audit findings (Q3/Q4)
priority: P2
source: audit section D (SBC NOT TESTED — browser platform branch)
depends-on: relocate-tests-and-benches
files-own: [src/sbc/platform.ts, test/sbc/platform.test.ts, vitest.config.ts]
tests: [test/sbc/platform.test.ts]
---

# Exercise the browser branch of the SBC platform layer

## Rationale

Coverage gap (unverified as a defect, verified as UNTESTED): `vitest.config.ts` pins `environment: 'node'`, so `isNode` is always true and the entire browser branch of `src/sbc/platform.ts` — DataView/TextDecoder/TextEncoder paths, `dvCache`, non-Buffer `allocBuf`/`byteLen`/`copyBuf` — has never executed under test, for a library whose headline claim is "works at runtime, no compiler required". Any defect there ships blind.

## Changes

The platform layer's browser-side implementations become testable and tested; no behavior change to the Node fast path.

## Design

Settled contract: the suite must EXECUTE the browser implementations of every dual-path export (`allocBuf`, `allocUnsafe`, `byteLen`, `copyBuf`, `readStr`, `writeUtf8`, `readVarint`/`writeVarint`, `readZigzag`/`writeZigzag`, `readF64`/`writeF64`, `readBI64`/`writeBI64`, and the `dvCache` reuse path), plus at least one full encode→decode round-trip corpus subset (primitives, strings incl. unicode, typed arrays, nested objects) running entirely on browser bindings.

Mechanism is a NAMED discretion point — two admissible shapes: (a) refactor `platform.ts` so both implementation sets are module-level declarations and the `isNode` ternary picks bindings ONCE at module scope, exporting the browser set for direct import under test; (b) a second vitest project/config whose environment lacks `Buffer` so `isNode` resolves false for the whole suite. Criterion: ZERO runtime cost added to the Node hot path (binding selection stays a one-time module-level choice — the existing prototype-extraction pattern is preserved, no per-call indirection), and the tests must fail if a browser impl diverges from its Node twin on any corpus vector (twin-equality assertions: same bytes in, same values out, byte-identical encodes where the format is deterministic).

Test plan (new mirror `test/sbc/platform.test.ts`): per-function round-trips at boundary values (varint at 126/127/128, zigzag negatives, F64 NaN/±Infinity/-0, BI64 at ±2^63 edges, UTF-8 multi-byte + 100KB strings); dvCache returns a reused DataView across calls on the same buffer; twin-equality between Node and browser bindings across the corpus.

## Reads

- src/sbc/codegen.ts — codegenDriver consumption of platform bindings (the refactor must not disturb generated-code call shapes)
- vitest.config.ts — environment pin; option (b) would extend it

## Acceptance

- Browser-branch line coverage for the dual-path exports goes from zero to exercised (every listed function executed under browser bindings); twin-equality holds across the corpus; Node-path suites unchanged.
- 0 regressions in test/sbc/platform.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/platform.test.ts
- npx tsc --noEmit

## Notes

Any real divergence this suite EXPOSES in a browser impl is fixed in-scope (platform.ts is files-own for exactly that reason); a divergence whose fix would ripple beyond platform.ts becomes a follow-up, not a silent skip.
