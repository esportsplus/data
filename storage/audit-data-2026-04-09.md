# Testing Audit — @esportsplus/data

**Status**: COMPLETE
**Date**: 2026-04-09
**Commit**: 4b255c8
**Mode**: first-run (tests/ directory target — Testing agent only)
**Scope**: tests/ directory (Testing agent dispatched per skill rule for test-directory targets)

## Scope

| Metric | Count |
|--------|-------|
| Total source files | 83 |
| Total test files | 22 (+6 bench) |
| Symbols evaluated | ~120 |
| Test LOC | ~7,863 |

## Context Validation

- CONTEXT.md: present (scoped to codec2/ — partial coverage)
- Dependency graph: available via repo memory
- Risk scores: available from CONTEXT.md Section 8

## Agent Dispatch

| Agent | Symbols | Sub-targets | Findings |
|-------|---------|-------------|----------|
| Testing (SBC) | 34 | 1 | 10 |
| Testing (Compiler) | 15 | 1 | 9 |
| Testing (Validators) | 56 | 1 | 7 |
| Testing (Transform) | 10 (test files) | 1 | 15 |

---

## Findings (Post-Judge)

### P0 — Immediate (score >= 80)

#### F-001: `validator.build()` with no type argument — no graceful no-op test
- **Category**: test-quality
- **Priority**: 88
- **File**: `src/compiler/index.ts`
- **Test**: `tests/transformer.ts`
- **Confidence**: HIGH
- **Evidence**: `compiler/index.ts:82` checks `node.typeArguments?.length > 0`. If `validator.build()` is called without type arguments, no transform occurs (call passes through unchanged). No test verifies this graceful no-op behavior — the most likely user error scenario.

#### F-002: `validators.inline` — eval/Function disallowed pattern throw path untested
- **Category**: test-quality
- **Priority**: 86
- **File**: `src/compiler/validators.ts`
- **Test**: N/A — no test exists
- **Confidence**: HIGH
- **Evidence**: `DISALLOWED_BODY_REGEX` at line 95 of `validators.ts` rejects validator bodies containing `eval`/`Function`. The throw `'Validator: body contains disallowed pattern (eval/Function)'` is a security-critical error path with zero test coverage. Grep for `disallowed`, `DISALLOWED`, `validators.inline` across all test files returns 0 matches.

#### F-003: `Record<string, ComplexType>` — validation silently skipped via `check = 'false'` fallback
- **Category**: test-quality
- **Priority**: 86
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/complex.ts`
- **Confidence**: HIGH
- **Evidence**: `generateRecordValidation` (`validator.ts:327-360`) has a `default: check = 'false'` fallback for value types that aren't boolean/number/string. A `Record<string, SomeType>` with complex value types silently passes any value. No test exercises this fallback path.

#### F-004: `uuid.v2, v3, v5, v6, v8` — 5 version-specific validators with zero test coverage
- **Category**: test-quality
- **Priority**: 81
- **File**: `src/validators/uuid.ts`
- **Test**: `tests/validators-format.ts`
- **Confidence**: HIGH
- **Evidence**: `uuid` exports `{ v1, v2, v3, v4, v5, v6, v7, v8 }` via `factory()`. Tests only exercise `uuid()`, `uuid.v1()`, `uuid.v4()`, `uuid.v7()`. Each version uses a distinct regex with the version digit at position 13 — correctness is unverified for v2, v3, v5, v6, v8.

### P1 — This Sprint (score 40-79)

#### F-005: `extractField` — missing test for map/set/typedarray field before target
- **Category**: test-quality
- **Priority**: 76
- **File**: `src/sbc/index.ts`
- **Test**: `tests/sbc.ts`
- **Confidence**: HIGH
- **Evidence**: Variable-size scan `switch (f.type)` covers `bytes`, `string`, `array`, `mixed`, `object` but not `map`, `set`, or `typedarray`. These fall to `default: return undefined`, silently aborting extraction. No test places a map/set/typedarray before a target field.

#### F-006: NaN/Infinity input to number type validator — untested boundary
- **Category**: test-quality
- **Priority**: 76
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/primitives.ts`
- **Confidence**: HIGH
- **Evidence**: Number validation coerces via `+value`. `NaN`, `Infinity`, `-Infinity` all pass `typeof 'number'`. Tests cover `0`, negatives, string coercion, non-numeric strings — but never NaN/Infinity as input to the generic number validator path.

#### F-007: `any`/`unknown` property types being skipped — no test
- **Category**: test-quality
- **Priority**: 76
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/primitives.ts`
- **Confidence**: HIGH
- **Evidence**: `generateValidator` (`validator.ts:508-510`) explicitly skips `any`, `unknown`, `never`. The `never` case is tested in edge-cases.ts, but type properties `{ value: any }` and `{ value: unknown }` are completely untested. These allow any value through with no validation.

#### F-008: Custom error messages on non-static paths (array/record) — untested
- **Category**: test-quality
- **Priority**: 76
- **File**: `src/compiler/error.ts`
- **Test**: `tests/custom-messages.ts`
- **Confidence**: HIGH
- **Evidence**: `error.ts:32-34` looks up custom messages only when `pathMode.kind === 'static'`. For `dynamic` (array) or `record` paths, uses `''` as lookup key. No test exercises custom error messages on array item or record value validation.

#### F-009: Optional nested object property extraction — untested path
- **Category**: test-quality
- **Priority**: 76
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/complex.ts`
- **Confidence**: HIGH
- **Evidence**: `generatePropertyExtraction` (`validator.ts:297-321`) has three branches: optional (spread), nested (recurse), plain (direct). No test verifies that an optional nested object `{ nested?: { prop: string } }` is correctly extracted with only its declared properties.

#### F-010: Nullable record `Record<string, T> | null` — untested
- **Category**: test-quality
- **Priority**: 76
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/complex.ts`
- **Confidence**: HIGH
- **Evidence**: `generateRecordValidation` does NOT handle `prop.nullable` unlike `generateObjectValidation` and `generateArrayValidation`. Record validation always requires non-null. No test exercises nullable records.

#### F-011: `typed-array-codec.ts` — all 4 exports have zero test references
- **Category**: coverage
- **Priority**: 74
- **File**: `src/typed-array-codec.ts`
- **Confidence**: HIGH
- **Evidence**: Grep for `TYPED_ARRAY_MARKER|decodeTypedArray|encodeTypedArrayInto|getTypedArrayType|typed-array-codec` across all test files returns 0 matches. These are exported from `src/index.ts` (lines 22-27) but never tested.

#### F-012: `generateValidator` — zero direct test imports
- **Category**: coverage
- **Priority**: 74 (+20 consensus: SBC + Compiler agents)
- **File**: `src/compiler/validator.ts`
- **Confidence**: MEDIUM
- **Evidence**: Grep confirms no test file imports `generateValidator`. Exercised indirectly through compiler plugin pipeline. Error paths in this 469-LOC function have no isolated tests, making root-cause isolation harder.

#### F-013: `undefined` as top-level input — untested TypeError path
- **Category**: test-quality
- **Priority**: 73
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/edge-cases.ts`
- **Confidence**: HIGH
- **Evidence**: Tests cover `null` input (line 108-120) and array/string inputs, but never `undefined`. The generated validator does `_input.prop` — on `undefined` this throws `TypeError`. This behavioral path is untested.

#### F-014: `deserializeRegistry` — empty field name/type throw paths untested
- **Category**: test-quality
- **Priority**: 71
- **File**: `src/sbc/index.ts`
- **Test**: `tests/sbc.ts`
- **Confidence**: HIGH
- **Evidence**: Throws `'Codec2: empty field name in registry data'` when `nameLen === 0` and `'empty field type in registry data'` when `typeLen === 0`. Corruption tests (lines 3258-3320) test truncated input, MAX_SCHEMA_COUNT, empty buffer, truncated field data — but never nameLen=0 or typeLen=0.

#### F-015: SBC `replaceCall` — encode/decode variable/spread 2nd arg untested
- **Category**: test-quality
- **Priority**: 71
- **File**: `src/compiler/sbc/index.ts`
- **Test**: `tests/sbc-schema-hints.ts`
- **Confidence**: HIGH
- **Evidence**: `replaceCall` has 5 branches for encode's 2nd arg: (1) no arg, (2) boolean literal, (3) object literal, (4) variable (spread). Tests cover branches 1-3. The variable branch `{...${secondArgText},"schema":${schema}}` is never tested.

#### F-016: SBC `replaceCall` — decode with object literal 2nd arg untested
- **Category**: test-quality
- **Priority**: 71
- **File**: `src/compiler/sbc/index.ts`
- **Test**: `tests/sbc-schema-hints.ts`
- **Confidence**: HIGH
- **Evidence**: Decode path's "2nd arg is object literal — merge schema" branch untested. Tests cover `decode<T>(buf)` (no arg) and numeric offset, but not `codec.decode<T>(buf, { someOption: true })`.

#### F-017: Union `object | array[]` — overlapping runtime checks untested
- **Category**: test-quality
- **Priority**: 71
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/unions.ts`
- **Confidence**: HIGH
- **Evidence**: `generateUnionValidation` has explicit `case 'object'` and `case 'array'` branches. Input `[]` satisfies array branch but object check also passes. AND semantics need testing.

#### F-018: `extractField` — unregistered schema hash returns undefined untested
- **Category**: test-quality
- **Priority**: 63
- **File**: `src/sbc/index.ts`
- **Test**: `tests/sbc.ts`
- **Confidence**: HIGH
- **Evidence**: `extractField` returns `undefined` when `registry.schemas.get(hash)` is null. Tested for non-tag-8 buffer, but no test constructs tag-8 header with unknown schema hash.

#### F-019: `deserializeRegistry` — invalid type string rejection untested
- **Category**: test-quality
- **Priority**: 63
- **File**: `src/sbc/index.ts`
- **Test**: `tests/sbc.ts`
- **Confidence**: MEDIUM
- **Evidence**: `parseFieldType(type)` throws `'unknown field type'` for invalid type strings. No test crafts a serialized registry with an invalid field type.

#### F-020: `bytes.min()`, `bytes.max()` — custom error parameter untested
- **Category**: test-quality
- **Priority**: 63
- **File**: `src/validators/bytes.ts`
- **Test**: `tests/validators-constraints.ts`
- **Confidence**: HIGH
- **Evidence**: `bytes(n, error?)` has custom error test. `bytes.min(n, error?)` and `bytes.max(n, error?)` accept `error?` but custom error propagation never asserted.

#### F-021: `words.min()`, `words.max()` — custom error parameter untested
- **Category**: test-quality
- **Priority**: 63
- **File**: `src/validators/words.ts`
- **Test**: `tests/validators-constraints.ts`
- **Confidence**: HIGH
- **Evidence**: Same pattern as F-020. Custom error propagation untested for sub-methods.

#### F-022: `graphemes.min()`, `graphemes.max()` — custom error parameter untested
- **Category**: test-quality
- **Priority**: 63
- **File**: `src/validators/graphemes.ts`
- **Test**: `tests/validators-constraints.ts`
- **Confidence**: HIGH
- **Evidence**: Same pattern as F-020.

#### F-023: `unique()` — NaN deduplication edge case untested
- **Category**: test-quality
- **Priority**: 63
- **File**: `src/validators/unique.ts`
- **Test**: `tests/validators-number-date.ts`
- **Confidence**: MEDIUM
- **Evidence**: `Set` treats `NaN === NaN` (unlike `===` operator). `[NaN, NaN]` would be detected as duplicates. Tests cover duplicate numbers, strings, null, undefined, object references — but not NaN.

#### F-024: `Required<T>` partial input — weak assertion
- **Category**: test-quality
- **Priority**: 61
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/transformer.ts`
- **Confidence**: MEDIUM
- **Evidence**: `transformer.ts:168-179` tests `Required<Opt>` but asserts `expect(typeof partialResult.ok).toBe('boolean')` instead of `expect(partialResult.ok).toBe(false)`. Assertion documents behavior rather than verifying correctness.

#### F-025: Tuple in union type — untested
- **Category**: test-quality
- **Priority**: 61
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/unions.ts`
- **Confidence**: MEDIUM
- **Evidence**: `generateUnionValidation` switch handles `boolean`, `date`, `number`, `string`, `object`, `array` but no `tuple` case. Union like `[number, string] | boolean` would skip tuple validation entirely.

#### F-026: SBC `replaceCall` — decode with numeric literal 2nd arg untested at compile level
- **Category**: test-quality
- **Priority**: 58
- **File**: `src/compiler/sbc/index.ts`
- **Test**: `tests/sbc-schema-hints.ts`
- **Confidence**: MEDIUM
- **Evidence**: `ts.isNumericLiteral(secondArg)` branch replaces `decode<T>(buf, 100)` with schema options. Runtime backward-compat test exists but compile-level transformation not tested.

#### F-027: Empty unionTypes — validation skipped
- **Category**: test-quality
- **Priority**: 58
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/unions.ts`
- **Confidence**: MEDIUM
- **Evidence**: `generateUnionValidation` returns `''` when `checks.length === 0`, silently skipping validation. Reachable when union resolves to only null/undefined after extraction.

#### F-028: Null-prototype objects (`Object.create(null)`)
- **Category**: test-quality
- **Priority**: 48
- **File**: `src/sbc/index.ts`
- **Test**: `tests/sbc.ts`
- **Confidence**: MEDIUM
- **Evidence**: `encode` fast path checks `value.constructor === undefined`. One test at line 930 uses `Object.create(null)` for __proto__ pollution but general encode/decode of null-prototype objects untested.

#### F-029: `error.generate` — message with special chars (quotes/backslashes)
- **Category**: test-quality
- **Priority**: 48
- **File**: `src/compiler/error.ts`
- **Test**: `tests/error-paths.ts`
- **Confidence**: MEDIUM
- **Evidence**: `error.generate` wraps message in single quotes via `code.escape(message)`. All tests use clean ASCII. No test for messages containing single quotes or backslashes.

#### F-030: `hex()` — empty string boundary untested
- **Category**: test-quality
- **Priority**: 48
- **File**: `src/validators/hex.ts`
- **Test**: `tests/validators-format.ts`
- **Confidence**: MEDIUM
- **Evidence**: `hex()` regex is `/^[0-9a-fA-F]+$/` — `+` requires >=1 char. Empty string `''` is a boundary not tested.

#### F-031: `multipleOf()` — Infinity input untested
- **Category**: test-quality
- **Priority**: 48
- **File**: `src/validators/multiple-of.ts`
- **Test**: `tests/validators-number-date.ts`
- **Confidence**: MEDIUM
- **Evidence**: `Infinity % n` yields `NaN` (falsy). Tests cover NaN but not `Infinity` which passes `typeof === 'number'`.

#### F-032: `enum` vs `literal` error message disambiguation
- **Category**: test-quality
- **Priority**: 48
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/unions.ts`
- **Confidence**: MEDIUM
- **Evidence**: Uses regex `toMatch(/invalid (enum|literal) type/)` — doesn't verify which codegen path was taken.

#### F-033: `bigint` literal in union type — untested
- **Category**: test-quality
- **Priority**: 48
- **File**: `src/compiler/validator.ts`
- **Test**: `tests/unions.ts`
- **Confidence**: MEDIUM
- **Evidence**: `analyzeUnionType` falls through to `analyzePropertyType` for bigint. `generateUnionValidation` has no `case 'bigint'` — union member generates no runtime check.

#### F-034: `computeSize` — nested typed-object with variable fields returning -1
- **Category**: test-quality
- **Priority**: 46
- **File**: `src/sbc/index.ts`
- **Test**: `tests/sbc.ts`
- **Confidence**: MEDIUM
- **Evidence**: computeSize for `object(hash)` with `refHash` recurs into nested schema. Nested ref with variable-size string hits `default: return -1`. Tested for fixed-size only.

---

## Invalidated Findings

| Original ID | Reason |
|-------------|--------|
| SBC-F002 | MERGED into F-012 (consensus with CMP-F001) |
| SBC-F003 | INVALID — platform.ts exports are internal (not in main barrel) |
| CMP-F003 | INVALID — validators.get is internal helper |
| CMP-F004 | INVALID — vague "happy path not tested" |
| CMP-F009 | INVALID — vague caching concern |
| TRN-F014 | INVALID — vague false positive patterns |

---

## Summary

- Audit agents dispatched: 4 (testing: 4, gap re-dispatch: 0)
- **Audit mode**: first-run (tests/ directory target)
- Files audited: 22 test files, 83 source files
- **Symbol coverage**: Testing: ~120 / ~120 (100%)
- **Total findings** (post-judge): 34
- Findings merged by judge: 1
- Findings rejected by judge: 5
- Multi-agent agreement findings: 1 (F-012)
- Findings by category: coverage 2 | test-quality 32
- Findings by priority: P0 **4** | P1 **30**
- Estimated total LOC delta: +300 / -0

## SQALE Technical Debt Rating

**Grade: D**

4 P0 findings + 30 P1 findings → Grade D

| Grade | Criteria |
|-------|---------|
| A | 0 P0, <= 3 P1 |
| B | 0 P0, 4-10 P1 |
| C | 0 P0, 11-25 P1 OR 1 P0 |
| D | 2-5 P0 OR 25+ P1 |
| E | 6+ P0 |

## Convergence Status

### Per-Category
| Category | Runs | Last | Yield Curve | Status |
|----------|------|------|-------------|--------|
| testing | 1 | ok | 34 | INSUFFICIENT_DATA |

### Overall: INSUFFICIENT_DATA
Reason: first run — need 2+ successful runs for convergence estimation
Clean symbols at confidence >= 3: 0 / ~120

### Recommendation
Too few successful runs for convergence estimation. Run again after implementing Batch 1-2.

## Implementation Batches

### Batch 1: P0 — Critical test gaps (4 findings)
- F-001: `validator.build()` no type argument test
- F-002: `validators.inline` eval/Function throw path test
- F-003: `Record<string, ComplexType>` fallback test
- F-004: uuid version sub-methods tests

### Batch 2: SBC test quality (7 findings)
- F-005: extractField map/set/typedarray test
- F-011: typed-array-codec.ts coverage
- F-014: deserializeRegistry empty field name/type
- F-018: extractField unregistered schema hash
- F-019: deserializeRegistry invalid type string
- F-028: Null-prototype objects
- F-034: computeSize nested typed-object variable fields

### Batch 3: Compiler transform tests (8 findings)
- F-006: NaN/Infinity number validator test
- F-007: any/unknown property skipping test
- F-008: Custom messages on array/record paths
- F-009: Optional nested object extraction
- F-010: Nullable record validation
- F-013: undefined top-level input
- F-017: array|object union overlap
- F-027: Empty unionTypes skipped

### Batch 4: Compiler SBC plugin (4 findings)
- F-012: generateValidator direct tests
- F-015: SBC replaceCall variable/spread 2nd arg
- F-016: SBC replaceCall decode object literal 2nd arg
- F-026: SBC replaceCall numeric literal 2nd arg

### Batch 5: Validators test quality (7 findings)
- F-020: bytes.min/max custom error
- F-021: words.min/max custom error
- F-022: graphemes.min/max custom error
- F-023: unique() NaN deduplication
- F-024: Required<T> partial input assertion
- F-025: Tuple in union type
- F-030: hex() empty string

### Batch 6: Low-priority gaps (4 findings)
- F-029: error.generate special chars
- F-031: multipleOf Infinity
- F-032: enum vs literal error disambiguation
- F-033: bigint literal in union

## Next Steps
```
/spec-implementation storage/audit-data-2026-04-09.md --filter "Batch 1"
```
# Audit Spec: @esportsplus/data — Run 7

**Status**: COMPLETE
**Date**: 2026-04-09
**Project**: @esportsplus/data v0.4.0
**Commit**: 4b255c8
**Mode**: incremental (6 changed files since 633b053, 10 commits)
**Prior runs**: 6

---

## Scope Reduction

| Metric | Count |
|--------|-------|
| Total project files | 74 |
| Changed files (full audit) | 6 |
| Propagated via call-graph | 0 |
| Skipped (unchanged validators) | 57 |
| In scope | 17 (6 changed + 11 compiler/sbc dependencies) |
| Reduction | 77% |

## Agent Dispatch

| Agent | Symbols | Sub-targets | Status | Findings |
|-------|---------|-------------|--------|----------|
| Correctness (SBC) | 23 | 1 | ok | 4 |
| Correctness (Compiler) | 14 | 1 | ok | 3 |
| Security (SBC) | 7 | 1 (retry) | ok | 3 |
| Performance | 20 | 1 | ok | 2 |
| Architecture | 43 | 1 | ok | 3 |
| Testing (SBC) | 13 | 1 | ok | 5 |
| Testing (Compiler) | 10 | 1 | ok | 9 |

## Agent Failures

| Agent | Original Symbols | Attempt | Result |
|-------|-----------------|---------|--------|
| Security (full) | 15 | 1 | EMPTY — context exhaustion |
| Security (half-SBC) | 7 | 2 (retry) | OK — 3 findings |

---

## Findings (Post-Judge) — 29 total

### P0 — Immediate (10 findings)

#### F-S1: Unsanitized field names from deserializeRegistry flow into new Function() — RCE
- **File**: src/sbc/index.ts:2066, src/sbc/codegen.ts:120
- **Symbol**: deserializeRegistry → compileSchema
- **Category**: security
- **Evidence**: `readStr(data, pos, nameLen)` reads field names from untrusted wire bytes. Names flow through `defineSchema` → `compileSchema` → `compileEncoder/Decoder` where `JSON.stringify(name)` is used in `new Function()` body string. No field name validation exists anywhere in the pipeline.
- **Recommendation**: Add allowlist regex `if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) throw` in both `deserializeRegistry` and `defineSchema` for defense-in-depth.
- **Confidence**: HIGH (90)
- **Priority Score**: 113
- **Estimated LOC delta**: +4

#### F-S2: decodeAt reads tag-8/18 header bytes without bounds guard
- **File**: src/sbc/index.ts:1430-1436
- **Symbol**: decodeAt
- **Category**: security
- **Evidence**: `buffer[offset+5]` through `buffer[offset+8]` read with no check that `buffer.length >= offset + 9`. Out-of-bounds reads return `undefined`, `undefined|0 = 0`, producing silently wrong `dataLen`.
- **Recommendation**: Add `if (offset + 9 > buffer.length) throw` before header read.
- **Confidence**: HIGH (80)
- **Priority Score**: 103
- **Estimated LOC delta**: +6

#### F-CORR-3: compileDecoder tag-18 nested typed objects decoded with wrong decoder
- **File**: src/sbc/codegen.ts:558-586
- **Symbol**: compileDecoder
- **Category**: correctness
- **Evidence**: Generated code for object fields handles `b[p]===8||b[p]===18` but always calls `_s.decodeFn` (uncompressed), never `_s.compressedDecodeFn`. `compileCompressedDecoder` correctly dispatches at lines 840-856. Cross-codec (compress:true encode, compress:false decode) corrupts nested typed-object fields.
- **Recommendation**: Add `if(b[p]===18&&_s.compressedDecodeFn)` dispatch at three call sites, mirroring compileCompressedDecoder.
- **Confidence**: HIGH (90)
- **Priority Score**: 103
- **Estimated LOC delta**: +6

#### F-CORR-6: generateUnionValidation silently skips bigint union arms
- **File**: src/compiler/validator.ts:457-476
- **Symbol**: generateUnionValidation (via generateValidator)
- **Category**: correctness
- **Evidence**: Switch has no `case 'bigint'`. For `string|bigint`: only `typeof x !== 'string'` emitted. `BigInt(42)` incorrectly rejected.
- **Recommendation**: Add `case 'bigint': checks.push(\`typeof ${varname} !== 'bigint'\`); break;`
- **Confidence**: HIGH (92)
- **Priority Score**: 93
- **Estimated LOC delta**: +3

#### F-CORR-2: decode schema hint path checks len >= 5 but tag-8/18 needs len >= 9
- **File**: src/sbc/index.ts:1252
- **Symbol**: decode
- **Category**: correctness
- **Evidence**: Guard is `len >= 5` but header is 9 bytes. With 5 <= len < 9, calls `decodeFn(buffer, 9, 0)` reading past message boundary. Judge confirmed VALID.
- **Recommendation**: Change guard to `len >= 9` and validate `9 + dataLen <= len`.
- **Confidence**: HIGH (80)
- **Priority Score**: 93
- **Estimated LOC delta**: +3

#### F-CORR-1: extractField silent wrong value on truncated buffer
- **File**: src/sbc/index.ts:1643-1668, 369-383
- **Symbol**: extractField, readFixedField
- **Category**: correctness
- **Evidence**: O(1) path accumulates pos from fixedSizes without bounds check. `readFixedField` has no bounds check. Browser: `buf[pos]` returns undefined, `undefined|0 = 0`. Node: Buffer.readDoubleLE throws.
- **Recommendation**: Add `if (pos + target.fixedSize > buffer.length) throw` before readFixedField calls.
- **Confidence**: HIGH (85)
- **Priority Score**: 93
- **Estimated LOC delta**: +4

#### F-PERF-1: Map encode destructures iterator — per-entry tuple allocation
- **File**: src/sbc/index.ts:1013
- **Symbol**: encodeSbc
- **Category**: optimize
- **Evidence**: `for (let [k, v] of value)` on Map allocates 2-element array per entry. Hot path — called per Map encode.
- **Recommendation**: Replace with `value.forEach((v, k) => { ... })`.
- **Confidence**: HIGH (87)
- **Priority Score**: 103
- **Estimated LOC delta**: +0/-0

#### F-PERF-2: matchSchema Object.keys+sort on every cache-miss with structural schemas
- **File**: src/sbc/index.ts:1217-1220
- **Symbol**: matchSchema
- **Category**: optimize
- **Evidence**: `typedSchemas.size > 0` branch executes `Object.keys(obj).sort()` on every WeakMap miss for new object identities. Two allocations per call.
- **Recommendation**: Add key-count guard before Object.keys, or make hash order-independent (XOR-based).
- **Confidence**: HIGH (82)
- **Priority Score**: 93
- **Estimated LOC delta**: +3/-1

#### F-CORR-4: computeSize underestimates for nested typed objects >= 128 bytes
- **File**: src/sbc/index.ts:1986
- **Symbol**: computeSize
- **Category**: correctness
- **Evidence**: `size += 1 + nestedSize` assumes 1-byte varint length. Encoder uses 9-byte header when nestedSize >= 128. Underestimates by 8. Judge confirmed VALID.
- **Recommendation**: `size += (nestedSize < 128 ? 1 : 9) + nestedSize`
- **Confidence**: HIGH (85)
- **Priority Score**: 83
- **Estimated LOC delta**: +1

#### F-CORR-5: validators.get permanent cache — stale branded validators in watch mode
- **File**: src/compiler/validators.ts:80
- **Symbol**: get
- **Category**: correctness
- **Evidence**: Module-level `Map<string>` cache returns stale validators when program is rebuilt. `analyzeType` WeakMap self-invalidates; `validators.get` does not. Prior F-035, confirmed still present.
- **Recommendation**: Key cache on `ts.SourceFile` object (WeakMap) instead of path string.
- **Confidence**: HIGH (90)
- **Priority Score**: 83
- **Estimated LOC delta**: +3/-2

### P1 — This Sprint (19 findings)

#### F-S3: encode(view=true) returns alias of shared mutable encodeBuf
- **File**: src/sbc/index.ts:1419
- **Symbol**: encode
- **Category**: security
- **Priority Score**: 79
- Prior F-008, still present. Document borrow semantics or rename to `encodeView()`.

#### F-CORR-7: analyzeTupleType hardcodes optional=false
- **File**: src/compiler/type-analyzer.ts:250
- **Symbol**: analyzeTupleType
- **Category**: correctness
- **Priority Score**: 59
- `[string, number?]` generates strict length check, rejects valid `['hello']`.

#### F-ARCH-1: resolvePath dead export member
- **File**: src/compiler/error.ts
- **Symbol**: resolvePath (on default export)
- **Category**: loc
- **Priority Score**: 48

#### F-ARCH-3: FieldDef, ParsedType, SbcHelpers dead type exports
- **File**: src/sbc/codegen.ts:1239
- **Symbol**: FieldDef, ParsedType, SbcHelpers
- **Category**: loc
- **Priority Score**: 48

#### F-ARCH-2: sbc/index.ts reorg (2196 LOC, 3 concerns)
- **File**: src/sbc/index.ts
- **Category**: reorg
- **Priority Score**: 41
- Prior F-041, still unaddressed.

#### F-TEST-13: typed-array-codec all 3 exports 0 test refs
- **File**: src/typed-array-codec.ts
- **Category**: coverage
- **Priority Score**: 69

#### F-TEST-2: Multi-boolean >8 bitmap untested in compressed codec
- **File**: src/sbc/codegen.ts
- **Category**: test-quality
- **Priority Score**: 69

#### F-TEST-3: SIEVE evictOne() never triggered in tests
- **File**: src/sbc/cache.ts
- **Category**: test-quality
- **Priority Score**: 59

#### F-TEST-1: deserializeRegistry inner truncation paths untested
- **File**: src/sbc/index.ts
- **Category**: test-quality
- **Priority Score**: 59

#### F-TEST-4: readVarint/writeVarint 4/5-byte boundaries untested
- **File**: src/sbc/platform.ts
- **Category**: test-quality
- **Priority Score**: 55

#### F-TEST-8: validators.get all branches untested
- **File**: src/compiler/validators.ts
- **Category**: coverage
- **Priority Score**: 55

#### F-TEST-9: validators.inline throw + replacement paths untested
- **File**: src/compiler/validators.ts
- **Category**: test-quality
- **Priority Score**: 55

#### F-TEST-10: generateValidator custom code guard untested
- **File**: src/compiler/validator.ts
- **Category**: test-quality
- **Priority Score**: 55

---

# Code Audit — Run 8 (src/)

- **Date**: 2026-04-09
- **Commit**: `e59365a` (fix(compiler,sbc): bigint union, WeakMap cache, matchSchema guard, optional tuples)
- **Previous Commit**: `4b255c8`
- **Mode**: incremental (5 changed + 2 propagated, 67 skipped)
- **Changed files**: src/compiler/type-analyzer.ts (+7/-2), src/compiler/validator.ts (+35/-8), src/compiler/validators.ts (+19/-12), src/sbc/codegen.ts (+16/-8), src/sbc/index.ts (+35/-5)
- **Propagated**: src/compiler/index.ts, src/compiler/sbc/index.ts
- **SQALE Rating**: D
- **Agents**: 5/5 dispatched (correctness, security, performance, architecture, testing)

## Prior Findings Resolved

| ID | Title | Resolution |
|----|-------|------------|
| F-CORR-1 | extractField silent wrong value on truncated buffer | FIXED — bounds guard added |
| F-CORR-2 | decode schema hint path checks len >= 5 but needs >= 9 | FIXED — changed to `len >= 9` |
| F-CORR-3 | compileDecoder tag-18 nested objects use uncompressed decoder | FIXED — tag-18 dispatch added |
| F-CORR-4 | computeSize underestimates for nested objects >= 128 bytes | FIXED — `nestedSize < 128 ? 1 : 9` |
| F-CORR-5 | validators.get permanent cache stale in watch mode | FIXED — WeakMap keyed on SourceFile |
| F-CORR-6 | generateUnionValidation skips bigint union arms | FIXED — `case 'bigint'` added |
| F-CORR-7 | analyzeTupleType hardcodes optional=false | FIXED — reads elementFlags |
| F-010 | serialize/deserializeRegistry truncate non-Latin-1 field names | FIXED — FIELD_NAME_RE validation |
| F-S1 | Unsanitized field names → RCE | FIXED — FIELD_NAME_RE validation |
| F-S2 | decodeAt reads header without bounds guard | FIXED — `offset + 9` guard |
| F-S3 | encode(view=true) returns alias of shared mutable encodeBuf | MITIGATED — documented borrow semantics |
| F-ARCH-3 | Dead type exports (FieldDef/ParsedType/SbcHelpers) | CLOSED — reclassified: 1 internal consumer |
| F-TEST-1 | deserializeRegistry inner truncation paths untested | CLOSED — replaced by F-TEST-21 |

## P0 Findings (Score ≥ 90)

#### F-CORR-10: extractField returns wrong data for untyped (generic) array target fields
- **File**: src/sbc/index.ts:1845-1848
- **Symbol**: `extractField`
- **Category**: correctness
- **Evidence**: Generic arrays use flag-byte format, not tag-based. `decodeTagEnd` misinterprets flag bytes as tags → wrong byte range → corrupt data returned.
- **Priority Score**: 124
- **Judge Verdict**: VALID

#### F-CORR-11: extractField skip loop returns `undefined` for preceding map/set/typedarray fields
- **File**: src/sbc/index.ts:1806-1808
- **Symbol**: `extractField`
- **Category**: correctness
- **Evidence**: Switch `default: return undefined`. Map/Set/TypedArray fields hit default → fields after these types completely inaccessible.
- **Priority Score**: 114
- **Judge Verdict**: VALID

#### F-CORR-9: generateRecordValidation rejects null for nullable records
- **File**: src/compiler/validator.ts:343
- **Symbol**: `generateRecordValidation`
- **Category**: correctness
- **Evidence**: `${varname} === null` unconditionally → error. Every other validation function guards with `prop.nullable` but this one does not.
- **Priority Score**: 113
- **Judge Verdict**: VALID

#### F-PERF-1: Map encode `.forEach` closure — per-call allocation on hot encode path
- **File**: src/sbc/index.ts:1015
- **Symbol**: `encodeSbc`
- **Category**: optimize
- **Evidence**: `value.forEach((v, k) => { ... })` creates closure capturing `buf`, `p`, `encodeSbc` on every Map encode. Replace with `for (let [k, v] of value)`.
- **Priority Score**: 93
- **Judge Verdict**: VALID

#### F-CORR-8: generateUnionValidation missing tuple and record type checks
- **File**: src/compiler/validator.ts:474-495
- **Symbol**: `generateUnionValidation`
- **Category**: correctness
- **Evidence**: Switch has no `case 'tuple'` or `case 'record'`. Union like `string | [number, string]` — tuple arm produces no check → always rejected.
- **Priority Score**: 91
- **Judge Verdict**: VALID
- **Cross-agent consensus**: +20 bonus from F-TEST-15

#### F-TEST-15: bigint in union type — zero test coverage for validator path
- **File**: src/compiler/validator.ts:471 → tests/compile-validators.ts
- **Symbol**: `generateUnionValidation` — `case 'bigint'` branch
- **Category**: test-quality
- **Evidence**: No test defines `bigint | string` union type. The fixed `case 'bigint'` has zero coverage.
- **Priority Score**: 91 (includes +20 consensus with F-CORR-8)
- **Judge Verdict**: VALID

## P1 Findings (Score 40–89)

#### F-PERF-4: matchSchema `for...in` counting slower than `Object.keys().length`
- **File**: src/sbc/index.ts:1191
- **Symbol**: `matchSchema`
- **Category**: optimize
- **Evidence**: `for (let _ in obj) { keyCount++; }` — `Object.keys(obj).length` is ~30% faster in V8.
- **Priority Score**: 88
- **Judge Verdict**: VALID

#### F-TEST-20: defineSchema field name validation untested
- **File**: src/sbc/index.ts:1455 → tests/sbc.ts
- **Symbol**: `defineSchema` — `FIELD_NAME_RE.test()` throw path
- **Category**: test-quality
- **Evidence**: F-S1 fix added FIELD_NAME_RE validation but no test exercises invalid field name → throw path.
- **Priority Score**: 88
- **Judge Verdict**: VALID

#### F-TEST-16: Optional tuple validation — zero test coverage
- **File**: src/compiler/type-analyzer.ts:244-252, src/compiler/validator.ts:408-450 → tests/compile-validators.ts
- **Symbol**: `analyzeTupleType`, `generateTupleValidation`
- **Category**: test-quality
- **Evidence**: F-CORR-7 fix added optional tuple support (`elementFlags` + length range check). Zero tests exercise this path.
- **Priority Score**: 86
- **Judge Verdict**: VALID

#### F-TEST-21: deserializeRegistry field name validation untested
- **File**: src/sbc/index.ts:2089 → tests/sbc.ts
- **Symbol**: `deserializeRegistry` — `FIELD_NAME_RE.test(name)` throw path
- **Category**: test-quality
- **Evidence**: Crafted blob with invalid field name not tested. 0 test references.
- **Priority Score**: 83
- **Judge Verdict**: VALID

#### F-PERF-3: Packed uint8 array decode — element-by-element copy instead of subarray
- **File**: src/sbc/index.ts:618-625
- **Symbol**: `decodeSbc` (tag 12)
- **Category**: optimize
- **Evidence**: `new Array(count)` + element loop vs. `Array.from(buf.subarray(...))` for uint8 arrays.
- **Priority Score**: 78
- **Judge Verdict**: VALID

#### F-TEST-18: decodeAt truncation guard untested
- **File**: src/sbc/index.ts:1436-1438 → tests/sbc.ts
- **Symbol**: `decodeAt` — `offset + 9 > buffer.length` throw path
- **Category**: test-quality
- **Evidence**: F-S2 fix guard throws `'truncated tag-8/18 header'` but no test exercises short buffer.
- **Priority Score**: 73
- **Judge Verdict**: VALID

#### F-TEST-19: extractField buffer bounds guard untested
- **File**: src/sbc/index.ts:1680,1815 → tests/sbc.ts
- **Symbol**: `extractField` — `pos + target.fixedSize > buffer.length` throw paths (2 sites)
- **Category**: test-quality
- **Evidence**: Both `'buffer too short for field at offset'` throws untested.
- **Priority Score**: 73
- **Judge Verdict**: VALID

#### F-TEST-23: decode hint `len >= 9` boundary untested
- **File**: src/sbc/index.ts:1254 → tests/sbc.ts
- **Symbol**: `decode` hint path
- **Category**: test-quality
- **Evidence**: Changed from `len >= 5` to `len >= 9`. No test for 5-8 byte buffer with schema hint to verify guard rejects instead of reading OOB.
- **Priority Score**: 73
- **Judge Verdict**: VALID

#### F-TEST-17: Nested compressed object ref decode (tag-18 dispatch) — no tag-specific assertion
- **File**: src/sbc/codegen.ts:510-590 → tests/sbc.ts
- **Symbol**: `compileDecoder`/`compileCompressedDecoder`
- **Category**: test-quality
- **Evidence**: No test exercises compressible nested (int/bool fields) inside compressible outer → tag-18 inner headers.
- **Priority Score**: 56
- **Judge Verdict**: VALID

#### F-TEST-22: computeSize nested object ≥128 bytes varint path untested
- **File**: src/sbc/index.ts:2004 → tests/sbc.ts
- **Symbol**: `computeSize` — `nestedSize < 128 ? 1 : 9` (9-byte path)
- **Category**: test-quality
- **Evidence**: Only `nestedSize < 128` path exercised. Need 16+ fixed-size fields.
- **Priority Score**: 56
- **Judge Verdict**: VALID

#### F-PERF-2: matchSchema Object.keys+sort on cache-miss (partially mitigated)
- **File**: src/sbc/index.ts:1220
- **Symbol**: `matchSchema`
- **Category**: optimize
- **Evidence**: Fallback only triggers for `typedSchemas` path gated by `typedSchemaFieldCounts.has(keyCount)`, much rarer now.
- **Priority Score**: 50
- **Judge Verdict**: VALID — score reduced from 93

## Below-Threshold Findings (Score < 40)

#### F-ARCH-1: resolvePath dead export member (0 external callers)
- **File**: src/compiler/error.ts
- **Priority Score**: 23 — valid for cleanup sweep

#### F-ARCH-2: sbc/index.ts reorg (now 1706 LOC, down from 2196)
- **Priority Score**: 36 — below threshold, already improved

#### F-ARCH-4: Typed array element decode switch — 4-location duplication in codegen.ts
- **File**: src/sbc/codegen.ts (lines 187, 433, 731, 1074)
- **Priority Score**: 33 — valid for refactor

## Cross-Agent Overlap Matrix

| Finding Pair | Overlap Type | Bonus |
|---|---|---|
| F-CORR-8 + F-TEST-15 | Union validation (bigint) | +20 consensus |
| F-CORR-7 (FIXED) + F-TEST-16 | Optional tuple fix untested | Evidence trail |
| F-S1 (FIXED) + F-TEST-20 | Field name validation fix untested | Evidence trail |
| F-CORR-10/11 + F-TEST-19 | extractField bugs + bounds untested | Cascade |

## Summary

| Category | Prior Open | Resolved | New | Now Open |
|----------|-----------|----------|-----|----------|
| Correctness | 8 | 8 | 4 | 4 |
| Security | 3 | 3 | 0 | 0 |
| Performance | 2 | 0 | 2 | 4 |
| Architecture | 3 | 1 | 1 | 3 |
| Testing | 14 | 1 | 9 | 22 |
| **Total** | **30** | **13** | **16** | **33** |

- **P0** (≥90): 6 findings
- **P1** (40-89): 10 findings
- **Below threshold** (<40): 3 findings (cleanup candidates)
- **Agent coverage**: 104/104 symbols evaluated across 5 agents

#### F-TEST-14: Negative bigint roundtrip untested
- **File**: src/compiler/validator.ts
- **Category**: test-quality
- **Priority Score**: 55

#### F-TEST-12: sbc compiler decode(buf, numericLiteral) untested
- **File**: src/compiler/sbc/index.ts
- **Category**: test-quality
- **Priority Score**: 49

#### F-TEST-6: analyzeType cache hit path untested
- **File**: src/compiler/type-analyzer.ts
- **Category**: test-quality
- **Priority Score**: 49

#### F-TEST-7: resolveBrandedType non-intersection untested
- **File**: src/compiler/type-analyzer.ts
- **Category**: test-quality
- **Priority Score**: 49

#### F-TEST-5: compileSchema 0 direct test refs
- **File**: src/sbc/codegen.ts
- **Category**: coverage
- **Priority Score**: 43

#### F-TEST-11: compiler default early return untested
- **File**: src/compiler/index.ts
- **Category**: test-quality
- **Priority Score**: 43

---

## Resolved Prior Findings (this run confirms)

| Prior ID | Status | Resolution |
|----------|--------|------------|
| F-MERGE-1 | FIXED | schemaCount capped (7fce799) |
| F-MERGE-2 | FIXED | readVarint bounds + iteration cap (7fce799) |
| F-MERGE-3 | FIXED | decodeTagEnd bounds checks (7fce799) |
| F-006 | FIXED | matchSchema rejects elementType/refHash (4c624fa) |
| F-007 | FIXED | typedSchemas delete-on-collision (4c624fa) |
| F-NEW-C2 | FIXED | extractField tag-18 falls back to decode() |
| F-031 | FIXED | ERRORS_PUSH_REGEX replacer function (fea9a87) |
| F-034 | FIXED | null|undefined union returns type:'null' (fea9a87) |
| F-036 | FIXED | bounds check precedes header writes (fea9a87) |
| F-040 | FIXED | collectRefHashes helper extracted (4b255c8) |
| F-042 | FIXED | encodeObject helper extracted (4b255c8) |
| F-NEW-A1 | FIXED | validators.clear removed (4b255c8) |
| F-MERGE-4 | FIXED | _vr shared slot, no tuple alloc (63ea8d1) |
| F-NEW-P1 | FIXED | for-in keyCount replaces Object.keys.length (63ea8d1) |
| F-NEW-P2 | PARTIAL | Set fixed, Map still allocates (see F-PERF-1) |
| F-013-F-018 | FIXED | Test gaps filled |

---

## Summary

- Audit agents dispatched: 8 (correctness: 2, security: 2 (1 retry), performance: 1, architecture: 1, testing: 2)
- **Audit mode**: incremental (6 changed files, 10 commits since run 6)
- Files audited: 17 / 74 (23%)
- Files skipped (unchanged): 57
- **Symbol coverage by group**:
  - Correctness: 37 / 37 (100%)
  - Security: 7 / 7 (100%, half-scope retry)
  - Performance: 20 / 20 (100%)
  - Architecture: 43 / 43 (100%)
  - Testing: 23 / 23 (100%)
- **Total findings** (post-judge): 29
- Findings merged by judge: 0
- Findings rejected by judge: 0
- Multi-agent agreement findings: 0 (disjoint categories by design)
- Findings by category: correctness 7 | security 3 | optimize 2 | loc 2 | reorg 1 | coverage 3 | test-quality 11
- Findings by priority: P0 10 | P1 19 | P2 0
- Estimated total LOC delta: +33 / -3
- Semgrep seeds: N/A

## SQALE Technical Debt Rating

**Grade: E**

| Grade | Criteria |
|-------|---------|
| E | 6+ P0 — 10 P0 findings including 1 CRITICAL security (RCE) |

---

## Implementation Batches

### Batch 1: Security — 3 findings
- F-S1: Unsanitized field names → new Function() RCE
- F-S2: decodeAt missing bounds guard
- F-CORR-2: decode hint path len >= 5 → needs >= 9

### Batch 2: Correctness (SBC codec) — 4 findings
- F-CORR-3: compileDecoder tag-18 wrong decoder dispatch
- F-CORR-1: extractField silent wrong value on truncated buffer
- F-CORR-4: computeSize underestimates nested objects >= 128 bytes
- F-PERF-1: Map encode destructuring allocation

### Batch 3: Correctness (Compiler) + Performance — 4 findings
- F-CORR-6: generateUnionValidation skips bigint arms
- F-CORR-5: validators.get stale cache in watch mode
- F-PERF-2: matchSchema Object.keys+sort allocation
- F-CORR-7: analyzeTupleType optional=false

### Batch 4: Architecture — 3 findings
- F-ARCH-1: resolvePath dead export
- F-ARCH-3: Dead type exports (FieldDef, ParsedType, SbcHelpers)
- F-ARCH-2: sbc/index.ts reorg

### Batch 5: Testing (SBC) — 8 findings
- F-TEST-13, F-TEST-2, F-TEST-3, F-TEST-1, F-TEST-4, F-TEST-5, F-TEST-12, F-TEST-14

### Batch 6: Testing (Compiler) — 7 findings
- F-TEST-8, F-TEST-9, F-TEST-10, F-TEST-6, F-TEST-7, F-TEST-11, F-TEST-14

## Next Steps
```
/spec-implementation storage/audit-data-2026-04-09.md --filter "Batch 1"
```
