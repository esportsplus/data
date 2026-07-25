---
type: refactor
recommended-model: sonnet
status: BLOCKED
blocked-reason: blocked pending user review of the SBC audit findings (Q3)
priority: P2
source: finding D11 (audit section D)
api-impact: breaking
awaiting-approval: public-API break
depends-on: relocate-tests-and-benches
files-own: [src/typed-array-codec.ts, src/index.ts, test/typed-array-codec.test.ts, test/layout.test.ts]
tests: [test/layout.test.ts]
removes-tests: [test/typed-array-codec.test.ts]
---

# Remove the orphan typed-array codec

## Rationale

D11 (P2): `src/typed-array-codec.ts` is a parallel implementation exported from `src/index.ts:29-33` but undocumented, used NOWHERE in `src/sbc/` (SBC has its own tag-17 typed-array path via `TYPED_ARRAY_IDS` in `src/sbc/platform.ts`), and wire-INCOMPATIBLE with SBC's format (0x54 marker). It even rejects Node `Buffer` (`getTypedArrayType(Buffer.from([1])) = -1`) — exactly what SBC's decode returns at HEAD. The evidence's decision fork was "delete it or wire it in"; deletion is the settled default (Q3): wiring it in would duplicate a working tag-17 path behind an incompatible wire format.

## Changes

Public export surface shrinks: the four orphan exports (`TYPED_ARRAY_MARKER`, `decodeTypedArray`, `encodeTypedArrayInto`, `getTypedArrayType`) and their module are deleted, with their mirror test.

## Design

Exact recipe:

1. Delete `src/typed-array-codec.ts`.
2. Remove its four re-exports from `src/index.ts` (the `codec`/`validator` exports and type exports stay untouched).
3. Delete `test/typed-array-codec.test.ts` (declared in removes-tests — the covered module ceases to exist; SBC's own typed-array round-trip coverage is baseline-verified and cited in Reads).
4. No dead references may survive: no other source imports the module (ownership map confirms 2 consumers: src/index.ts and the mirror test).
5. Update the layout sweep (test/layout.test.ts): flip its typed-array-codec mirror expectation to an ABSENCE assertion — `src/typed-array-codec.ts` and `test/typed-array-codec.test.ts` must not exist. The deletion becomes a permanent regression test instead of a one-shot gate predicate.

This is a PUBLIC API removal — `awaiting-approval: public-API break` gates it; an unattended run reports and stops here. Version note for the eventual release: 0.x minor bump per common 0.x semver practice; the release itself is out of scope.

## Reads

- src/sbc/platform.ts — TYPED_ARRAY_IDS tag-17 path, the surviving (documented) typed-array support
- test/sbc/index.test.ts — where SBC's own typed-array round-trip coverage lives (citation only; proves the deleted mirror leaves no coverage hole)
- package.json — exports map (unchanged: the deleted module was never a subpath export; root `.` types/impl regenerate from build)

## Acceptance

- The module, its four exports, and its test are gone — 0 regressions in test/layout.test.ts, run scoped (its absence assertions pass); `src/index.ts` compiles with no dangling re-exports; SBC typed-array round-trips (baseline-verified) unaffected.
- `npx tsc --noEmit` clean; the deletion introduces 0 regressions elsewhere (no remaining importer exists to break).

## Checks

- pnpm agent:test test/layout.test.ts
- npx tsc --noEmit

## Notes

If the Q3 answer overrides to "wire it in", this item is re-planned through spec:create — do not improvise an integration under this slug.
