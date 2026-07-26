---
type: fix
recommended-model: opus
status: PENDING
priority: P2
source: finding D6 (audit section D)
depends-on: relocate-tests-and-benches
files-own: [src/sbc/size.ts, test/sbc/size.test.ts]
tests: [test/sbc/size.test.ts]
---

# computeSize returns the exact encoded length, compress included

## Rationale

D6 (P1 severity in evidence, P2 blast radius): `src/sbc/size.ts:22-183` has no compression branch — measured: compress `{a:true,b:1.5}` computeSize 18 vs actual 19 — and returns an UNDOCUMENTED `-1` for arrays/Map/Set/typed arrays (`:54-64`, `:92-94`, `:174-175`) while README:259 types it `number` with no sentinel (measured: array/Map → `-1` vs actual 8/13).

## Changes

computeSize becomes a total function over encodable values: exact byte length for every supported type, mirroring both layout modes.

## Design

Settled decisions:

- **Exact size, no sentinel.** `computeSize(value, options)` returns the exact `encode(value, options).byteLength` for every encodable value — arrays, Map, Set, typed arrays, and nested combinations included (the walker already traverses objects; extend it over the remaining tags using `src/sbc/constants.ts` FIELD_SIZES and the varint length rules in `src/sbc/schema.ts` varintSize). `-1` dies.
- **Compress branch.** Mirror the compressed layout's sizing (bool bitmap — 12-bool bitmap / 17-bool fallback boundaries verified at baseline — nullable interactions, header differences) so compress-mode sizes are exact too.
- **Non-encodable values throw** the same `Codec2:` error class sbc-encode-safety establishes — computeSize and encode agree on the domain.
- Discretion point: sharing layout arithmetic with codegen vs a parallel table; criterion — a single source of truth per width rule where practical WITHOUT importing the full codegen driver into size.ts's hot path (no new abstraction unless it removes real duplication).

Test plan (new mirror `test/sbc/size.test.ts`): property-style corpus — primitives at integer-width boundaries, strings (empty/ASCII/unicode), bigint at int64 edges, Date, nested arrays/objects, Map/Set, all 11 typed arrays, nullable fields, compress on AND off, the 126/127/128/200/5000 varint length-prefix boundaries — asserting `computeSize(v, o) === codec().encode(v, o).byteLength` for every case; non-encodable input throws.

## Reads

- src/sbc/codegen.ts — the layout being mirrored (varint prefix boundaries at :290-294, compress bitmap rules)
- src/sbc/constants.ts — FIELD_SIZES
- src/sbc/schema.ts — varintSize

## Acceptance

- The three measured divergences (compress 18→19, array -1→8, Map -1→13) flip to exact equality; the whole corpus holds `computeSize === encoded length`.
- 0 regressions in test/sbc/size.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/size.test.ts
- npx tsc --noEmit

## Notes

README:259's contract becomes true as written; readme-accuracy removes any sentinel language and documents the throw-on-unencodable domain.
DEFERRED 2026-07-26T08:28:15.414Z run=f177cf28 class=dependency reason="dependency validator-boolean-coercion did not land — reverted" salvage=none
