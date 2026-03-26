# SBC Refactor Analysis

**Source**: `G:/LMDBX-js/src/sbc.ts` (2651 LOC) + `typed-array-codec.ts` (122 LOC)
**Date**: 2026-03-26

---

## Executive Summary

`sbc.ts` is a schema-binary-codec that JIT-compiles encode/decode functions via `new Function()` for zero-overhead object serialization. The file is 2651 lines with significant structural duplication across its codegen paths. A ground-up refactor could reduce it to ~1400-1600 LOC while preserving identical runtime behavior and compiled output.

---

## 1. Buffer Abstraction Layer (Lines 8-95) — **88 LOC → ~30 LOC**

### Problem
14 individual `let` declarations, each with a Node/browser ternary. The read/write functions are used both directly (`.call()` in hand-written code) AND indirectly (via the `CodegenDriver` for compiled code). This creates two parallel abstraction layers for the same operations.

### Refactoring
**Replace with a single `DataView`-based path.** Node's `Buffer` methods (`readDoubleLE`, `writeUInt32LE`, etc.) offer negligible advantage over `DataView` in modern Node (v18+). The Buffer prototype extraction + `.call()` pattern was a micro-optimization from Node <16 era — V8 now inlines `DataView` get/set as well as Buffer methods.

```typescript
// Before: 14 separate ternaries
let readF64: ((off: number) => number) = isNode
    ? Buffer.prototype.readDoubleLE
    : function (this: Uint8Array, off: number) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat64(off, true); };

// After: unified, ~2 LOC per operation via helper
let dv = (buf: Uint8Array) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
```

Or better — keep DataView creation at call sites in the codegen (which already does this for browser path), and drop the hand-written read/write functions entirely since they're only used in `decodeSbc`/`encodeSbc`/`InternPool`. Those functions could use a local `DataView` variable created once per call.

**Impact**: Eliminates `isNode`, `allocBuf`, `allocUnsafe`, `copyBuf`, `fromUtf8`, `toUtf8`, `readBI64`, `readF64`, `readI16`, `readI32`, `readU16`, `readU32`, `readUtf8`, `writeBI64`, `writeF64`, `writeI16`, `writeI32`, `writeU16`, `writeU32`, `writeUtf8` — 14 function bindings reduced to a `DataView` helper + `TextEncoder`/`TextDecoder` reuse.

**Risk**: Marginal perf regression in Node for the hand-written paths (non-compiled `decodeSbc`/`encodeSbc`). Compiled paths already use direct codegen and wouldn't change. Measure with the bench suite before committing.

### Alternative (conservative)
Keep `isNode` but consolidate read/write into a typed record:

```typescript
let io = isNode ? {
    rBI64: Buffer.prototype.readBigInt64LE,
    rF64: Buffer.prototype.readDoubleLE,
    // ...
} : {
    rBI64: function(this: Uint8Array, off: number) { ... },
    // ...
};
```

One object, two branches. Same LOC savings (~60 lines), no perf risk.

---

## 2. CodegenDriver Duplication (Lines 98-174) — **77 LOC → ~35 LOC**

### Problem
`nodeDriver` and `browserDriver` are near-identical objects with 17 methods each. They differ only in the string templates they emit. Many methods follow the pattern `(off) => 'buf.readXXX(' + off + ')'` vs `(off) => '_v.getXXX(' + off + ',true)'`.

### Refactoring
**Table-driven codegen.** Replace the two driver objects with a single data table mapping operation names to Node/browser format strings:

```typescript
let ops = {
    BI64: ['readBigInt64LE', 'getBigInt64'],
    F64:  ['readDoubleLE',   'getFloat64'],
    I16:  ['readInt16LE',    'getInt16'],
    I32:  ['readInt32LE',    'getInt32'],
    U16:  ['readUInt16LE',   'getUint16'],
    U32:  ['readUInt32LE',   'getUint32'],
};

// Generate read/write methods programmatically
```

The `preamble`, `byteLen`, `encoderParams`, `decoderParams`, and UTF8 methods remain special-cased (5 methods), but the 12 read/write methods collapse to a loop.

---

## 3. Encoder/Decoder Pair Duplication — **~1000 LOC → ~550 LOC**

This is the single largest opportunity. The file has **four** parallel code-generation pipelines:

| Function | Lines | Purpose |
|----------|-------|---------|
| `compileDecoder` | 1218-1288 | Standard decoder |
| `compileEncoder` | 1290-1361 | Standard encoder |
| `compileCompressedDecoder` | 502-639 | Compressed decoder |
| `compileCompressedEncoder` | 641-780 | Compressed encoder |

Plus their supporting emit functions:

| Function | Lines | Paired With |
|----------|-------|-------------|
| `emitDecoderFixed` | 888-923 | `emitDecoderFixedExpr` (782-795) |
| `emitEncoderFixed` | 1044-1080 | `emitEncoderFixedAtOffset` (822-854) |
| `emitDecoderVar` | 925-1015 | `emitEncoderVar` (1082-1182) |
| `emitDecoderVarInner` | 1017-1042 | `emitEncoderVarInner` (1184-1216) |
| `emitDeltaArrayDecoder` | 797-808 | `emitDeltaArrayEncoder` (810-820) |
| `emitFloat64ArrayCompressedDecoder` | 856-869 | `emitFloat64ArrayCompressedEncoder` (871-886) |

### Key Observation
`compileDecoder` and `compileCompressedDecoder` share ~70% of their structure:
- Both iterate fields, categorize into bool/int/float64/otherFixed
- Both handle nullable bitmaps
- Both emit the same preamble/epilogue
- Both bind the same helpers

The compressed variants add: bool bitmap packing, varint encoding for ints, float64 integer-detection, delta array encoding. These are **field-level** differences, not structural ones.

### Refactoring Strategy

**Unified compiler with a `mode` parameter** (`'standard' | 'compressed'`):

```typescript
function compileCodec(
    schema: Schema,
    registry: SchemaRegistry,
    direction: 'encode' | 'decode',
    mode: 'standard' | 'compressed',
    helpers?: ...,
    internFields?: ...,
    internFn?: ...
) {
    // Shared: field categorization, bitmap setup, preamble
    // Per-mode: emit calls dispatch on (direction, mode)
    // Shared: epilogue, Function construction, .bind()
}
```

Each `emitXXX` function pair can be merged with a `direction` parameter since encode/decode are mirrors:

```typescript
function emitFixed(lines: string[], field: FieldDef, off: string, direction: 'encode' | 'decode') {
    // 'encode' → writeF64(off, 'obj.' + field.name)
    // 'decode' → 'let ' + field.name + '=' + readF64(off)
}
```

This eliminates:
- `emitDecoderFixed` + `emitEncoderFixed` → single `emitFixed`
- `emitDecoderFixedExpr` + `emitEncoderFixedAtOffset` → absorbed into `emitFixed`
- `emitDecoderVar` + `emitEncoderVar` → single `emitVar`
- `emitDecoderVarInner` + `emitEncoderVarInner` → single `emitVarInner`
- `emitDeltaArrayDecoder` + `emitDeltaArrayEncoder` → single `emitDeltaArray`
- `emitFloat64ArrayCompressedDecoder` + `emitFloat64ArrayCompressedEncoder` → single `emitFloat64ArrayCompressed`

**Estimated savings**: ~450 lines from deduplication, offset by ~50 lines for the dispatch logic.

---

## 4. Identical Field Sort Comparator — Repeated 4 Times

Lines 1568-1578, 1991-2001, and field sorting in `compileDecoder`/`compileEncoder` all use the same comparator:

```typescript
fields.sort((a, b) => {
    if (a.fixedSize > 0 && b.fixedSize === 0) return -1;
    if (a.fixedSize === 0 && b.fixedSize > 0) return 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
});
```

Extract to module-level `sortFields`:

```typescript
function sortFields(a: FieldDef, b: FieldDef): number {
    if (a.fixedSize > 0 && b.fixedSize === 0) return -1;
    if (a.fixedSize === 0 && b.fixedSize > 0) return 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
```

---

## 5. `_nullIndex` Mutation — Repeated 4 Times

Lines 530-536, 669-675, 1225-1231, 1296-1302 all contain:

```typescript
for (let i = 0, n = schema.fields.length; i < n; i++) {
    let field = schema.fields[i]!;
    if (typeof field.type === 'object' && field.type.kind === 'nullable') {
        (field as FieldDef & { _nullIndex?: number })._nullIndex = nullIndex++;
    }
}
```

This should be a function, called once during `compileSchema`, with `_nullIndex` stored as a proper field in `FieldDef` (not a type-assertion hack).

---

## 6. Schema Creation Duplication

`inferSchema` (1536-1596) and `createSchemaStore.get` (1954-2024) both build a `Schema` object from field definitions with nearly identical logic:
1. Create `FieldDef[]`
2. Sort fixed-first
3. `computeFieldOffsets`
4. Count nullables
5. Construct `Schema` object literal

**Refactoring**: Extract a `createSchema(fields, hash, id, nullableCount)` factory that handles steps 2-5. Both callers reduce to "build fields, call factory."

---

## 7. `buildComputeSize` — Redundant with Codegen

`buildComputeSize` (257-341) generates a `new Function` that computes the byte size of an object for the fast-path pre-allocation in `encodeValue`. It duplicates knowledge of every field type's wire size that already exists in the encoder codegen.

### Refactoring
Emit the size-computation logic as part of the encoder compilation. The compiled encoder could return both `pos` (current) AND set a side-channel variable with the total size, or `computeSize` could be a thin wrapper that runs the encoder in "measure mode" (write to a null buffer). However, the current approach avoids the encoder overhead for size computation, so this may not be worth changing if the fast path matters.

**Verdict**: Keep, but extract the shared type→size lookup into `emitSizeExpr(type, val)` to avoid duplicating `FIELD_SIZES` knowledge.

---

## 8. `typed-array-codec.ts` — Inline Opportunity

### Current State (122 LOC)
- Only imported by `sbc.ts` (for `encodeTypedArray`, `getTypedArrayType`) and `store.ts` (for all 4 exports)
- Contains an `instanceof` chain, constructor lookup table, 4-byte header encode/decode

### Observation
The `constructors` array and `getTypedArrayType` are a classic case where a `Map<Function, number>` would be cleaner:

```typescript
let typeMap = new Map<Function, number>([
    [Float32Array, 0], [Float64Array, 1], [Int8Array, 2],
    [Int16Array, 3], [Int32Array, 4], [Uint8Array, 5],
    [Uint8ClampedArray, 6], [Uint16Array, 7], [Uint32Array, 8],
    [BigInt64Array, 9], [BigUint64Array, 10],
]);

function getTypedArrayType(value: unknown): number {
    return typeMap.get((value as { constructor: Function }).constructor) ?? -1;
}
```

This replaces 11 `instanceof` checks with a single `Map.get()`. The constructor array can derive from the same map.

**LOC savings**: ~30 lines. Could reduce to ~70 LOC.

---

## 9. `decodeFieldDefs` / `encodeFieldDefs` (1869-1934) — Simplification

Both create `new TextDecoder()` / `new TextEncoder()` per call instead of reusing the module-level instances. `encodeFieldDefs` accumulates `parts` array then does a second pass — this can be single-pass with pre-computed total size using `TextEncoder.encodeInto`.

---

## 10. `lookupSchema` 3-Tier Lookup (1740-1843) — Simplification

The function has inline-expanded verification logic that duplicates `verifySchemaFields`. The "Tier 2" monomorphic path (1753-1803) manually loops fields + checks key count, which is exactly what `verifySchemaFields` does plus a `Object.keys(obj).length` check.

Consolidate into:

```typescript
function matchSchema(obj: Record<string, unknown>, schema: Schema): boolean {
    let keys = Object.keys(obj);
    if (keys.length !== schema.fields.length) {
        // Edge case: explicit undefined keys
        let defined = 0;
        for (let i = 0, n = keys.length; i < n; i++) {
            if (obj[keys[i]!] !== undefined) defined++;
        }
        if (defined !== schema.fields.length) return false;
    }
    return verifySchemaFields(obj, schema);
}
```

---

## Summary: LOC Reduction Estimate

| Area | Current LOC | Estimated After | Savings |
|------|-------------|-----------------|---------|
| Buffer abstraction | 88 | 30 | 58 |
| CodegenDriver | 77 | 35 | 42 |
| Compile + emit functions (4 pipelines → 1) | ~1050 | ~550 | 500 |
| Repeated patterns (_nullIndex, sort, schema factory) | ~80 | ~25 | 55 |
| lookupSchema consolidation | 104 | 70 | 34 |
| decodeFieldDefs/encodeFieldDefs | 66 | 45 | 21 |
| typed-array-codec.ts | 122 | 70 | 52 |
| **Total** | **~2773** | **~1475-1600** | **~1100-1200** |

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Drop Node Buffer fast-paths | Low-medium: possible regression in non-compiled paths | Bench before/after; compiled codegen is unaffected |
| Unified compile function | Low: structural refactor, output unchanged | Output string comparison: compiled functions should produce identical code strings |
| Merge emit pairs | Low: mechanical deduplication | Existing test suite (978 LOC) + compression tests (437 LOC) cover all field types |
| TypedArray Map lookup | Very low: faster than instanceof chain | Direct replacement, same semantics |

---

## Recommended Approach

1. **Phase 1**: Mechanical deduplication — extract `sortFields`, `assignNullIndices`, `createSchemaObject` helpers. Zero behavior change. ~90 LOC saved.
2. **Phase 2**: Merge emit function pairs into direction-parameterized versions. ~200 LOC saved.
3. **Phase 3**: Unify the 4 compile functions into `compileCodec(schema, registry, direction, mode, ...)`. ~250 LOC saved.
4. **Phase 4**: Consolidate buffer abstraction. Drop `isNode` ternaries for hand-written paths, keep codegen drivers for compiled paths. ~60 LOC saved.
5. **Phase 5**: Simplify `typed-array-codec.ts` with Map-based lookup. ~50 LOC saved.

Each phase is independently committable with full test validation between steps.
