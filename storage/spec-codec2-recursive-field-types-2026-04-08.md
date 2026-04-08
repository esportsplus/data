# Spec: Recursive Structural Field Types for codec2

**Date**: 2026-04-08
**Scope**: Add typed array elements and typed nested object references to the schema field type system
**Files**: `src/codec2/index.ts`, `src/codec2/codegen.ts`
**Validation**: `pnpm test`, `npx tsx tests/bench/codec2-standalone.ts`

---

## Motivation

codec2's current field type system is flat — `'array'` always means "generic tagged array" where every element pays for a tag byte + runtime type dispatch on both encode and decode. Similarly, `'object'` fields always go through the registry lookup path at decode time.

Structural types let the codegen emit tight, specialized loops:
- `array<uint8>` → packed byte copy, no per-element tags
- `array<string>` → varint-length + utf8 per element, no tag bytes
- `array<object>` → inline the nested schema's encode/decode, no registry lookup
- `object(hash)` → inline the known schema's functions directly

**Performance impact**: eliminates 1 tag byte + 1 switch dispatch per array element. For a 100-element `array<uint8>`, that's 100 fewer tag bytes on the wire and 100 fewer switch branches on decode.

---

## Design Principles

1. **Backward compatible**: existing `'array'` and `'object'` types keep working exactly as today (mixed/generic)
2. **Opt-in via defineSchema only**: auto-inferred schemas never produce structural types — they continue to use `'array'` and `'object'`
3. **Wire format change for typed arrays**: typed array fields use a different encoding than generic arrays (no per-element tags)
4. **Mixed arrays remain first-class**: `'array'` = mixed, `array<T>` = homogeneous

---

## Field Type Grammar

Current:
```
FieldType = 'array' | 'bigint' | 'boolean' | 'bytes' | 'date' | 'float64'
          | 'int8' | 'int16' | 'int32' | 'map' | 'mixed' | 'object'
          | 'set' | 'string' | 'typedarray' | 'uint8' | 'uint16' | 'uint32'
```

Proposed:
```
FieldType = PrimitiveType | ContainerType

PrimitiveType = 'bigint' | 'boolean' | 'bytes' | 'date' | 'float64'
              | 'int8' | 'int16' | 'int32' | 'map' | 'mixed' | 'set'
              | 'string' | 'typedarray' | 'uint8' | 'uint16' | 'uint32'

ContainerType = 'array'                    // mixed array (existing behavior)
              | 'array<' FieldType '>'      // typed array — homogeneous elements
              | 'object'                    // generic object (existing behavior)
              | 'object(' hash ')'          // typed object — known schema reference
```

Examples:
```
'array'                    — mixed array, generic tagged encode/decode
'array<uint8>'             — homogeneous uint8 array, packed encoding
'array<string>'            — homogeneous string array, no tag bytes
'array<float64>'           — homogeneous float64 array, packed 8-byte encoding
'array<object>'            — array of objects, each goes through registry lookup
'array<array<uint8>>'      — nested: array of uint8 arrays
'object'                   — generic object, registry lookup at decode
'object(3456789012)'       — typed object, schema hash known at compile time
```

---

## Public API Changes

### `defineSchema` — Extended FieldSpec

```typescript
type FieldSpec = {
    name: string;
    nullable?: boolean;
    type: string;   // now accepts structural types like 'array<uint8>', 'object(hash)'
};
```

Examples:
```typescript
// Register inner schema first
let addressHash = codec.defineSchema([
    { name: 'city', type: 'string' },
    { name: 'zip', type: 'string' },
]);

// Register outer schema with typed references
codec.defineSchema([
    { name: 'name', type: 'string' },
    { name: 'address', type: `object(${addressHash})` },
    { name: 'scores', type: 'array<float64>' },
    { name: 'tags', type: 'array<string>' },
    { name: 'friends', type: `array<object(${addressHash})>` },
    { name: 'metadata', type: 'array' },  // mixed — keep generic path
]);
```

---

## Type Parsing

### `parseFieldType(type: string): ParsedType`

```typescript
type ParsedType = {
    base: string;           // 'array', 'object', or a primitive type
    elementType?: ParsedType;  // for 'array<T>'
    hash?: number;          // for 'object(hash)'
};
```

Parsing rules:
1. If `type` starts with `'array<'` and ends with `'>'`: extract inner type string, recursively parse
2. If `type` starts with `'object('` and ends with `')'`: extract hash number
3. Otherwise: literal type string (must be in the PrimitiveType set or `'array'` or `'object'`)

Validation:
- `array<>` with empty inner → error
- `object(NaN)` or non-numeric hash → error
- `object(hash)` where hash is not registered → error at compile time
- Unknown base type → error

This function is only called during `defineSchema` / `compileSchema` — never on the hot path.

---

## Wire Format for Typed Arrays

### Current (generic `'array'`):
```
[flag:u8][count:u32 LE][tagged_elem0][tagged_elem1]...
```
Flag 0 = generic tagged. Flags 1/2/3 = packed numeric (auto-detected at runtime).

### New (typed `'array<T>'`):

**Fixed-size element types** (`uint8`, `int8`, `uint16`, `int16`, `uint32`, `int32`, `float64`, `bigint`, `date`, `boolean`):
```
[count:varint][elem0][elem1]...
```
No flag byte. No per-element tags. Elements are raw fixed-width values at their natural size. Count uses varint (consistent with exp 13).

| Element Type | Bytes per Element |
|---|---|
| boolean | 1 |
| uint8, int8 | 1 |
| uint16, int16 | 2 |
| uint32, int32 | 4 |
| float64, date | 8 |
| bigint | 8 |

**Variable-size element types** (`string`, `bytes`):
```
[count:varint][varint_len0][data0][varint_len1][data1]...
```
No flag byte. No per-element tags. Each element is varint-length-prefixed.

**Container element types** (`array`, `array<T>`, `object`, `object(hash)`, `map`, `set`, `mixed`, `typedarray`):
```
[count:varint][tagged_elem0][tagged_elem1]...
```
Falls back to tagged encoding per element (same as generic `'array'` flag=0 but with varint count and no flag byte).

Exception: `array<object(hash)>` — if the inner schema is known, each element is encoded/decoded using the schema's compiled functions directly (no tag byte, no hash header, just the raw field data preceded by a varint payload length):
```
[count:varint][varint_payloadLen0][fields0][varint_payloadLen1][fields1]...
```
The payload length prefix is needed so the decoder can skip elements on error or for future partial-decode support.

---

## Wire Format for Typed Objects

### Current (generic `'object'`):
Compiled encoder writes fields, wrapped in `[tag:8][hash:u32][dataLen:u32][fields...]`.

### New (`'object(hash)'`):
When the parent schema knows the nested object's hash at compile time, the codegen can:
- **Encode**: call the nested schema's `encodeFn` directly (skip `encodeObj` dispatch + WeakMap lookup + hash/tag write). Wire: `[varint dataLen][fields...]` — no tag byte, no hash (the parent schema already knows it).
- **Decode**: call the nested schema's `decodeFn` directly (skip tag dispatch + registry lookup). Read varint dataLen, call decodeFn at current position.

This saves 9 bytes per nested object (1 tag + 4 hash + 4 dataLen → varint dataLen only).

**Fallback**: if the nested schema is not yet compiled when the parent compiles, fall back to the generic `'object'` path (encodeObj/decodeSbc). This handles circular or forward references gracefully.

---

## Codegen Changes

### FieldDef Extension

```typescript
interface FieldDef {
    // ... existing fields ...
    elementType?: ParsedType;   // NEW — for array<T>
    refHash?: number;           // NEW — for object(hash)
}
```

### compileEncoder — Array Field

Current: always emits the packed-numeric-detection + generic tagged loop.

New dispatch based on `field.elementType`:

```
if no elementType (plain 'array'):
    existing code (flag byte + runtime numeric detection + generic tagged)

if elementType is fixed-size primitive:
    emit: varint count + tight loop writing raw bytes (no tags, no flag)

if elementType is 'string' or 'bytes':
    emit: varint count + tight loop with varint length prefix per element

if elementType is 'object(hash)':
    emit: varint count + per-element [varint dataLen][encodeFn(elem)]

otherwise (map, set, mixed, typedarray, nested containers):
    emit: varint count + tagged elements (like generic flag=0 but varint count)
```

### compileDecoder — Array Field

Mirror of encoder:

```
if no elementType:
    existing code (read flag + dispatch)

if elementType is fixed-size primitive:
    emit: read varint count + tight loop reading raw values

if elementType is 'string' or 'bytes':
    emit: read varint count + per-element varint len + read

if elementType is 'object(hash)':
    emit: read varint count + per-element [read varint dataLen][decodeFn(buf, p)]

otherwise:
    emit: read varint count + tagged decode per element
```

### compileEncoder — Object Field

Current: always calls `_encObj(val, b, p)`.

New: if `field.refHash` is set and the referenced schema is compiled:
```
emit: let end = _refEnc{hash}(val, b, p + maxVarintBytes);
      write varint(end - p - maxVarintBytes) at p;
      // shift data if varint shorter than max (or reserve exact bytes)
```

**Simpler approach**: since most payloads are < 128 bytes (1-byte varint), reserve 1 byte for the length. If the actual payload exceeds 127 bytes, fall back to encodeObj (with tag+hash+u32 header). This avoids the shift problem:

```
emit:
    let _lp = p; p += 1;                        // reserve 1 byte for varint len
    let _end = _refEnc{hash}(val, b, p);
    let _dl = _end - p;
    if (_dl < 128) { b[_lp] = _dl; }            // fast path: 1-byte varint
    else { p = _encObj(val, b, _lp); _end = p; } // fallback: full header
```

### compileDecoder — Object Field

Current: inline tag-8 fast path + fallback to decodeSbc.

New: if `field.refHash` is set and referenced schema is compiled:
```
emit:
    let _dl = b[p];
    if (_dl < 128) {
        p += 1;
        f{i} = _refDec{hash}(b, p, _d + 1);
        p += _dl;
    } else {
        // fallback: expect full tag-8/18 header
        ...existing inline decode...
    }
```

### Binding Referenced Schema Functions

For each unique `refHash` in a schema's fields, the compiled function needs the referenced schema's encode/decode functions bound as parameters.

At compile time:
1. Collect all unique refHash values from fields
2. For each, look up the schema in the registry
3. Bind `schema.encodeFn` and `schema.decodeFn` as additional parameters to the generated function

Parameter naming: `_refEnc{i}`, `_refDec{i}` where `i` is an index into the unique refHash list.

If a referenced schema is not yet compiled (forward reference), skip the optimization for that field — use generic path.

---

## computeSize Changes

For typed arrays with fixed-size elements:
```
varintSize(count) + count * elementSize
```

For typed arrays with string elements:
```
varintSize(count) + sum(varintSize(byteLen(elem)) + byteLen(elem))
```

For `object(hash)` fields:
```
1 + referencedSchema.computeSize(value)   // 1 byte for varint len (assumes < 128)
// or -1 if referenced schema can't compute size
```

---

## extractField Changes

For typed array fields in the variable-size scan path:
- Read varint count
- For fixed-size element types: skip `count * elementSize` bytes
- For string/bytes: skip count elements each with varint len + data
- For tagged/container: fall through to decodeTagEnd loop (existing)

For `object(hash)` fields:
- Read varint dataLen, skip dataLen bytes (or fallback to existing tag-8 skip if full header)

---

## serializeRegistry / deserializeRegistry

The type string (e.g., `'array<uint8>'`, `'object(3456789012)'`) is stored as-is in the registry serialization format. The existing `[u16 typeLen][utf8 type]` field already supports arbitrary-length type strings. No format change needed.

On deserialize, `defineSchema` is called which parses the structural types and compiles specialized codegen.

---

## Schema Hash

The structural type string is included verbatim in the hash computation. This means:
- `'array'` and `'array<uint8>'` produce different hashes (correct — different wire formats)
- `'object'` and `'object(123)'` produce different hashes (correct)
- A schema defined with `'array<uint8>'` will NOT match auto-inferred objects with `'array'` fields (correct — prevents wire format mismatch)

---

## Auto-Inference Behavior (Unchanged)

`inferType` continues to return flat types:
- Arrays → `'array'` (never `'array<T>'`)
- Objects → `'object'` (never `'object(hash)'`)

Structural types are exclusively opt-in via `defineSchema`. This means:
- Existing code works unchanged
- Performance benefits require explicit schema definition
- No risk of accidentally generating incompatible wire formats

---

## Implementation Order

| Step | Description | Effort |
|---|---|---|
| 1 | Add `parseFieldType` function + tests | Small |
| 2 | Extend `FieldDef` with `elementType` / `refHash` | Small |
| 3 | Update `defineSchema` to parse structural types and populate FieldDef | Small |
| 4 | Codegen: typed array encode (fixed-size elements) | Medium |
| 5 | Codegen: typed array decode (fixed-size elements) | Medium |
| 6 | Codegen: typed array encode/decode (string/bytes elements) | Medium |
| 7 | Codegen: typed array encode/decode (object(hash) elements) | Medium |
| 8 | Codegen: object(hash) field encode/decode | Medium |
| 9 | Update extractField for typed array/object skip | Small |
| 10 | Update computeSize for typed arrays/objects | Small |
| 11 | Update compressed encoder/decoder for typed fields | Medium |
| 12 | End-to-end tests + benchmark | Medium |

---

## Test Plan

- [ ] `parseFieldType`: all valid forms, nested (`array<array<uint8>>`), invalid syntax errors
- [ ] `defineSchema` with `array<uint8>`: round-trip, wire size = varint(count) + count (no tags)
- [ ] `defineSchema` with `array<string>`: round-trip, varint length per element
- [ ] `defineSchema` with `array<float64>`: round-trip, 8 bytes per element
- [ ] `defineSchema` with `array<object(hash)>`: round-trip, inline schema encode/decode
- [ ] `defineSchema` with `object(hash)`: round-trip, no tag/hash header in wire
- [ ] Mixed: schema with both `'array'` and `'array<uint8>'` fields — each uses correct path
- [ ] Empty typed arrays: `[]` round-trips correctly
- [ ] Large typed arrays: 10000 elements, verify wire size savings
- [ ] Nested structural types: `array<array<string>>` round-trip
- [ ] Forward reference: `object(hash)` where hash is defined after parent — graceful fallback
- [ ] `extractField` on typed array fields: correctly skips
- [ ] `computeSize` on typed array fields: returns correct size
- [ ] Compressed mode with typed fields: round-trip equivalence
- [ ] Registry serialization: structural type strings preserved through serialize/deserialize
- [ ] Performance: benchmark typed arrays vs generic arrays — measure tag overhead elimination
- [ ] Wire size comparison: `array<uint8>` 100 elements = varint(100) + 100 = 101 bytes vs generic = 1 + 4 + 200 = 205 bytes (tag+count+per-element-tag-pairs)

---

## Expected Wire Size Savings

| Scenario | Generic `'array'` | Typed `array<T>` | Savings |
|---|---|---|---|
| 100 × uint8 | 1 flag + 4 count + 100×(1 tag + 1 val) = 205B | 1 varint + 100×1 = 101B | **-51%** |
| 100 × int32 | 1 flag + 4 count + 100×(1 tag + 4 val) = 505B | 1 varint + 100×4 = 401B | **-21%** |
| 100 × float64 | 1 flag + 4 count + 100×(1 tag + 8 val) = 905B | 1 varint + 100×8 = 801B | **-11%** |
| 100 × string("hi") | 1 flag + 4 count + 100×(1 tag + 4 len + 2 val) = 705B | 1 varint + 100×(1 len + 2 val) = 301B | **-57%** |
| Nested object (50B payload) | 1 tag + 4 hash + 4 dataLen + 50 = 59B | 1 varint + 50 = 51B | **-14%** |

Note: Generic `'array'` with runtime-detected packed numerics (flags 1/2/3) already achieves parity with typed arrays for homogeneous uint8/int32/float64. The main wins from typed arrays are:
1. **String/bytes arrays** — no per-element tag byte (huge savings)
2. **Object arrays** — no per-element tag+hash+dataLen header
3. **Mixed-type schemas** — arrays that happen to be homogeneous but contain non-numeric types
4. **Compile-time guarantee** — no runtime type sniffing loop on encode
