---
type: fix
recommended-model: opus
status: PENDING
priority: P1
source: findings C8, C13, C17, C18 (audit section C)
depends-on: [relocate-tests-and-benches, emitted-code-escaping]
files-own: [src/compiler/error.ts, src/compiler/validator.ts, test/compiler/custom-messages.test.ts]
tests: [test/compiler/error.test.ts, test/compiler/custom-messages.test.ts]
---

# Error paths carry real indices/keys and reach element messages

## Rationale

C8 (P1): array element errors report `users.id` instead of `users[0].id` (`src/compiler/validator.ts:104-113` passes `path: pathMode.path` with the index only in `key`); records report `m.a` for `m.k.a` (`:333-338`); nested children reset to `{kind:'static'}` (`:265`) so outer indices drop (`grid[1]` for `grid[0][1]`). C13 (P1): `src/compiler/error.ts:31-36` looks up custom messages by `pathMode.kind === 'static' ? path.join('.') : ''` — every dynamic/record error looks up `''`, so the `ErrorMessages<U>[]` element messages `src/types.ts:36-43` advertises appear NOWHERE in emitted code. C17 (P2): tuple paths push `[${i}]` as a dot-joined segment → `coords.[1]`. C18 (P2): `{"a.b": string}` and `{a:{b:string}}` both report `a.b`, and one custom message keyed `"a.b"` overrides both. One root-cause family — path/message resolution is string-join based instead of segment based — so one item across the two emission files.

## Changes

Error emission: paths become segment-composed (static prefixes + dynamic index/key expressions) rendered in accessor syntax; custom messages resolve at CODEGEN time by schema position, never by runtime string lookup.

## Design

Settled decisions:

- **Segment model.** A path is an ordered list of segments: `.name` (identifier-safe key), `[<emitString(key)>]` (non-identifier or ambiguous key), `[<runtime index/key expr>]` (array index, record key, tuple index). Rendering concatenates segments and strips one leading dot. Emitted path construction interpolates runtime segments via template literals in the generated code. This yields `users[0].id`, `m.k.a` (static-keyed) / `m[<k>]` when the key is dynamic — rendered `m.k.a` for identifier-safe runtime keys is acceptable; criterion below governs.
- **Disambiguation (C18).** A STATIC key that is not identifier-safe, or contains a dot/quote/newline, renders bracket-quoted (`a["b.c"]`) — accessor-syntax valid and unambiguous against nesting. Discretion point: whether runtime record keys are always bracket-rendered or identifier-tested at runtime; criterion — `{"a.b": string}` and `{a:{b:string}}` must render distinguishably, and rendering cost must be error-path-only (zero cost on the success path).
- **Tuples (C17).** Tuple segments are `[i]` bracket segments — no dot joins anywhere (the segment renderer owns separators; nothing pushes pre-rendered `[1]` strings into a dot-join).
- **Messages by schema position (C13).** `resolveMessage` walks the user's messages object in parallel with the SCHEMA during codegen: object property → property key; array element → the `ErrorMessages<U>[]` first element (or string shorthand per `src/types.ts:36-43`); record value → the record's value-message node; tuple index → positional entry. Each generated check site embeds ITS resolved message as a literal (via emitString). The runtime `''`-lookup dies. Container-level messages keep their current precedence (existing passing tests define it — do not regress the verified flat/nested-leaf/container-level cases).

Test plan: extend `test/compiler/error.test.ts` + rework `test/compiler/custom-messages.test.ts`: `{users:[{id:null}]}` → `users[0].id`; `{m:{k:{a:'x'}}}` → `m.k.a`; `{grid:[[1,'x']]}` → `grid[0][1]`; tuple error → `coords[1]` with no stray dot; custom element message reaches an array element and a record value; `"a.b"`-keyed property renders bracket-quoted and its message does NOT fire for nested `a.b`; all existing verified message cases stay green.

## Reads

- src/types.ts — ErrorMessages<T> contract driving positional resolution
- test/utils.ts — transform harness

## Acceptance

- The four measured wrong-path repros produce the exact paths above; element messages appear in emitted code and fire at runtime.
- Arrays of primitives (verified correct today) stay correct.
- 0 regressions in test/compiler/error.test.ts and test/compiler/custom-messages.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/error.test.ts test/compiler/custom-messages.test.ts
- npx tsc --noEmit

## Notes

src/compiler/validator.ts is deliberately shared surface with output-construction-safety (fresh-output emission) — the planner will weld these compiler items into one serialized unit; that is expected, not a slicing error. Path rendering must use emitted-code-escaping's emitString for every static key literal.
