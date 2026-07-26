---
type: fix
recommended-model: opus
status: PENDING
priority: P1
depends-on: [decoder-count-limits]
files-own: [src/sbc/registry.ts, src/sbc/schema.ts, test/sbc/registry.test.ts]
tests: [test/sbc/registry.test.ts]
---

# Verify the registry wire hash against the fields it labels

## Rationale

deserializeRegistry reads a u32 hash at src/sbc/registry.ts:32, uses it only for the dedup check at :102, then calls defineSchemaFn(fields) which recomputes its own hash and registers under that. The wire hash is never compared to the fields it labels, so a blob claiming hash X while carrying fields hashing to Y bypasses dedup and registers a schema the sender never named. Every other field in this parser is validated — name length, name regex, type string, flags, schema count — which makes the unchecked hash the single hole in an otherwise careful reader.

## Changes

`deserializeRegistry` verifies before it trusts: `src/sbc/registry.ts` recomputes the shape hash from the parsed fields and compares it to the wire value, throwing `Codec2: registry hash mismatch — declared <declared>, computed <computed>` on disagreement, and the dedup skip moves AFTER that check so it no longer tests an unvalidated key. `src/sbc/schema.ts` exports `computeShapeHash` for this internal consumer only — it must not reach any public export list — so the wire's identity function has exactly one definition.

## Design

Settled decisions. Root cause: the registry wire format carries a schema hash that nothing ever checks against the fields it labels.

- **The defect.** `deserializeRegistry` (`src/sbc/registry.ts:12-108`) reads a u32 `hash` at `:32`, uses it for exactly one thing — the dedup check `if (schemas.has(hash)) continue;` at `:102` — and then calls `defineSchemaFn(fields)` at `:106`, which recomputes the hash from the fields via `computeShapeHash` and registers under THAT value. The wire hash is otherwise discarded. A blob claiming hash X while carrying fields that hash to Y therefore skips the dedup test for Y and registers a schema the sender never named. Every other field in this parser is validated — name length, name regex, type string, flags, schema count — which makes the unchecked hash the one hole in an otherwise careful reader.
- **Decision — verify, do not trust and do not silently repair.** After building `fields` for a schema and BEFORE the dedup check, compute the shape hash from those fields and compare it to the wire value. On mismatch, throw `Codec2: registry hash mismatch — declared <declared>, computed <computed>`. Rejecting the whole blob is correct: a registry that disagrees with itself is corrupt or hostile, and partially importing it would leave the receiver in a state neither side believes in.
- **Move the dedup check after verification.** With the hash proven, `schemas.has(hash)` becomes a meaningful skip rather than a lookup on an unvalidated key. The ordering is: parse fields → verify hash → dedup skip → `defineSchemaFn`.
- **Reuse the existing hash function, do not reimplement it.** `computeShapeHash` is internal to `src/sbc/schema.ts`; export it for `src/sbc/registry.ts` (an internal cross-module import, not a public API addition — it must not appear in `src/sbc/index.ts`'s or `src/index.ts`'s export list). Reimplementing FNV-1a in the registry would create a second definition of the wire's identity function, which is the class of duplication this spec is removing elsewhere.
- **Field count is bounded by input length, not by a cap, and that is acceptable.** `fieldCount` at `:35` is an unbounded u16, but every field read is length-checked against `len`, so a short buffer throws before the loop can spin. No cap is added; this is recorded so the next reader does not re-raise it as a finding.

Test plan (`test/sbc/registry.test.ts`, the mirror for `src/sbc/registry.ts`):

1. A blob whose declared hash does not match its fields throws `Codec2: registry hash mismatch` naming both values — built by serializing a real registry and then corrupting the 4 hash bytes.
2. A round-trip of a genuine multi-schema registry still succeeds and registers every schema under the same hashes the producer held.
3. Dedup still works: deserializing the same valid blob twice registers each schema once and does not throw.
4. The corrupted-hash blob leaves the receiving registry UNCHANGED — no partial import survives the throw.
5. A source-level assertion that `computeShapeHash` is not re-exported from `src/sbc/index.ts` or `src/index.ts`.

## Reads

- src/sbc/constants.ts — FNV_OFFSET / FNV_PRIME / MAX_SCHEMA_COUNT, the constants the hash and the existing guards use
- src/sbc/index.ts — the codec surface exposing deserializeRegistry, verified unchanged
- src/index.ts — the package root export list, verified to not surface computeShapeHash

## Acceptance

- A blob whose declared hash does not match its fields throws `Codec2: registry hash mismatch` naming both values, built by serializing a real registry and corrupting the 4 hash bytes.
- The corrupted blob leaves the receiving registry UNCHANGED — no partial import survives the throw.
- A genuine multi-schema round-trip still registers every schema under the hashes the producer held, and deserializing the same valid blob twice registers each schema once without throwing.
- `computeShapeHash` is not re-exported from src/sbc/index.ts or src/index.ts, asserted by a source-level check.
- 0 regressions in test/sbc/registry.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/registry.test.ts
- npx tsc --noEmit
