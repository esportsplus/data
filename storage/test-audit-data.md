# Test Audit: @esportsplus/data

**Date**: 2026-03-25
**Baseline**: 408 tests, 11 test files, all passing (9.81s)

## Summary

| Metric | Count |
|--------|-------|
| Source modules | 22 |
| Tested modules (direct) | 6 (27%) |
| Tested modules (integration only) | 9 (41%) |
| Untested modules | 3 (14%) |
| Type-only / trivial (N/A) | 4 (18%) |
| Benchmark files | 0 |
| Total gaps found | 18 |

## Missing Tests (Priority Order)

| # | Module | Export / Feature | Type | Risk |
|---|--------|-----------------|------|------|
| 1 | `src/compiler/proto/index.ts` | `transformCodec()` with defaults arg | function | **HIGH** -- `codec<T>(defaults)` generates `_applyDefaults` wrapper; zero test coverage for defaults feature |
| 2 | `src/compiler/index.ts` | `extractMessages()` / custom error messages | function | **HIGH** -- `validator.build<T, ErrorMessages>()` second type arg; advertised feature, no test |
| 3 | `src/compiler/validator.ts` | async validator generation | code path | **HIGH** -- `ASYNC_PATTERN` detection, `context.hasAsync` flag, generates `async (_input) => {}`; no test |
| 4 | `src/compiler/plugins/vite.ts` | Vite plugin config | default export | **MEDIUM** -- user-facing entry point, no test |
| 5 | `src/compiler/plugins/tsc.ts` | tsc plugin config | default export | **MEDIUM** -- user-facing entry point, no test |
| 6 | `src/compiler/index.ts:118-134` | namespace import detection | code path | **MEDIUM** -- `ns.codec<T>()`, `ns.validator.build<T>()` patterns untested |
| 7 | `src/compiler/validator.ts:376-393` | branded string validators | code path | **MEDIUM** -- template literal types and custom string brand validators untested |
| 8 | `src/codec.ts` | runtime `codec()` throws | function | **LOW** -- compile-time stub; trivial but no test verifies the error message |

## Shallow Tests

| # | Module | Export | Covered | Missing |
|---|--------|--------|---------|---------|
| 1 | `src/compiler/type-analyzer.ts` | `analyzeType()` | primitives, objects, unions, branded int/float, generics, Pick/Omit | template literal types, circular references, Function/Promise -> unknown, Record with explicit props, WeakMap cache hit |
| 2 | `src/compiler/error.ts` | `resolvePath()` | static paths via integration | record-mode paths (`'path.' + key`), dynamic/array paths (`'[' + key + ']'`); no direct unit test |
| 3 | `src/compiler/error.ts` | `generate()` | basic messages via integration | custom message lookup from `context.customMessages` map |
| 4 | `src/compiler/validators.ts` | `parse()`, `clear()`, `get()`, `inline()` | `get()` + `inline()` invoked through pipeline | `parse()` AST visitor for `validator.set()` calls; `clear()` cache clearing; `inline()` body/regex transforms -- no direct unit tests |
| 5 | `src/compiler/validator.ts` | `generateRecordValidation()` | string/number record values tested | boolean record values, default (unknown index type) path |
| 6 | `src/compiler/validator.ts` | `generateUnionValidation()` | primitive + literal unions | union with Date member, union with array member, union with object member |
| 7 | codec tests (encoder/decoder) | array encoding | number[], float[], string[], object[], integer[] | bigint[], boolean[] -- packed varint/boolean paths in encoder.ts + decoder.ts |
| 8 | codec tests | optional field encoding | not covered | encoder wraps optional fields in `if (... !== undefined)` -- no test |
| 9 | codec tests | nested + optional + array | not covered | combinations of nested objects with optional fields and arrays |
| 10 | `src/compiler/proto/runtime.ts` | runtime helpers | varint, float, double, bigint, string tested in proto-runtime.test.ts | tests use inlined helper copies, not actual `buildRuntimeHelpers()` / `analyzeRuntimeNeeds()` output |

## Missing Benchmarks

| # | Module | Export / Path | Reason |
|---|--------|--------------|--------|
| 1 | `src/compiler/proto/runtime.ts` | varint/string/float/double encode/decode | hot path -- called per-field during every encode/decode cycle |
| 2 | codec integration | encode/decode roundtrip throughput | core value proposition -- "zero runtime overhead" claim needs measurement |
| 3 | `src/compiler/validator.ts` | `generateValidator()` | compile-time code generation; measure cost per type complexity |
| 4 | `src/compiler/type-analyzer.ts` | `analyzeType()` | compile-time analysis; measure with complex nested types |

## Stale Tests

None found. All test imports resolve to existing exports.

## Recommendations

### Priority 1 -- Missing feature coverage (HIGH risk)

1. **Codec defaults**: Add test calling `codec<T>(defaults)` and verify decoded values use defaults for missing fields
2. **Custom error messages**: Add test calling `validator.build<T, Messages>()` with a second type arg providing custom messages per path
3. **Async validators**: Add test with `validator.set((value: BrandedType) => { await something; })` and verify generated code is async

### Priority 2 -- Plugin and integration gaps (MEDIUM risk)

4. **Plugin smoke tests**: At minimum test that `tsc.ts` and `vite.ts` default exports have expected shape (name, transform, etc.)
5. **Namespace imports**: Test `import * as data from '@esportsplus/data'; data.validator.build<T>()` and `data.codec<T>()` patterns
6. **Branded strings**: Test template literal type validation and custom string brand validators

### Priority 3 -- Deepen existing coverage

7. **Codec optional fields**: Encode/decode types with optional properties
8. **Codec boolean/bigint arrays**: Test packed encoding paths
9. **Type analyzer edge cases**: Circular types, template literals, Function/Promise
10. **Error path modes**: Direct unit tests for `resolvePath()` with record and dynamic modes

### Priority 4 -- Benchmarks

11. Create `benchmarks/` directory with Vitest bench
12. Benchmark codec encode/decode throughput for various type shapes
13. Benchmark validator execution time (generated functions)
14. Benchmark compile-time cost (type analysis + code generation)
