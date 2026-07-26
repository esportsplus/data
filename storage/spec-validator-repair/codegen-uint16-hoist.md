---
type: refactor
recommended-model: sonnet
status: PENDING
priority: P2
depends-on: [decoder-count-limits]
files-own: [src/sbc/codegen.ts, test/sbc/codegen.test.ts]
tests: [test/sbc/codegen.test.ts]
---

# Hoist the uint16 property read to match its sibling width arms

## Rationale

src/sbc/codegen.ts:142 interpolates the property expression twice for a uint16 field, emitting two property loads per field, while its three sibling multi-byte integer arms all hoist to a local first — int16 at :146, uint32 at :150, int32 at :154. uint16 is the lone outlier of the four. The emitted bytes are unchanged; this is a consistency repair in generated code, with any throughput gain incidental and deliberately not claimed as a measured perf win.

## Changes

The `uint16` arm of the compiled encoder hoists its property read to a local, matching `int16`, `uint32` and `int32`, so all four multi-byte integer arms in `src/sbc/codegen.ts` emit one shape and a uint16 field costs one property load instead of two. Emitted bytes are unchanged; only the generated source differs.

## Design

Settled decisions. This is a consistency defect in the compiled encoder's width arms; the throughput gain is incidental and is not the justification.

- **The defect.** `src/sbc/codegen.ts:142` emits, for a `uint16` field, `b[p]=o["k"]&0xFF;b[p+1]=(o["k"]>>>8)&0xFF;p+=2;` — the property expression `val` is interpolated TWICE, so the generated code performs two property loads per field. Its three sibling arms all hoist first: `int16` at `:146` emits `{let v=…;…}`, `uint32` at `:150` and `int32` at `:154` do the same. `uint16` is the lone outlier among the four multi-byte integer widths.
- **Decision — hoist, matching the siblings exactly.** Emit `{let v=${val};b[p]=v&0xFF;b[p+1]=(v>>>8)&0xFF;p+=2;}` so all four arms share one shape. Do not restructure the surrounding switch and do not touch any other arm: `boolean`, `uint8` and `int8` each read `val` once already and are correct as written.
- **Audit the array-element arms in the same pass.** The per-element loops at `src/sbc/codegen.ts:209-220` DO hoist (`let v=a[i]`) for every width, so they need no change — this is stated so the seat verifies rather than assumes, and does not "fix" code that is already right.
- **Why this is `type: refactor` and not `type: perf`.** The change removes one property load per uint16 field, which is real but small, and this spec carries no benchmark baseline for the compiled encoder. Claiming a measured win with no benchmark evidence would be a false perf claim, and this item deliberately does not make one. The defensible statement is the one above: four sibling arms should emit one shape, and three of them already do.
- **No wire-format change.** The emitted bytes are identical before and after; only the generated source differs. That is what makes the byte-identity assertion below the correct acceptance test.

Test plan (`test/sbc/codegen.test.ts`):

1. A schema with a `uint16` field encodes to BYTE-IDENTICAL output before and after the change — captured as an explicit expected byte array so the assertion survives the edit.
2. Boundary values `0` and `65535` round-trip exactly; `65536` truncates to `0` exactly as it does today (this item changes nothing about range behavior).
3. A schema mixing `uint16` with `int16`, `uint32` and `int32` fields round-trips, proving the arms still compose.
4. A source-level assertion on the generated function body: the property expression for a `uint16` field appears exactly once, which is what pins the regression.
5. An array-of-uint16 field still round-trips, confirming the element-loop arms were left alone.

## Reads

- src/sbc/constants.ts — FIELD_SIZES, the width table the arms are keyed on
- src/sbc/schema.ts — inferType's integer narrowing, which decides when a field lands on the uint16 arm

## Acceptance

- A schema with a `uint16` field encodes to BYTE-IDENTICAL output before and after, asserted against an explicit expected byte array.
- The generated function body contains the field's property expression exactly once for a `uint16` field — the assertion that pins the regression.
- Boundary values 0 and 65535 round-trip exactly and 65536 still truncates to 0; a schema mixing uint16 with int16, uint32 and int32 round-trips; an array-of-uint16 field round-trips unchanged.
- 0 regressions in test/sbc/codegen.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/sbc/codegen.test.ts
- npx tsc --noEmit
