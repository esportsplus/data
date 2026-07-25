---
type: fix
recommended-model: sonnet
status: PENDING
priority: P0
source: findings C3, C4 (audit section C)
depends-on: relocate-tests-and-benches
files-own: [src/compiler/error.ts, src/compiler/validator.ts, test/compiler/error.test.ts]
tests: [test/compiler/error.test.ts]
---

# Escape every string embedded in generated code

## Rationale

C3 (P0): `src/compiler/error.ts:8-28` `resolvePath` interpolates `parts.join('.')` into a single-quoted literal with NO escaping — `type D = { "it's": string }` emits `path: 'it's'` → `SyntaxError: Unexpected identifier 's'`; a newline in a key emits an unterminated literal. The whole generated module fails to parse. C4 (P1): `code.escape` from `@esportsplus/typescript` escapes ONLY `'` (`node_modules/@esportsplus/typescript/build/compiler/code.js:14`), used at `src/compiler/validator.ts:575,300,79,467` — `{ "a\\b": string }` emits `_input['a\b']` where `\b` is BACKSPACE: the correct object is rejected and a backspace-keyed object accepted.

## Changes

One escaping discipline for every string the compiler embeds in emitted code: property accessors, error paths, and custom messages.

## Design

Exact recipe:

1. Add a module-level helper in `src/compiler/error.ts` (exported for validator.ts): `emitString(value: string): string` returning `JSON.stringify(value)` — double-quoted, correct for backslash, quotes, newlines, U+2028/U+2029, and control chars by construction. No hand-rolled escape table.
2. Replace every generated-code interpolation of a raw string with `emitString`: the `path:` literal in `resolvePath` (`error.ts:8-28`), the property-accessor sites and message literals currently using the dependency's `code.escape` (`validator.ts:575,300,79,467`). The dependency's `code.escape` is no longer used for embedded literals (it cannot be fixed here — it lives in `@esportsplus/typescript`).
3. Identifier-safe keys may keep bare `.name` accessor emission (the existing `VALID_IDENTIFIER` gate); everything else goes through `_input[<emitString(key)>]`.

Test plan (extend `test/compiler/error.test.ts`; every case EXECUTES the emitted module, never text-compare alone): keys containing `'`, `"`, `\n`, `\\`, ` `, and emoji — module imports cleanly, the CORRECT property is read (backslash key no longer reads a backspace key), error `path` round-trips the exact key; custom messages containing quotes and newlines survive verbatim.

## Reads

- src/compiler/types.ts — shared compiler types between error.ts and validator.ts (import cycle awareness)
- test/utils.ts — transform harness

## Acceptance

- `{ "it's": string }` and `{ "a\nb": string }` produce modules that parse and validate correctly; `{ "a\\b": string }` reads the right property and rejects a backspace-keyed object.
- 0 regressions in test/compiler/error.test.ts, run scoped; `npx tsc --noEmit` clean.

## Checks

- pnpm agent:test test/compiler/error.test.ts
- npx tsc --noEmit

## Notes

error-path-fidelity builds its segment-based path emission ON this helper — land this first (it is also the P0).
