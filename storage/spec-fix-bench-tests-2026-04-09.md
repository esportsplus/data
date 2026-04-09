# Spec: Fix Broken Bench Test Files

**Status**: READY
**Date**: 2026-04-09
**Scope**: `tests/bench/` — 8 failing files, 0/28 test files should fail after fix

## Problem

`vitest run` reports 8 failing files in `tests/bench/`. Three root causes:

1. **Missing import** — 3 files import from `../tests/utils` (resolves to `tests/tests/utils`, doesn't exist). Correct path is `../utils`.
2. **Obsolete files** — 2 files reference deleted proto codec infrastructure (`codec<T>()` API, proto-compiled `createCodec`).
3. **Wrong runner mode** — 5 files are standalone scripts or vitest bench files that fail under `vitest run` ("No test suite found" or "`bench()` only available in benchmark mode").

## Findings

| File | Error | Root Cause | Fix |
|------|-------|------------|-----|
| `codec.ts` | Cannot find module `../tests/utils` | Proto `createCodec` removed from utils.ts + wrong path | **Delete** — benchmarks proto codec pipeline (deleted) |
| `compile.ts` | Cannot find module `../tests/utils` | Wrong import path + proto codec section obsolete | **Fix path** + remove proto codec bench section |
| `validator.ts` | Cannot find module `../tests/utils` | Wrong import path only | **Fix path** `../tests/utils` -> `../utils` |
| `sbc.encoder.ts` | No test suite found | Empty file (0 bytes) | **Delete** |
| `all-codecs.ts` | No test suite found | Standalone script (`npx tsx`), not a vitest suite | **Exclude** from vitest run |
| `sbc-standalone.ts` | No test suite found | Standalone script (`npx tsx`), not a vitest suite | **Exclude** from vitest run |
| `autoresearch-sbc.ts` | No test suite found | Standalone script (`npx tsx`), not a vitest suite | **Exclude** from vitest run |
| `sbc-vs-msgpack.ts` | `bench()` only in benchmark mode | Vitest bench file, must run via `vitest bench` | **Exclude** from vitest run |

## Implementation

### F-01: Delete obsolete files

Delete 2 files that serve no purpose:

- `tests/bench/codec.ts` — benchmarks the deleted proto `codec<T>()` compile pipeline. Imports proto-specific `createCodec` from utils that no longer exports it. No salvageable content.
- `tests/bench/sbc.encoder.ts` — empty file (0 bytes).

### F-02: Fix `tests/bench/compile.ts` — wrong import path + dead proto section

1. Fix import path: `'../tests/utils'` -> `'../utils'`
2. Delete the "Compile - Codec" describe block (lines 29-43) — it benchmarks `codec<T>()` which is the deleted proto API
3. Keep the "Compile - Validator" describe block (lines 5-26) — `validator.build<T>()` still works

### F-03: Fix `tests/bench/validator.ts` — wrong import path

Fix import path: `'../tests/utils'` -> `'../utils'`

### F-04: Exclude standalone/bench-only files from `vitest run`

Update `vitest.config.ts` `test.exclude` to add:

```typescript
exclude: [
    'tests/bench/all-codecs.ts',        // standalone script (npx tsx)
    'tests/bench/autoresearch-sbc.ts',   // standalone script (npx tsx)
    'tests/bench/sbc-standalone.ts',     // standalone script (npx tsx)
    'tests/bench/sbc-vs-msgpack.ts',     // vitest bench only
    'tests/compile-validators.ts',       // existing exclusion
    'tests/utils.ts',                    // existing exclusion
]
```

These files run via `vitest bench` or `npx tsx` — they are not test suites.

## Validation

After all fixes:
- `pnpm tsc --noEmit` — zero errors
- `pnpm test` (`vitest run`) — 0 failed test files, all 1205 tests pass
- `pnpm bench` (`vitest bench`) — sbc-vs-msgpack.ts runs successfully
- Standalone scripts still run: `npx tsx tests/bench/sbc-standalone.ts`

## Batch Plan

Single batch — all 4 findings are independent, small changes.

### Batch 1: Fix all bench test failures (4 findings)

1. F-01: Delete `tests/bench/codec.ts` and `tests/bench/sbc.encoder.ts`
2. F-02: Fix `tests/bench/compile.ts` (import path + remove proto section)
3. F-03: Fix `tests/bench/validator.ts` (import path)
4. F-04: Update `vitest.config.ts` exclude list
