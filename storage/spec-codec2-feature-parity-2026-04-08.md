# Spec: Codec2 Feature Parity with SBC

**Date**: 2026-04-08
**Scope**: Implement missing SBC features in codec2 without regressing performance on existing paths
**Files**: `src/codec2/index.ts`, `src/codec2/codegen.ts`, `src/codec2/platform.ts`
**Validation**: `pnpm test`, `npx tsx tests/bench/codec2-standalone.ts`

---

## Guiding Principles

1. **Wire compatibility**: New tags extend the existing 0-14 range. Existing wire format unchanged
2. **Zero-cost when unused**: Features like compression and intern pools add no overhead when not enabled
3. **Same API surface as SBC where practical**: `encode`, `decode`, `decodeAt`, `extractField`, `computeSize`
4. **No external dependencies**: No DB layer. Schema store and intern pool are in-memory only (no persistence). Consumers can serialize/deserialize the registry for transport

---

## Phase 1: New Value Types

### 1.1 Map Support (wire tag 15)

**Wire format**:
```
[15][u32 count LE][key0 value0 key1 value1 ...]
```
Count is the number of entries (not key+value pairs). Each key and value is a tagged SBC element (recursive `encodeSbc`/`decodeSbc`).

**Encode** (`encodeSbc`, typeof === 'object', `value instanceof Map`):
- Check before `Array.isArray` in the object type branch
- Write tag 15, u32 count, then for each entry: `encodeSbc(key)`, `encodeSbc(value)`
- Max count: `MAX_ARRAY_COUNT` (2^20)

**Decode** (`decodeSbc`, case 15):
- Read u32 count, guard against `MAX_ARRAY_COUNT`
- For each entry: decode key via `decodeSbc`, decode value via `decodeSbc`
- Return `new Map(entries)`

**`decodeTagEnd`** (case 15): read u32 count, walk `2 * count` tagged elements.

**`inferType`**: `value instanceof Map` returns `'map'`. Add before `Array.isArray`.

**Schema field type `'map'`**: Compiled encoder calls `_enc(val, b, p)` (generic). Compiled decoder calls `_dte` + `_dec` (same as `mixed`).

### 1.2 Set Support (wire tag 16)

**Wire format**:
```
[16][u32 count LE][elem0 elem1 ...]
```

Same pattern as Map but single elements. Decoded as `new Set(elements)`.

**Encode/decode**: Mirror the Map implementation with single elements instead of key-value pairs.

**`inferType`**: `value instanceof Set` returns `'set'`. Add before `Array.isArray`.

**Schema field type `'set'`**: Same codegen treatment as `'map'` — generic encode/decode via helpers.

### 1.3 Typed Array Support (wire tag 17)

**Wire format**:
```
[17][u8 typeId][u32 byteLen LE][raw bytes...]
```

| typeId | Constructor |
|--------|-------------|
| 0 | Float32Array |
| 1 | Float64Array |
| 2 | Int8Array |
| 3 | Int16Array |
| 4 | Int32Array |
| 5 | Uint8Array |
| 6 | Uint8ClampedArray |
| 7 | Uint16Array |
| 8 | Uint32Array |
| 9 | BigInt64Array |
| 10 | BigUint64Array |

Note: Plain `Uint8Array` continues to use tag 6 (bytes) for backward compatibility. Tag 17 is used for all other typed arrays and optionally for `Uint8Array` when the caller explicitly wants typed-array round-trip fidelity.

**Encode** (`encodeSbc`, typeof === 'object'):
- Check `ArrayBuffer.isView(value) && !(value instanceof Uint8Array) && !(value instanceof DataView)`
- Write tag 17, typeId byte, u32 byteLength, raw bytes via `buf.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), pos)`

**Decode** (`decodeSbc`, case 17):
- Read typeId, u32 byteLen
- Validate byteLen is divisible by `BYTES_PER_ELEMENT` for the constructor
- Copy bytes into a new aligned buffer (isolation from encode buffer)
- Return `new Ctor(aligned.buffer, 0, byteLen / BYTES_PER_ELEMENT)`

**`decodeTagEnd`** (case 17): `offset + 1 + 1 + 4 + byteLen` (tag + typeId + u32 + data).

**`inferType`**: Returns `'typedarray'`. Compiled encoder/decoder uses generic path.

**Platform**: Add typed array constructor lookup table to `platform.ts`:
```typescript
let TYPED_ARRAY_CTORS: (new (buf: ArrayBuffer, off: number, len: number) => ArrayBufferView)[] = [
    Float32Array, Float64Array, Int8Array, Int16Array, Int32Array,
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
    BigInt64Array, BigUint64Array,
];

let TYPED_ARRAY_IDS: Map<Function, number>; // constructor -> typeId
```

---

## Phase 2: Nullable Fields

### 2.1 Schema-Level Nullable Tracking

**`FieldDef` extension** (codegen.ts):
```typescript
interface FieldDef {
    fixedSize: number;
    name: string;
    nullable: boolean;      // NEW
    nullIndex: number;      // NEW — bit position in null bitmap (-1 if not nullable)
    offset: number;
    type: string;           // inner type for nullable fields (e.g., 'string', not 'nullable<string>')
}
```

**`Schema` extension** (codegen.ts):
```typescript
interface Schema {
    // ... existing fields ...
    nullableCount: number;  // NEW — 0-16
    bitmapBytes: number;    // NEW — ceil(nullableCount / 8), 0-2
}
```

### 2.2 Type Inference

`inferType` changes:
- `null` and `undefined` at object field level → field type is `nullable<mixed>` (inferred as `'mixed'` with `nullable: true`)
- When a field that was previously typed as `'string'` is encountered as `null` in a different object of the same shape → the schema must handle this. Since codec2 uses shape hashing that includes types, a field that is sometimes null and sometimes string would create two different schemas

**Pragmatic approach**: Do NOT infer nullable from values. Instead, nullable is opt-in via a schema definition API (Phase 5). For auto-inferred schemas, `null`/`undefined` field values continue to use `type: 'mixed'` with generic encoding (tag 0 in the stream).

### 2.3 Wire Format

Null bitmap bytes are prepended to the field data inside the object payload:
```
[8][u32 hash][u32 payloadLen][bitmapByte0][bitmapByte1?][field data...]
```

- Bit set (1) = field is present (non-null)
- Bit clear (0) = field is null (no data written)
- Bitmap bytes count: `ceil(nullableCount / 8)`, max 2 (16 nullable fields max)

### 2.4 Codegen Changes

**Encoder** (`compileEncoder`):
1. If `schema.nullableCount > 0`: emit `let _bm=0,_bp=p;p+=${schema.bitmapBytes};`
2. For each nullable field: `if(o[key]!=null){_bm|=${1 << field.nullIndex};...encode inner...}`
3. After all fields: emit bitmap write `b[_bp]=_bm&0xFF;` (+ second byte if needed)

**Decoder** (`compileDecoder`):
1. If `schema.nullableCount > 0`: emit `let _bm=b[p];` (+ `|b[p+1]<<8` if 2 bytes), `p+=${schema.bitmapBytes};`
2. For each nullable field: `let f${i}=null;if(_bm&${1 << field.nullIndex}){...decode inner...}`

### 2.5 Limit

Max 16 nullable fields per schema. Throw `Error('Codec2: max 16 nullable fields per schema')` if exceeded.

---

## Phase 3: Compression

### 3.1 Compressed Object Tag (wire tag 18)

```
[18][u32 hash][u32 payloadLen][compressed payload...]
```

Compression is opt-in per codec instance: `createCodec({ compress: true })`.

### 3.2 Schema Extension

```typescript
interface Schema {
    // ... existing fields ...
    compressible: boolean;          // NEW — has bool/int/float64 fields
    compressedEncodeFn: (...) | null;
    compressedDecodeFn: (...) | null;
    boolFields: number[];           // NEW — indices of boolean fields
    intFields: number[];            // NEW — indices of varint-eligible int fields
    float64Fields: number[];        // NEW — indices of float64 fields
    compFixedSize: number;          // NEW — size of non-varint fixed fields (bigint, date, uint8, int8)
}
```

### 3.3 Varint/Zigzag Primitives

Add to `platform.ts`:
```typescript
function writeVarint(buf: Uint8Array, pos: number, value: number): number;
function readVarint(buf: Uint8Array, pos: number): [number, number]; // [value, newPos]
function writeZigzag(buf: Uint8Array, pos: number, value: number): number;
function readZigzag(buf: Uint8Array, pos: number): [number, number];
```

Zigzag encoding: `(n << 1) ^ (n >> 31)` (encode), `(n >>> 1) ^ -(n & 1)` (decode).

### 3.4 Compressed Payload Layout

```
[null bitmap (0-2 bytes)]
[bool bitmap (0-2 bytes)]
[otherFixed fields (bigint, date, uint8, int8) at precomputed offsets]
--- variable pointer (vp) starts here ---
[varint/zigzag integers (int16, int32, uint16, uint32)]
[adaptive float64s (flag byte + varint or raw f64)]
[delta-coded int arrays]
[conditional-delta float64 arrays]
[variable fields (strings, bytes, objects, generic arrays)]
```

### 3.5 Adaptive Float64

Per float64 field:
```
flag=0: value is integer → zigzag-varint (1-5 bytes)
flag=1: value is not integer → raw 8-byte f64
```

### 3.6 Delta-Coded Integer Arrays

For `array<int32>`, `array<uint32>`, etc.:
```
[u32 count][varint first][zigzag delta[1]][zigzag delta[2]]...
```

### 3.7 Conditional-Delta Float64 Arrays

```
[u32 count][flag]
flag=0: all integers → [varint first][zigzag deltas...]
flag=1: raw → [f64 f64 f64 ...]
```

### 3.8 Encode/Decode Path Selection

In `encode()`: if `compress && schema.compressible && schema.compressedEncodeFn`, use tag 18 + compressed encoder. Otherwise tag 8 + normal encoder.

In `decode()`/`decodeSbc()`: tag 18 dispatches to `schema.compressedDecodeFn`. Tag 8 uses normal decoder. Both are valid in the same stream.

---

## Phase 4: API Extensions

### 4.1 `decodeAt(buffer, offset): unknown`

Decode a single tagged value starting at `offset` in `buffer`. Unlike `decode()`, does not assume the value starts at offset 0.

```typescript
function decodeAt(buffer: Uint8Array, offset: number): unknown {
    let tag = buffer[offset]!;

    if (tag === 8 || tag === 18) {
        let dataLen = readU32(buffer, offset + 5);
        return decodeSbc(buffer, offset, 9 + dataLen, 0);
    }

    let end = decodeTagEnd(buffer, offset, 0);
    return decodeSbc(buffer, offset, end - offset, 0);
}
```

### 4.2 `extractField(buffer, fieldName): unknown`

Extract a single field from an encoded object without full decode. Only works on tag 8 (uncompressed objects).

**Schema extension**:
```typescript
interface Schema {
    // ... existing fields ...
    fieldExtractors: Map<string, (buf: Uint8Array, pos: number) => unknown> | null;
}
```

**Fixed-size field extraction** (O(1)):
- For fields with `fixedSize > 0`: read directly at `9 + bitmapBytes + field.offset`
- Compiled per-field: `return readUint8(buf, pos + offset)` etc.

**Variable-size field extraction** (O(n) scan):
- Start at `9 + bitmapBytes + schema.fixedSize`
- For each preceding variable field: read u32 length, skip `4 + length` bytes
- Read the target field at the scanned position
- If a preceding field is an array or object → extraction not supported for this field (return undefined)

**Nullable field extraction**:
- Read null bitmap at `buffer[9 + (nullIndex >> 3)]`
- If bit is clear → return `null`
- Otherwise proceed with fixed/variable extraction

### 4.3 `computeSize(value): number`

Pre-compute the encoded byte size of a value without encoding it. Returns -1 if size cannot be computed (mixed types, unknown nested schemas).

**Schema extension**:
```typescript
interface Schema {
    // ... existing fields ...
    computeSizeFn: ((obj: unknown) => number) | null;
}
```

**Compiled function**: `(obj) => number`
- Base: `9 + bitmapBytes + fixedSize`
- String fields: `+= 4 + byteLen(obj[key])`
- Bytes fields: `+= 4 + obj[key].length`
- Array fields (fixed element): `+= 4 + arr.length * elemSize` (u32 count header = 4 bytes for codec2 arrays)
- Nested object fields: `+= computeSize(nested)` (recursive, returns -1 on failure)
- Returns -1 for schemas containing `mixed`, `map`, `set`, or `typedarray` fields

**Usage in encode**: If `computeSizeFn` is available, call it before encoding to pre-check buffer capacity. If `needed > encodeBuf.length`, resize before encoding (avoids the retry loop).

### 4.4 Updated `createCodec` Signature

```typescript
interface CodecOptions {
    compress?: boolean;     // default: false — enable compression for compressible schemas
}

const createCodec = (options?: CodecOptions): {
    computeSize(value: unknown): number;
    decode(buffer: Uint8Array, length?: number): unknown;
    decodeAt(buffer: Uint8Array, offset: number): unknown;
    encode(value: unknown, view?: boolean): Uint8Array;
    extractField(buffer: Uint8Array, fieldName: string): unknown;
} => { ... };
```

---

## Phase 5: Schema Definition API

### 5.1 `defineSchema(fields)` — Explicit Schema Registration

Allow users to pre-register schemas with explicit types, including nullable:

```typescript
type FieldSpec = {
    name: string;
    nullable?: boolean;
    type: 'bigint' | 'boolean' | 'bytes' | 'date' | 'float64' | 'int8' | 'int16' | 'int32' | 'string' | 'uint8' | 'uint16' | 'uint32' | 'array' | 'object' | 'map' | 'set' | 'mixed';
};

// Added to codec return type:
defineSchema(fields: FieldSpec[]): number; // returns schema hash
```

This registers the schema, compiles encode/decode/extract/computeSize functions, and returns the hash. Objects matching this shape will use the pre-registered schema (with nullable support) instead of auto-inferring.

### 5.2 Nullable via defineSchema

Nullable fields are ONLY available via `defineSchema`. Auto-inferred schemas never produce nullable fields (null values are typed as `'mixed'`).

```typescript
codec.defineSchema([
    { name: 'name', type: 'string' },
    { name: 'email', type: 'string', nullable: true },
    { name: 'age', type: 'uint8', nullable: true },
]);
```

---

## Phase 6: Registry Serialization

### 6.1 `serializeRegistry(): Uint8Array`

Export the schema registry as a binary blob for transport to another codec instance (e.g., server → client).

**Wire format**:
```
[u16 schemaCount]
for each schema:
    [u32 hash][u16 fieldCount]
    for each field:
        [u16 nameByteLen][utf8 name][u16 typeByteLen][utf8 type][u8 flags]
        flags: bit 0 = nullable
```

### 6.2 `deserializeRegistry(data: Uint8Array): void`

Import schemas from a binary blob. Compiles encode/decode functions for each imported schema. Duplicate hashes (already registered) are skipped.

---

## Implementation Order

| Phase | Effort | Impact | Dependencies |
|-------|--------|--------|-------------|
| 1.1-1.2 Map/Set | Small | Medium | None |
| 1.3 Typed Arrays | Small | Low | None |
| 4.1 decodeAt | Trivial | Medium | None |
| 2 Nullable Fields | Medium | High | Phase 5 (defineSchema) |
| 5 Schema Definition API | Medium | High | None |
| 4.2 extractField | Medium | High | Phase 2 |
| 4.3 computeSize | Medium | Medium | Phase 2 |
| 3 Compression | Large | High | Phase 2, platform.ts varint |
| 6 Registry Serialization | Small | Medium | Phase 2 |
| 4.4 Updated createCodec | Trivial | — | Phase 3 |

**Recommended**: Phases 1 → 4.1 → 5 → 2 → 4.2 → 4.3 → 3 → 6

---

## Wire Tag Summary (After All Phases)

```
 0  = null/undefined
 1  = false
 2  = true
 3  = uint8
 4  = float64
 5  = string
 6  = bytes (Uint8Array)
 7  = array (generic tagged)
 8  = object (uncompressed)
 9  = bigint
10  = date
11  = int32
12  = packed uint8 array
13  = packed float64 array
14  = packed int32 array
15  = Map (u32 count + key/value pairs)
16  = Set (u32 count + elements)
17  = typed array (u8 typeId + u32 byteLen + raw)
18  = object (compressed)
```

---

## Test Plan

- [ ] Map: encode/decode round-trip, nested Maps, Map with object keys, empty Map, large Map (>1000 entries), Map count DoS guard
- [ ] Set: encode/decode round-trip, nested Sets, empty Set, Set with mixed types
- [ ] Typed arrays: round-trip for all 11 constructors, empty arrays, large arrays, alignment edge cases, byteLength validation
- [ ] decodeAt: decode from non-zero offset, decode objects/primitives/arrays, offset past end → error
- [ ] Nullable fields: defineSchema with nullable, encode null → bitmap bit clear, encode value → bitmap bit set, mixed null/non-null round-trip, max 16 nullable fields, >16 throws, extractField on nullable (null and non-null)
- [ ] extractField: fixed-size field O(1) extraction, variable-size field scanning, nullable field extraction, tag 8 only (tag 18 returns undefined), field not in schema → undefined
- [ ] computeSize: matches actual encoded size for all field types, returns -1 for mixed/map/set schemas, nested object size computation
- [ ] Compression: compressed vs uncompressed round-trip equivalence, varint edge cases (0, 1, 127, 128, max), zigzag for negative values, adaptive float64 (integer → varint, float → raw), delta-coded int arrays, conditional-delta float64 arrays, mixed compressed+uncompressed in same stream
- [ ] defineSchema: explicit schema with nullable, hash stability, duplicate defineSchema same fields → same hash, schema used for matching objects
- [ ] Registry serialization: serialize → deserialize round-trip, cross-instance decode after import, nullable fields preserved
- [ ] Performance: existing benchmarks show no regression on encode/decode for existing types
