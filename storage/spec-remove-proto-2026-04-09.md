# Spec: Remove Proto Compiler

**Status**: PENDING
**Date**: 2026-04-09
**Scope**: Delete proto compiler, its tests, its codec API, and all references

Proto is replaced by SBC. The `codec<T>()` API (proto-backed) is superseded by `createCodec<T>()` (SBC-backed). All proto-specific audit findings (F-027 through F-030, F-032, F-033, F-039, F-043 through F-045, F-047) become resolved by deletion.

---

## Batch 1: Delete Proto Source + Codec Sentinel

### F-R01: Delete src/compiler/proto/ directory
- **Action**: Delete entire directory (6 files, 1371 LOC)
- **Files**:
  - src/compiler/proto/decoder.ts (333 LOC)
  - src/compiler/proto/encoder.ts (463 LOC)
  - src/compiler/proto/field-mapper.ts (37 LOC)
  - src/compiler/proto/index.ts (60 LOC)
  - src/compiler/proto/runtime.ts (382 LOC)
  - src/compiler/proto/type-mapper.ts (96 LOC)

### F-R02: Delete src/codec.ts
- **Action**: Delete file (19 LOC) — the `codec<T>()` sentinel that proto transforms
- **Resolves**: F-026 (codec sentinel throw untested), F-053 (same)

### F-R03: Remove proto from src/compiler/index.ts
- **File**: src/compiler/index.ts
- **Action**: Edit — remove these references:
  1. **Line 7**: Delete `import { transformCodec } from './proto';`
  2. **Line 11**: Change `type CallType = 'codec' | 'validator.build'` → `type CallType = 'validator.build'`
  3. **Lines 66-67**: Delete `case 'codec': return transformCodec(...)` from the switch
  4. **Lines 100-104**: Delete the `codec<T>()` direct-call detection block:
     ```
     if (imports.includes(checker, expr, PACKAGE_NAME, 'codec')) {
         callType = 'codec';
         traceNode = expr;
     }
     ```
  5. **Lines 117-122**: Delete the `ns.codec<T>()` namespace detection block:
     ```
     else if (methodName === 'codec' && ts.isIdentifier(expr.expression)) { ... }
     ```
  6. **Lines 145-147**: Delete the `configArg` extraction for codec:
     ```
     if (callType === 'codec' && node.arguments.length > 0) {
         detected.configArg = node.arguments[0];
     }
     ```
  7. **Lines 195-196**: Delete the codec removal intent:
     ```
     if (call.callType === 'codec' && remove.indexOf('codec') === -1) {
         remove.push('codec');
     }
     ```
  8. **Line 167**: Remove `'codec<', 'codec(', '.codec'` from patterns array

### F-R04: Remove codec exports from src/index.ts
- **File**: src/index.ts
- **Action**: Delete line 21: `export { codec, type Codec } from './codec';`

## Batch 2: Delete Proto Tests

### F-R05: Delete proto test files
- **Action**: Delete 2 files (1066 LOC)
- **Files**:
  - tests/proto-mapping.ts (276 LOC)
  - tests/proto-runtime.ts (790 LOC)

### F-R06: Delete codec transform test files
- **Action**: Delete 5 files — these all test the proto-compiled `codec<T>()` output via `createCodec` in tests/utils.ts
- **Files**:
  - tests/codec.ts
  - tests/codec-advanced.ts
  - tests/codec-arrays.ts
  - tests/codec-defaults.ts
  - tests/codec-optional.ts

### F-R07: Remove createCodec from tests/utils.ts
- **File**: tests/utils.ts
- **Action**: Delete the `createCodec` function (lines 134-188) and remove it from the export (line 191)
- **Keep**: `createValidator`, `createProgram`, `mightNeedTransform`, `transformCode` — still used by validator tests

## Batch 3: Clean Up Benchmarks + Storage

### F-R08: Remove proto from tests/bench/all-codecs.ts
- **File**: tests/bench/all-codecs.ts
- **Action**: Remove all proto codec references:
  1. Line 8: Delete `import { createCodec as createProtoCodec } from '../utils';`
  2. Lines 25-48: Delete proto codec creation (`protoSimple`, `protoMulti`, etc.)
  3. Lines 65-69: Delete proto pre-encoding
  4. Lines 85-100: Remove proto from wire size comparison table
  5. All `proto` references in benchmark loops and totals reporting
  6. Update file header comment to remove "Proto"
- **Also**: Line 7 imports `createCodec as createSbcCodec` which duplicates line 6 (`createCodec as createCodec2`). Both import from `../../src/sbc`. Consolidate into a single import.

### F-R09: Delete obsolete storage files
- **Action**: Delete files that reference proto audit findings now resolved by deletion:
  - storage/audit-data-2026-04-09.md — findings F-027 through F-030, F-032, F-033 are proto-specific
  - storage/audit-data-tests-2026-04-08.md — proto test audit findings
- **Note**: The audit registry (.claude/skill/code-audit/registry-data.json) should mark proto findings as resolved

### F-R10: Update audit registry
- **File**: .claude/skill/code-audit/registry-data.json
- **Action**: Mark these findings as `"status": "resolved-by-deletion"`:
  - F-027 (_readVarint negative int32)
  - F-028 (_readBigInt no sign extension)
  - F-029 (decoder tuple allocation)
  - F-030 (proto tag single-byte write)
  - F-032 (_writeString allocation)
  - F-033 (_writeVarint Math.floor)
  - F-039 (encoder/decoder State dedup)
  - F-043 (analyzeRuntimeNeeds 0 test refs)
  - F-044 (generateEncoder untested paths)
  - F-045 (generateDecoder SKIP_UNKNOWN_FIELD)
  - F-047 (transformCodec defaults untested)
  - F-053 (codec sentinel throw untested)
- **Also**: Remove clean_symbols entries for proto files (compileSchema, FieldDef, ParsedType, Schema, SbcHelpers from codegen.ts; compiler/sbc/index.ts default)

---

## Summary

| Metric | Count |
|--------|-------|
| Files deleted | 14 |
| Files edited | 4 |
| LOC removed | ~3,500 |
| Audit findings resolved | 12 |
| Remaining audit findings | 44 (F-001 through F-056 minus 12 resolved) |

## Validation

After all changes:
1. `pnpm tsc --noEmit` — must compile clean
2. `pnpm test` — remaining tests must pass (validator tests, sbc tests, bench tests)
3. `grep -r "proto" src/compiler/` — should return 0 results
4. `grep -r "transformCodec\|generateEncoder\|generateDecoder\|buildRuntimeHelpers\|analyzeRuntimeNeeds" src/` — should return 0 results
