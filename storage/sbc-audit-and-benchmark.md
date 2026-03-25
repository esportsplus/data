# SBC Audit & Proto vs SBC Benchmark

**Date**: 2026-03-25

## SBC (Schema Binary Codec) Audit

### Architecture

SBC is a runtime schema-based binary serialization codec from lmdbx-js. Key design:

- **Runtime schema inference**: Object shapes are analyzed at first encode, producing a `Schema` with compiled encode/decode functions via `new Function()`
- **FNV-1a hash** identifies schemas by field names + types
- **Wire format**: `[tag:1][hash:u32][length:u32][field_data...]` (9-byte header per object)
- **Compiled codecs**: JIT-generated JavaScript functions with Buffer.readDoubleLE/writeDoubleLE operations
- **Node.js Buffer**: Uses Buffer's native C++ bindings (readDoubleLE, utf8Write, utf8Slice)

### Type System

| SBC Type | Size | Wire Format |
|----------|------|-------------|
| boolean | 1 byte | u8 flag (or bit-packed in compressed mode) |
| int8/uint8 | 1 byte | raw byte |
| int16/uint16 | 2 bytes | LE |
| int32/uint32 | 4 bytes | LE |
| float64 | 8 bytes | LE |
| bigint | 8 bytes | i64 LE |
| date | 8 bytes | f64 LE (ms timestamp) |
| string | 4+N bytes | u32 length + UTF-8 |
| bytes | 4+N bytes | u32 length + raw |
| array | 2+N bytes | u16 count + elements |
| nullable | bitmap bit | presence tracked in bitmap |
| object | 2+N bytes | u16 length + nested SBC |

### Compression Features

- Boolean bit-packing (up to 16 booleans in 1-2 bytes)
- Varint encoding for integers
- Zigzag encoding for signed integers
- Delta encoding for integer/float64 arrays
- Auto-detect integer-only float64 arrays

### Strengths

1. **Zero-copy decode** on cache hit (no buffer allocation)
2. **Buffer-native operations** (V8-optimized readDoubleLE/utf8Slice)
3. **Schema caching** — compiled functions reused after first encounter
4. **Self-describing wire format** — hash identifies schema without external metadata
5. **Compression** reduces wire size 30-50% on integer-heavy schemas
6. **Rich type system** — nullable, arrays, nested objects, mixed arrays

### Weaknesses

1. **9-byte header overhead per object** — significant for small payloads
2. **Runtime schema inference** — first encode has O(keys) overhead
3. **Node.js dependency** — Buffer required, not portable to browsers
4. **FNV-1a collision risk** — 32-bit hash, no collision handling
5. **No compile-time type safety** — schema inferred from runtime values

---

## Proto Codec (G:/data) Summary

- **Compile-time code generation** via TypeScript compiler plugin
- **Zero runtime overhead** — encode/decode functions generated at build time
- **Protobuf-compatible** wire format (varint, length-delimited, 32/64-bit)
- **Uint8Array + DataView** — browser-compatible
- **Tag-based fields** — (fieldNumber << 3 | wireType) per field

---

## Benchmark Results

### Wire Size Comparison (bytes)

| Scenario | Proto | SBC | Delta |
|----------|------:|----:|------:|
| Simple `{ name: 'Alice' }` | 7 | 18 | +157% |
| Multi-field (3 fields) | 18 | 27 | +50% |
| Nested object | 21 | 45 | +114% |
| Array (100 numbers) | 803 | 811 | +1% |
| Large (6 fields) | 50 | 62 | +24% |

Proto is consistently smaller due to zero framing overhead. SBC's 9-byte header per object is significant for small payloads but negligible for large arrays.

### Throughput (ops/sec)

| Scenario | Proto Encode | SBC Encode | Proto Decode | SBC Decode |
|----------|------------:|----------:|------------:|----------:|
| Simple string | 3,500,731 | **4,441,217** | **8,723,896** | 6,877,223 |
| Multi-field (3) | **2,990,261** | 1,820,260 | **6,502,807** | 5,403,810 |
| Nested object | 1,189,342 | **1,251,003** | 3,120,877 | **3,718,815** |
| Array (100 nums) | **1,625,893** | 1,591,903 | 1,166,589 | **1,441,180** |
| Large (6 fields) | **1,141,247** | 944,337 | 2,907,373 | **3,617,765** |

### Analysis

**Proto wins encode** for structured objects (multi-field 1.64x, large 1.21x). Compile-time field ordering and pre-computed tags eliminate runtime decisions.

**SBC wins decode** for nested and large objects (nested 1.19x, array 1.24x, large 1.24x). Buffer's native C++ `readDoubleLE`/`utf8Slice` outperform DataView-based reads.

**Trade-offs**:
| Dimension | Proto | SBC |
|-----------|-------|-----|
| Wire size | Smaller (no header) | Larger (9-byte header/object) |
| Encode speed | Faster for structured data | Competitive for simple/nested |
| Decode speed | Faster for simple objects | Faster for complex/nested |
| Portability | Browser + Node.js | Node.js only (Buffer) |
| Schema | Compile-time (zero runtime cost) | Runtime inference (first-encode cost) |
| Flexibility | Fixed at compile time | Dynamic (any shape) |
| Compression | None | Boolean/varint/delta |
