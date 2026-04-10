// Codec2 — High-performance binary codec
// JIT-compiled per-shape encode/decode, zero per-field branching at runtime

import { FIELD_NAME_RE, FIELD_SIZES, MAX_ARRAY_COUNT, MAX_SCHEMA_COUNT } from './constants';
import { compileSchema } from './codegen';
import { _vr, allocBuf, allocUnsafe, byteLen, copyBuf, isNode, readBI64, readF64, readStr, readVarint, TYPED_ARRAY_BPE, TYPED_ARRAY_CTORS, TYPED_ARRAY_IDS, writeBI64, writeF64, writeUtf8 } from './platform';
import { computeNameHash, computeShapeHash, inferAndRegister, inferType, parseFieldType, readFixedField, varintSize } from './schema';

import type { CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, SchemaRegistry } from './types';
import type { FieldDef, Schema, SbcHelpers } from './codegen';

import cache from './cache';


// Tags:
// 0 = null/undefined
// 1 = false, 2 = true
// 3 = uint8 (1 byte)
// 4 = float64 (8 bytes)
// 5 = string (u32 len + utf8)
// 6 = bytes (u32 len + raw)
// 7 = array (u32 count + tagged elements)
// 8 = object (u32 hash + u32 len + compiled fields)
// 9 = bigint (8 bytes)
// 10 = date (f64)
// 11 = int32 (4 bytes)
// 12 = packed uint8 array (u32 count + raw bytes)
// 13 = packed float64 array (u32 count + raw f64s)
// 14 = packed int32 array (u32 count + raw i32s)
// 15 = map (u32 count + key/value pairs)
// 16 = set (u32 count + elements)
// 17 = typed array (u8 typeId + u32 byteLen + raw bytes)

const codec = (options?: CodecOptions): { computeSize(value: unknown): number; decode(buffer: Uint8Array, lengthOrOptions?: number | DecodeOptions): unknown; decodeAt(buffer: Uint8Array, offset: number): unknown; defineSchema(fields: FieldSpec[]): number; deserializeRegistry(data: Uint8Array): void; encode(value: unknown, viewOrOptions?: boolean | EncodeOptions): Uint8Array; extractField(buffer: Uint8Array, fieldName: string): unknown; serializeRegistry(): Uint8Array } => {
    let compress = options?.compress ?? false,
        encodeBuf = allocBuf(65536),
        registry: SchemaRegistry = {
            nextId: 1,
            schemas: new Map(),
        };

    let store = options?.store ?? null;

    // Multi-schema cache — handles nested objects without breaking
    let cacheCounts: number[] = [0, 0, 0, 0],
        cacheFields: (FieldDef[] | null)[] = [null, null, null, null],
        cacheIdx = 0,
        cacheSchemas: (Schema | null)[] = [null, null, null, null],
        typedSchemaFieldCounts = new Set<number>(),
        typedSchemas = new Map<number, Schema>(),  // nameHash → schema for defineSchema with structural types
        weakCache = new WeakMap<object, Schema>();

    function setCache(schema: Schema, obj: object): void {
        cacheSchemas[cacheIdx] = schema;
        cacheFields[cacheIdx] = schema.fields;
        cacheCounts[cacheIdx] = schema.fields.length;
        cacheIdx = (cacheIdx + 1) & 3;
        weakCache.set(obj, schema);
    }

    function resolveSchemaFromCacheOrStore(hash: number): Schema | null {
        let stored = cache.get(hash);

        if (!stored && store) {
            stored = store.get(hash);

            if (stored) {
                cache.set(hash, stored);
            }
        }

        if (stored) {
            defineSchema(stored.fields);

            return registry.schemas.get(hash) ?? null;
        }

        return null;
    }

    // Decode fast path: cache last-used schema + fn to avoid Map lookup + property access
    let lastDecodeFn: ((buf: Uint8Array, pos: number, depth: number) => unknown) | null = null,
        lastDecodeHash = 0,
        lastDecodeSchema: Schema | null = null;

    // Specialized object encoder — skips typeof/instanceof checks for known-object fields
    function encodeObj(obj: Record<string, unknown>, buf: Uint8Array, pos: number): number {
        let schema = weakCache.get(obj) ?? null;

        if (!schema) {
            schema = matchSchema(obj);

            if (!schema) {
                schema = inferAndRegister(obj, registry, helpers, store);
            }

            setCache(schema, obj);
        }

        let end: number,
            h = schema.hash,
            useCompressed = compress && schema.compressible && schema.compressedEncodeFn;

        if (useCompressed) {
            buf[pos] = 18;
            end = schema.compressedEncodeFn!(obj, buf, pos + 9);
        }
        else {
            buf[pos] = 8;
            end = schema.encodeFn!(obj, buf, pos + 9);
        }

        let dataLen = end - pos - 9;

        buf[pos + 1] = h & 0xFF;
        buf[pos + 2] = (h >>> 8) & 0xFF;
        buf[pos + 3] = (h >>> 16) & 0xFF;
        buf[pos + 4] = (h >>> 24) & 0xFF;
        buf[pos + 5] = dataLen & 0xFF;
        buf[pos + 6] = (dataLen >>> 8) & 0xFF;
        buf[pos + 7] = (dataLen >>> 16) & 0xFF;
        buf[pos + 8] = (dataLen >>> 24) & 0xFF;

        return end;
    }

    let helpers: SbcHelpers = {
        decodeSbc,
        decodeTagEnd,
        encodeObj,
        encodeSbc,
        registry: registry.schemas,
    };


    function decodeSbc(buf: Uint8Array, offset: number, len: number, depth: number): unknown {
        if (depth > 64) {
            throw new Error('Codec2: max decode depth exceeded');
        }

        if (len === 0) {
            return undefined;
        }

        let tag = buf[offset]!;

        switch (tag) {
            case 0: return null;
            case 1: return false;
            case 2: return true;
            case 3: return buf[offset + 1]!;

            case 4:
                return readF64.call(buf, offset + 1);

            case 5: {
                let sLen = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (offset + 5 + sLen > buf.length) {
                    throw new Error('Codec2: truncated string at offset ' + offset);
                }

                return readStr(buf, offset + 5, sLen);
            }

            case 6: {
                let bLen = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (offset + 5 + bLen > buf.length) {
                    throw new Error('Codec2: truncated bytes at offset ' + offset);
                }

                if (isNode) {
                    return Buffer.from(buf.subarray(offset + 5, offset + 5 + bLen));
                }

                return new Uint8Array(buf.subarray(offset + 5, offset + 5 + bLen));
            }

            case 7: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: array count ' + count + ' exceeds limit');
                }

                let arr = new Array(count),
                    p = offset + 5;

                for (let i = 0; i < count; i++) {
                    let end = decodeTagEnd(buf, p, depth + 1);

                    arr[i] = decodeSbc(buf, p, end - p, depth + 1);
                    p = end;
                }

                return arr;
            }

            case 8: {
                if (offset + 9 > buf.length) {
                    throw new Error('Codec2: truncated tag-8/18 header');
                }

                let hash = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0,
                    schema = hash === lastDecodeHash && lastDecodeSchema
                        ? lastDecodeSchema
                        : (registry.schemas.get(hash) ?? resolveSchemaFromCacheOrStore(hash));

                if (!schema || !schema.decodeFn) {
                    return null;
                }

                lastDecodeHash = hash;
                lastDecodeSchema = schema;

                return schema.decodeFn(buf, offset + 9, depth + 1);
            }

            case 18: {
                if (offset + 9 > buf.length) {
                    throw new Error('Codec2: truncated tag-8/18 header');
                }

                let hash = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0,
                    schema = registry.schemas.get(hash) ?? resolveSchemaFromCacheOrStore(hash);

                if (!schema) {
                    return null;
                }

                if (schema.compressedDecodeFn) {
                    return schema.compressedDecodeFn(buf, offset + 9, depth + 1);
                }

                return schema.decodeFn ? schema.decodeFn(buf, offset + 9, depth + 1) : null;
            }

            case 9:
                return readBI64.call(buf, offset + 1);

            case 10:
                return new Date(readF64.call(buf, offset + 1));

            case 11:
                return (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) | 0;

            case 12: {
                // packed uint8 array
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: array count ' + count + ' exceeds limit');
                }

                return Array.from(buf.subarray(offset + 5, offset + 5 + count));
            }

            case 13: {
                // packed float64 array
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: array count ' + count + ' exceeds limit');
                }

                let arr = new Array(count),
                    p = offset + 5;

                for (let i = 0; i < count; i++) {
                    arr[i] = readF64.call(buf, p);
                    p += 8;
                }

                return arr;
            }

            case 14: {
                // packed int32 array
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: array count ' + count + ' exceeds limit');
                }

                let arr = new Array(count),
                    p = offset + 5;

                for (let i = 0; i < count; i++) {
                    arr[i] = (buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16) | (buf[p + 3]! << 24)) | 0;
                    p += 4;
                }

                return arr;
            }

            case 15: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: map count ' + count + ' exceeds limit');
                }

                let map = new Map(),
                    p = offset + 5;

                for (let i = 0; i < count; i++) {
                    let kEnd = decodeTagEnd(buf, p, depth + 1);
                    let key = decodeSbc(buf, p, kEnd - p, depth + 1);

                    p = kEnd;

                    let vEnd = decodeTagEnd(buf, p, depth + 1);
                    let val = decodeSbc(buf, p, vEnd - p, depth + 1);

                    p = vEnd;
                    map.set(key, val);
                }

                return map;
            }

            case 16: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: set count ' + count + ' exceeds limit');
                }

                let set = new Set(),
                    p = offset + 5;

                for (let i = 0; i < count; i++) {
                    let end = decodeTagEnd(buf, p, depth + 1);

                    set.add(decodeSbc(buf, p, end - p, depth + 1));
                    p = end;
                }

                return set;
            }

            case 17: {
                let typeId = buf[offset + 1]!;
                let bLen = (buf[offset + 2]! | (buf[offset + 3]! << 8) | (buf[offset + 4]! << 16) | (buf[offset + 5]! << 24)) >>> 0;
                let Ctor = TYPED_ARRAY_CTORS[typeId];

                if (!Ctor) {
                    throw new Error('Codec2: unknown typed array typeId ' + typeId);
                }

                let bpe = TYPED_ARRAY_BPE[typeId]!;

                if (bLen % bpe !== 0) {
                    throw new Error('Codec2: typed array byteLength not aligned');
                }

                let start = buf.byteOffset + offset + 6,
                    copied = buf.buffer.slice(start, start + bLen) as ArrayBuffer;

                return new (Ctor as new (buf: ArrayBuffer, off: number, len: number) => ArrayBufferView)(copied, 0, bLen / bpe);
            }

            default:
                throw new Error('Codec2: unknown tag ' + tag + ' at offset ' + offset);
        }
    }


    function decodeTagEnd(buf: Uint8Array, offset: number, depth: number): number {
        if (depth > 64) {
            throw new Error('Codec2: max decode depth exceeded');
        }

        let tag = buf[offset]!;

        switch (tag) {
            case 0: case 1: case 2:
                return offset + 1;
            case 3:
                return offset + 2;
            case 4: case 9: case 10:
                return offset + 9;
            case 5: {
                let sLen = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (offset + 5 + sLen > buf.length) {
                    throw new Error('Codec2: truncated string at offset ' + offset);
                }

                return offset + 5 + sLen;
            }
            case 6: {
                let bLen = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (offset + 5 + bLen > buf.length) {
                    throw new Error('Codec2: truncated bytes at offset ' + offset);
                }

                return offset + 5 + bLen;
            }
            case 7: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: array count ' + count + ' exceeds limit');
                }

                let p = offset + 5;

                for (let i = 0; i < count; i++) {
                    p = decodeTagEnd(buf, p, depth + 1);
                }

                return p;
            }
            case 8: case 18: {
                if (offset + 9 > buf.length) {
                    throw new Error('Codec2: truncated tag-8/18 header');
                }

                let dataLen = (buf[offset + 5]! | (buf[offset + 6]! << 8) | (buf[offset + 7]! << 16) | (buf[offset + 8]! << 24)) >>> 0;
                return offset + 9 + dataLen;
            }
            case 11:
                return offset + 5;
            case 12: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: array count ' + count + ' exceeds limit');
                }

                if (offset + 5 + count > buf.length) {
                    throw new Error('Codec2: truncated packed uint8 array at offset ' + offset);
                }

                return offset + 5 + count;
            }
            case 13: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: array count ' + count + ' exceeds limit');
                }

                if (offset + 5 + count * 8 > buf.length) {
                    throw new Error('Codec2: truncated packed float64 array at offset ' + offset);
                }

                return offset + 5 + count * 8;
            }
            case 14: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: array count ' + count + ' exceeds limit');
                }

                if (offset + 5 + count * 4 > buf.length) {
                    throw new Error('Codec2: truncated packed int32 array at offset ' + offset);
                }

                return offset + 5 + count * 4;
            }
            case 15: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: map count ' + count + ' exceeds limit');
                }

                let p = offset + 5;

                for (let i = 0, n = count * 2; i < n; i++) {
                    p = decodeTagEnd(buf, p, depth + 1);
                }

                return p;
            }
            case 16: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

                if (count > MAX_ARRAY_COUNT) {
                    throw new Error('Codec2: set count ' + count + ' exceeds limit');
                }

                let p = offset + 5;

                for (let i = 0; i < count; i++) {
                    p = decodeTagEnd(buf, p, depth + 1);
                }

                return p;
            }
            case 17: {
                let bLen = (buf[offset + 2]! | (buf[offset + 3]! << 8) | (buf[offset + 4]! << 16) | (buf[offset + 5]! << 24)) >>> 0;

                if (offset + 6 + bLen > buf.length) {
                    throw new Error('Codec2: truncated typed array at offset ' + offset);
                }

                return offset + 6 + bLen;
            }
            default:
                throw new Error('Codec2: unknown tag ' + tag + ' at offset ' + offset);
        }
    }


    function encodeSbc(value: unknown, buf: Uint8Array, pos: number): number {
        if (value === null || value === undefined) {
            buf[pos] = 0;
            return pos + 1;
        }

        switch (typeof value) {
            case 'bigint':
                buf[pos] = 9;
                writeBI64.call(buf, value, pos + 1);
                return pos + 9;

            case 'boolean':
                buf[pos] = value ? 2 : 1;
                return pos + 1;

            case 'number': {
                let n = value as number;

                if (Number.isInteger(n)) {
                    if (n >= 0 && n <= 255) {
                        buf[pos] = 3;
                        buf[pos + 1] = n;
                        return pos + 2;
                    }

                    if (n >= -2147483648 && n <= 2147483647) {
                        buf[pos] = 11;
                        buf[pos + 1] = n & 0xFF;
                        buf[pos + 2] = (n >>> 8) & 0xFF;
                        buf[pos + 3] = (n >>> 16) & 0xFF;
                        buf[pos + 4] = (n >>> 24) & 0xFF;
                        return pos + 5;
                    }
                }

                buf[pos] = 4;
                writeF64.call(buf, n, pos + 1);
                return pos + 9;
            }

            case 'string': {
                let sl = (value as string).length;

                buf[pos] = 5;

                // Single-pass ASCII fast path for short strings
                if (sl < 17) {
                    buf[pos + 1] = sl;
                    buf[pos + 2] = 0;
                    buf[pos + 3] = 0;
                    buf[pos + 4] = 0;

                    let ok = true,
                        p = pos + 5;

                    for (let k = 0; k < sl; k++) {
                        let c = (value as string).charCodeAt(k);

                        if (c > 127) {
                            ok = false;
                            break;
                        }

                        buf[p + k] = c;
                    }

                    if (ok) {
                        return p + sl;
                    }
                }

                let sLen = byteLen(value);

                buf[pos + 1] = sLen & 0xFF;
                buf[pos + 2] = (sLen >>> 8) & 0xFF;
                buf[pos + 3] = (sLen >>> 16) & 0xFF;
                buf[pos + 4] = (sLen >>> 24) & 0xFF;
                writeUtf8.call(buf, value, pos + 5, sLen);
                return pos + 5 + sLen;
            }

            case 'object': {
                if (value instanceof Date) {
                    buf[pos] = 10;
                    writeF64.call(buf, value.getTime(), pos + 1);
                    return pos + 9;
                }

                if (value instanceof Uint8Array) {
                    let len = value.length;

                    buf[pos] = 6;
                    buf[pos + 1] = len & 0xFF;
                    buf[pos + 2] = (len >>> 8) & 0xFF;
                    buf[pos + 3] = (len >>> 16) & 0xFF;
                    buf[pos + 4] = (len >>> 24) & 0xFF;
                    buf.set(value, pos + 5);
                    return pos + 5 + len;
                }

                if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
                    let ta = value as ArrayBufferView & { buffer: ArrayBuffer; byteLength: number; byteOffset: number };
                    let typeId = TYPED_ARRAY_IDS.get(ta.constructor);

                    if (typeId === undefined) {
                        buf[pos] = 0;
                        return pos + 1;
                    }

                    let bLen = ta.byteLength;

                    buf[pos] = 17;
                    buf[pos + 1] = typeId;
                    buf[pos + 2] = bLen & 0xFF;
                    buf[pos + 3] = (bLen >>> 8) & 0xFF;
                    buf[pos + 4] = (bLen >>> 16) & 0xFF;
                    buf[pos + 5] = (bLen >>> 24) & 0xFF;
                    buf.set(new Uint8Array(ta.buffer, ta.byteOffset, bLen), pos + 6);
                    return pos + 6 + bLen;
                }

                if (value instanceof Map) {
                    let count = value.size;

                    if (count > MAX_ARRAY_COUNT) {
                        throw new Error('Codec2: map count exceeds limit');
                    }

                    buf[pos] = 15;
                    buf[pos + 1] = count & 0xFF;
                    buf[pos + 2] = (count >>> 8) & 0xFF;
                    buf[pos + 3] = (count >>> 16) & 0xFF;
                    buf[pos + 4] = (count >>> 24) & 0xFF;

                    let p = pos + 5;

                    for (let [k, v] of value) {
                        p = encodeSbc(k, buf, p);
                        p = encodeSbc(v, buf, p);
                    }
                    return p;
                }

                if (value instanceof Set) {
                    let count = value.size;

                    if (count > MAX_ARRAY_COUNT) {
                        throw new Error('Codec2: set count exceeds limit');
                    }

                    buf[pos] = 16;
                    buf[pos + 1] = count & 0xFF;
                    buf[pos + 2] = (count >>> 8) & 0xFF;
                    buf[pos + 3] = (count >>> 16) & 0xFF;
                    buf[pos + 4] = (count >>> 24) & 0xFF;

                    let p = pos + 5;

                    for (let v of value) { p = encodeSbc(v, buf, p); }
                    return p;
                }

                if (Array.isArray(value)) {
                    let len = value.length;

                    if (len > 0 && typeof value[0] === 'number') {
                        // Try packed numeric array — tiered early-exit classification
                        let allUint8 = true,
                            allInt32 = true,
                            allNumber = true,
                            i = 0;

                        // Phase 1: check uint8 eligibility
                        for (; i < len; i++) {
                            let v = value[i];

                            if (typeof v !== 'number') {
                                allNumber = false;
                                allUint8 = false;
                                allInt32 = false;
                                break;
                            }

                            if (!Number.isInteger(v) || v < 0 || v > 255) {
                                allUint8 = false;
                                break;
                            }
                        }

                        // Phase 2: check int32 eligibility (only if uint8 failed on non-type reason)
                        if (!allUint8 && allNumber) {
                            for (; i < len; i++) {
                                let v = value[i];

                                if (typeof v !== 'number') {
                                    allNumber = false;
                                    allInt32 = false;
                                    break;
                                }

                                if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) {
                                    allInt32 = false;
                                    break;
                                }
                            }

                            // Phase 3: verify remaining are numbers (only if int32 failed)
                            if (!allInt32 && allNumber) {
                                for (; i < len; i++) {
                                    if (typeof value[i] !== 'number') {
                                        allNumber = false;
                                        break;
                                    }
                                }
                            }
                        }

                        if (allUint8) {
                            buf[pos] = 12;
                            buf[pos + 1] = len & 0xFF;
                            buf[pos + 2] = (len >>> 8) & 0xFF;
                            buf[pos + 3] = (len >>> 16) & 0xFF;
                            buf[pos + 4] = (len >>> 24) & 0xFF;

                            let p = pos + 5;

                            for (let i = 0; i < len; i++) {
                                buf[p + i] = value[i];
                            }

                            return p + len;
                        }

                        if (allInt32) {
                            buf[pos] = 14;
                            buf[pos + 1] = len & 0xFF;
                            buf[pos + 2] = (len >>> 8) & 0xFF;
                            buf[pos + 3] = (len >>> 16) & 0xFF;
                            buf[pos + 4] = (len >>> 24) & 0xFF;

                            let p = pos + 5;

                            for (let i = 0; i < len; i++) {
                                let v = value[i];

                                buf[p] = v & 0xFF;
                                buf[p + 1] = (v >>> 8) & 0xFF;
                                buf[p + 2] = (v >>> 16) & 0xFF;
                                buf[p + 3] = (v >>> 24) & 0xFF;
                                p += 4;
                            }

                            return p;
                        }

                        if (allNumber) {
                            buf[pos] = 13;
                            buf[pos + 1] = len & 0xFF;
                            buf[pos + 2] = (len >>> 8) & 0xFF;
                            buf[pos + 3] = (len >>> 16) & 0xFF;
                            buf[pos + 4] = (len >>> 24) & 0xFF;

                            let p = pos + 5;

                            for (let i = 0; i < len; i++) {
                                writeF64.call(buf, value[i], p);
                                p += 8;
                            }

                            return p;
                        }
                    }

                    buf[pos] = 7;
                    buf[pos + 1] = len & 0xFF;
                    buf[pos + 2] = (len >>> 8) & 0xFF;
                    buf[pos + 3] = (len >>> 16) & 0xFF;
                    buf[pos + 4] = (len >>> 24) & 0xFF;

                    let p = pos + 5;

                    for (let i = 0; i < len; i++) {
                        p = encodeSbc(value[i], buf, p);
                    }

                    return p;
                }

                // Plain object → schema-compiled path
                let obj = value as Record<string, unknown>,
                    schema = weakCache.get(obj) ?? null;

                if (!schema) {
                    schema = matchSchema(obj);

                    if (!schema) {
                        schema = inferAndRegister(obj, registry, helpers, store);
                    }

                    setCache(schema, obj);
                }

                let end: number,
                    h = schema.hash,
                    useCompressed = compress && schema.compressible && schema.compressedEncodeFn;

                if (useCompressed) {
                    buf[pos] = 18;
                    end = schema.compressedEncodeFn!(obj, buf, pos + 9);
                }
                else {
                    buf[pos] = 8;
                    end = schema.encodeFn!(obj, buf, pos + 9);
                }

                let dataLen = end - pos - 9;

                buf[pos + 1] = h & 0xFF;
                buf[pos + 2] = (h >>> 8) & 0xFF;
                buf[pos + 3] = (h >>> 16) & 0xFF;
                buf[pos + 4] = (h >>> 24) & 0xFF;
                buf[pos + 5] = dataLen & 0xFF;
                buf[pos + 6] = (dataLen >>> 8) & 0xFF;
                buf[pos + 7] = (dataLen >>> 16) & 0xFF;
                buf[pos + 8] = (dataLen >>> 24) & 0xFF;

                return end;
            }

            default:
                buf[pos] = 0;
                return pos + 1;
        }
    }


    function matchSchema(obj: Record<string, unknown>): Schema | null {
        // Ring buffer cache — match on key names AND value types
        let keyCount = 0;

        for (let _ in obj) { keyCount++; }

        for (let i = 0; i < 4; i++) {
            let schema = cacheSchemas[i];

            if (!schema || cacheCounts[i] !== keyCount) {
                continue;
            }

            let fields = cacheFields[i]!,
                match = true,
                n = fields.length;

            for (let j = 0; j < n; j++) {
                let f = fields[j]!;

                if (!(f.name in obj) || f.elementType || f.refHash !== undefined || inferType(obj[f.name]) !== f.type) {
                    match = false;
                    break;
                }
            }

            if (match) {
                return schema;
            }
        }

        // Last resort: check pre-defined typed schemas by field names only
        if (typedSchemas.size > 0 && typedSchemaFieldCounts.has(keyCount)) {
            let sortedKeys = Object.keys(obj).sort(),
                nameHash = computeNameHash(sortedKeys),
                typed = typedSchemas.get(nameHash);

            if (typed && typed.fields.length === sortedKeys.length) {
                let match = true;

                for (let j = 0, m = typed.fields.length; j < m; j++) {
                    if (typed.fields[j]!.name !== sortedKeys[j]) {
                        match = false;
                        break;
                    }
                }

                if (match) {
                    return typed;
                }
            }
        }

        return null;
    }


    function decode(buffer: Uint8Array, lengthOrOptions?: number | DecodeOptions): unknown {
        let len = buffer.length;

        if (typeof lengthOrOptions === 'number') {
            len = lengthOrOptions;
        }
        else if (lengthOrOptions && lengthOrOptions.schema != null) {
            let hintSchema = resolveSchemaForDecode(lengthOrOptions.schema),
                tag = buffer[0];

            if ((tag === 8 || tag === 18) && len >= 9) {
                let bufHash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0;

                if (bufHash === hintSchema.hash) {
                    lastDecodeHash = bufHash;
                    lastDecodeFn = null;
                    lastDecodeSchema = hintSchema;

                    if (tag === 18 && hintSchema.compressedDecodeFn) {
                        return hintSchema.compressedDecodeFn(buffer, 9, 0);
                    }

                    if (hintSchema.decodeFn) {
                        lastDecodeFn = hintSchema.decodeFn;

                        return hintSchema.decodeFn(buffer, 9, 0);
                    }
                }
            }
            // Hash mismatch or non-object tag — fall through to normal decode
        }

        // Fast path: tag 8 (uncompressed object) — hottest path, minimize overhead
        if (buffer[0] === 8 && len >= 9 && len === buffer.length) {
            let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0;

            if (hash === lastDecodeHash && lastDecodeFn) {
                return lastDecodeFn(buffer, 9, 0);
            }

            let schema = registry.schemas.get(hash) ?? resolveSchemaFromCacheOrStore(hash);

            if (schema && schema.decodeFn) {
                lastDecodeHash = hash;
                lastDecodeFn = schema.decodeFn;
                lastDecodeSchema = schema;

                return schema.decodeFn(buffer, 9, 0);
            }
        }

        // Tag 18 (compressed object) fast path
        if (buffer[0] === 18 && len >= 9 && len === buffer.length) {
            let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0,
                schema = hash === lastDecodeHash && lastDecodeSchema
                    ? lastDecodeSchema
                    : (registry.schemas.get(hash) ?? resolveSchemaFromCacheOrStore(hash));

            if (schema) {
                lastDecodeHash = hash;
                lastDecodeFn = null;
                lastDecodeSchema = schema;

                if (schema.compressedDecodeFn) {
                    return schema.compressedDecodeFn(buffer, 9, 0);
                }

                if (schema.decodeFn) {
                    return schema.decodeFn(buffer, 9, 0);
                }
            }
        }

        return decodeSbc(buffer, 0, len, 0);
    }


    function encodeObject(schema: Schema, obj: Record<string, unknown>, view: boolean): Uint8Array {
        let end: number,
            h = schema.hash,
            useCompressed = compress && schema.compressible && schema.compressedEncodeFn;

        if (useCompressed) {
            end = schema.compressedEncodeFn!(obj, encodeBuf, 9);

            while (end > encodeBuf.length) {
                encodeBuf = allocBuf(Math.max(end, encodeBuf.length) * 2);
                end = schema.compressedEncodeFn!(obj, encodeBuf, 9);
            }

            encodeBuf[0] = 18;
        }
        else {
            end = schema.encodeFn!(obj, encodeBuf, 9);

            while (end > encodeBuf.length) {
                encodeBuf = allocBuf(Math.max(end, encodeBuf.length) * 2);
                end = schema.encodeFn!(obj, encodeBuf, 9);
            }

            encodeBuf[0] = 8;
        }

        encodeBuf[1] = h & 0xFF;
        encodeBuf[2] = (h >>> 8) & 0xFF;
        encodeBuf[3] = (h >>> 16) & 0xFF;
        encodeBuf[4] = (h >>> 24) & 0xFF;

        let dataLen = end - 9;

        encodeBuf[5] = dataLen & 0xFF;
        encodeBuf[6] = (dataLen >>> 8) & 0xFF;
        encodeBuf[7] = (dataLen >>> 16) & 0xFF;
        encodeBuf[8] = (dataLen >>> 24) & 0xFF;

        if (view) {
            return encodeBuf.subarray(0, end);
        }

        let result = allocUnsafe(end);

        copyBuf(encodeBuf, result, 0, 0, end);

        return result;
    }


    // view=true returns a subarray into the shared encode buffer (zero-copy).
    // BORROW SEMANTICS: the returned slice is invalidated by the next encode() call.
    // Callers must consume the view synchronously or copy it before re-encoding.
    function encode(value: unknown, viewOrOptions?: boolean | EncodeOptions): Uint8Array {
        let hintSchema: Schema | null = null,
            view = false;

        if (typeof viewOrOptions === 'boolean') {
            view = viewOrOptions;
        }
        else if (viewOrOptions) {
            view = viewOrOptions.view ?? false;

            if (viewOrOptions.schema != null) {
                hintSchema = resolveSchemaForEncode(viewOrOptions.schema);
            }
        }

        // Schema hint fast path — skip typeof check, WeakMap, matchSchema, inferAndRegister
        if (hintSchema) {
            return encodeObject(hintSchema, value as Record<string, unknown>, view);
        }

        // Fast path: plain object
        if (typeof value === 'object' && value !== null && ((value as object).constructor === Object || (value as object).constructor === undefined)) {
            let obj = value as Record<string, unknown>,
                schema = weakCache.get(obj) ?? null;

            if (!schema) {
                schema = matchSchema(obj);

                if (!schema) {
                    schema = inferAndRegister(obj, registry, helpers, store);
                }

                setCache(schema, obj);
            }

            return encodeObject(schema, obj, view);
        }

        // Generic path
        let end = encodeSbc(value, encodeBuf, 0);

        while (end > encodeBuf.length) {
            encodeBuf = allocBuf(Math.max(end, encodeBuf.length) * 2);
            end = encodeSbc(value, encodeBuf, 0);
        }

        if (view) {
            return encodeBuf.subarray(0, end);
        }

        let result = allocUnsafe(end);

        copyBuf(encodeBuf, result, 0, 0, end);

        return result;
    }


    function decodeAt(buffer: Uint8Array, offset: number): unknown {
        let tag = buffer[offset]!;

        if (tag === 8 || tag === 18) {
            if (offset + 9 > buffer.length) {
                throw new Error('Codec2: truncated tag-8/18 header at offset ' + offset);
            }

            let dataLen = (buffer[offset + 5]! | (buffer[offset + 6]! << 8) | (buffer[offset + 7]! << 16) | (buffer[offset + 8]! << 24)) >>> 0;

            return decodeSbc(buffer, offset, 9 + dataLen, 0);
        }

        let end = decodeTagEnd(buffer, offset, 0);

        return decodeSbc(buffer, offset, end - offset, 0);
    }


    function defineSchema(fields: FieldSpec[]): number {
        // Sort by name (same order as inferAndRegister)
        let sorted = fields.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

        for (let i = 0, n = sorted.length; i < n; i++) {
            if (!FIELD_NAME_RE.test(sorted[i]!.name)) {
                throw new Error('Codec2: invalid field name: ' + sorted[i]!.name);
            }
        }

        let keys: string[] = new Array(sorted.length),
            types: string[] = new Array(sorted.length);

        for (let i = 0, n = sorted.length; i < n; i++) {
            keys[i] = sorted[i]!.name;
            types[i] = sorted[i]!.type;
        }

        let hash = computeShapeHash(keys, types);

        // Already registered?
        if (registry.schemas.has(hash)) {
            return hash;
        }

        let fieldDefs: FieldDef[] = new Array(sorted.length),
            fixedSize = 0,
            nullableCount = 0,
            offset = 0;

        for (let i = 0, n = sorted.length; i < n; i++) {
            let parsed = parseFieldType(types[i]!),
                baseType = parsed.base,
                fs = FIELD_SIZES[baseType] ?? 0,
                isNullable = sorted[i]!.nullable === true,
                nullIdx = isNullable ? nullableCount++ : -1;

            fieldDefs[i] = { elementType: parsed.elementType, fixedSize: fs, name: keys[i]!, nullable: isNullable, nullIndex: nullIdx, offset, rawType: types[i]!, refHash: parsed.hash, type: baseType };

            if (fs > 0) {
                fixedSize += fs;
                offset += fs;
            }
        }

        if (nullableCount > 16) {
            throw new Error('Codec2: max 16 nullable fields per schema');
        }

        let boolFields: number[] = [],
            compFixedSize = 0,
            float64Fields: number[] = [],
            intFields: number[] = [];

        for (let i = 0, n = fieldDefs.length; i < n; i++) {
            let t = fieldDefs[i]!.type;

            if (t === 'boolean') {
                boolFields.push(i);
            }
            else if (t === 'float64') {
                float64Fields.push(i);
            }
            else if (t === 'int16' || t === 'int32' || t === 'uint16' || t === 'uint32') {
                intFields.push(i);
            }
            else if (t === 'bigint' || t === 'date') {
                compFixedSize += 8;
            }
            else if (t === 'int8' || t === 'uint8') {
                compFixedSize += 1;
            }
        }

        let schema: Schema = {
            bitmapBytes: Math.ceil(nullableCount / 8),
            boolFields,
            compFixedSize,
            compressedDecodeFn: null,
            compressedEncodeFn: null,
            compressible: boolFields.length > 0 || float64Fields.length > 0 || intFields.length > 0,
            decodeFn: null,
            encodeFn: null,
            fields: fieldDefs,
            fixedSize,
            float64Fields,
            hash,
            id: registry.nextId++,
            intFields,
            nullableCount,
        };

        compileSchema(schema, helpers);
        registry.schemas.set(hash, schema);

        cache.set(hash, { fields: sorted, hash });

        if (store) {
            store.set(hash, { fields: sorted, hash });
        }

        // Index typed schemas by name hash for matchSchema lookup
        let hasStructural = false;

        for (let i = 0, m = fieldDefs.length; i < m; i++) {
            if (fieldDefs[i]!.elementType || fieldDefs[i]!.refHash !== undefined) {
                hasStructural = true;
                break;
            }
        }

        if (hasStructural) {
            let nameHash = computeNameHash(keys),
                existing = typedSchemas.get(nameHash);

            if (existing && existing.hash !== schema.hash) {
                typedSchemas.delete(nameHash);
            }
            else {
                typedSchemas.set(nameHash, schema);
                typedSchemaFieldCounts.add(schema.fields.length);
            }
        }

        return hash;
    }


    function resolveSchemaForDecode(hint: number | FieldSpec[]): Schema {
        if (typeof hint === 'number') {
            let s = registry.schemas.get(hint);

            if (!s) {
                throw new Error('Codec2: unknown schema hash ' + hint);
            }

            return s;
        }

        let hash = defineSchema(hint);

        return registry.schemas.get(hash)!;
    }


    function resolveSchemaForEncode(hint: number | FieldSpec[]): Schema | null {
        if (typeof hint === 'number') {
            return registry.schemas.get(hint) ?? null;
        }

        let hash = defineSchema(hint);

        return registry.schemas.get(hash)!;
    }


    function extractField(buffer: Uint8Array, fieldName: string): unknown {
        if (buffer[0] !== 8 && buffer[0] !== 18) {
            return undefined;
        }

        let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0,
            schema = registry.schemas.get(hash);

        if (!schema) {
            return undefined;
        }

        // Compressed format — offset math assumes uncompressed layout; fall back to full decode
        if (buffer[0] === 18) {
            let decoded = decode(buffer) as Record<string, unknown> | null;

            return decoded ? decoded[fieldName] : undefined;
        }

        let fields = schema.fields,
            n = fields.length,
            targetIdx = -1;

        for (let i = 0; i < n; i++) {
            if (fields[i]!.name === fieldName) {
                targetIdx = i;
                break;
            }
        }

        if (targetIdx === -1) {
            return undefined;
        }

        let bm = schema.bitmapBytes,
            target = fields[targetIdx]!;

        // Check nullable bitmap for target field
        if (target.nullable) {
            let bitmap = bm === 1 ? buffer[9]! : (buffer[9]! | (buffer[10]! << 8));

            if (!(bitmap & (1 << target.nullIndex))) {
                return null;
            }
        }

        let dataStart = 9 + bm;

        // O(1) path: target is fixed-size and all preceding fields are also fixed-size
        if (target.fixedSize > 0) {
            let allPrecedingFixed = true;

            for (let i = 0; i < targetIdx; i++) {
                if (fields[i]!.fixedSize === 0) {
                    allPrecedingFixed = false;
                    break;
                }
            }

            if (allPrecedingFixed) {
                let bitmap = bm > 0 ? (bm === 1 ? buffer[9]! : (buffer[9]! | (buffer[10]! << 8))) : 0,
                    pos = dataStart;

                for (let i = 0; i < targetIdx; i++) {
                    let f = fields[i]!;

                    if (f.nullable && !(bitmap & (1 << f.nullIndex))) {
                        continue;
                    }

                    pos += f.fixedSize;
                }

                if (pos + target.fixedSize > buffer.length) {
                    throw new Error('Codec2: buffer too short for field at offset ' + pos);
                }

                return readFixedField(buffer, pos, target.type);
            }
        }

        // Variable-size scan
        let bitmap = bm > 0 ? (bm === 1 ? buffer[9]! : (buffer[9]! | (buffer[10]! << 8))) : 0,
            pos = dataStart;

        for (let i = 0; i < targetIdx; i++) {
            let f = fields[i]!;

            if (f.nullable && !(bitmap & (1 << f.nullIndex))) {
                continue;
            }

            if (f.fixedSize > 0) {
                pos += f.fixedSize;
                continue;
            }

            switch (f.type) {
                case 'bytes':
                case 'string': {
                    readVarint(buffer, pos);
                    pos = _vr.p + _vr.v;
                    break;
                }
                case 'array': {
                    if (f.elementType) {
                        // Typed array: varint count + element-specific data
                        readVarint(buffer, pos);

                        let count = _vr.v;

                        pos = _vr.p;

                        let elemSize = f.elementType.base ? FIELD_SIZES[f.elementType.base] : 0;

                        if (elemSize > 0) {
                            pos += count * elemSize;
                        }
                        else if (f.elementType.base === 'string' || f.elementType.base === 'bytes') {
                            for (let j = 0; j < count; j++) {
                                readVarint(buffer, pos);
                                pos = _vr.p + _vr.v;
                            }
                        }
                        else if (f.elementType.base === 'object' && f.elementType.hash !== undefined) {
                            for (let j = 0; j < count; j++) {
                                let fb = buffer[pos]!;

                                if (fb < 128) {
                                    pos += 1 + fb;
                                }
                                else if (fb === 8 || fb === 18) {
                                    if (pos + 9 > buffer.length) {
                                        return undefined;
                                    }

                                    let dLen = (buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0;

                                    pos += 9 + dLen;
                                }
                                else {
                                    pos = decodeTagEnd(buffer, pos, 0);
                                }
                            }
                        }
                        else {
                            for (let j = 0; j < count; j++) {
                                pos = decodeTagEnd(buffer, pos, 0);
                            }
                        }
                    }
                    else {
                        // Generic array: flag + u32 count
                        let flag = buffer[pos]!,
                            count = (buffer[pos + 1]! | (buffer[pos + 2]! << 8) | (buffer[pos + 3]! << 16) | (buffer[pos + 4]! << 24)) >>> 0;

                        pos += 5;

                        if (flag === 1) {
                            pos += count;
                        }
                        else if (flag === 2) {
                            pos += count * 4;
                        }
                        else if (flag === 3) {
                            pos += count * 8;
                        }
                        else {
                            for (let j = 0; j < count; j++) {
                                pos = decodeTagEnd(buffer, pos, 0);
                            }
                        }
                    }

                    break;
                }
                case 'mixed':
                case 'object': {
                    if (f.refHash !== undefined) {
                        // Typed object: varint dataLen or full tag-8 header
                        let fb = buffer[pos]!;

                        if (fb < 128) {
                            pos += 1 + fb;
                        }
                        else if (fb === 8 || fb === 18) {
                            if (pos + 9 > buffer.length) {
                                return undefined;
                            }

                            let dLen = (buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0;

                            pos += 9 + dLen;
                        }
                        else {
                            pos = decodeTagEnd(buffer, pos, 0);
                        }
                    }
                    else if (buffer[pos] === 8 || buffer[pos] === 18) {
                        if (pos + 9 > buffer.length) {
                            return undefined;
                        }

                        let dLen = (buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0;

                        pos += 9 + dLen;
                    }
                    else {
                        pos = decodeTagEnd(buffer, pos, 0);
                    }

                    break;
                }
                case 'map':
                case 'set':
                case 'typedarray': {
                    pos = decodeTagEnd(buffer, pos, 0);
                    break;
                }
                default:
                    return undefined;
            }
        }

        // pos now points to target field data
        if (target.fixedSize > 0) {
            if (pos + target.fixedSize > buffer.length) {
                throw new Error('Codec2: buffer too short for field at offset ' + pos);
            }

            return readFixedField(buffer, pos, target.type);
        }

        switch (target.type) {
            case 'string': {
                readVarint(buffer, pos);
                return readStr(buffer, _vr.p, _vr.v);
            }
            case 'bytes': {
                readVarint(buffer, pos);
                return buffer.slice(_vr.p, _vr.p + _vr.v);
            }
            case 'array': {
                // Both typed and generic arrays use schema-specific encoding;
                // fall back to full object decode to read the field correctly
                let s = registry.schemas.get(hash);

                if (s && s.decodeFn) {
                    let obj = s.decodeFn(buffer, dataStart, 0) as Record<string, unknown>;

                    return obj[fieldName];
                }

                return undefined;
            }
            case 'map':
            case 'mixed':
            case 'set':
            case 'typedarray':
                return decodeSbc(buffer, pos, decodeTagEnd(buffer, pos, 0) - pos, 0);
            case 'object': {
                if (target.refHash !== undefined) {
                    // Typed object — use full object decode
                    let s = registry.schemas.get(hash);

                    if (s && s.decodeFn) {
                        let obj = s.decodeFn(buffer, dataStart, 0) as Record<string, unknown>;

                        return obj[fieldName];
                    }

                    return undefined;
                }

                if (pos + 9 > buffer.length) {
                    return undefined;
                }

                let end = (buffer[pos] === 8 || buffer[pos] === 18)
                    ? pos + 9 + ((buffer[pos + 5]! | (buffer[pos + 6]! << 8) | (buffer[pos + 7]! << 16) | (buffer[pos + 8]! << 24)) >>> 0)
                    : decodeTagEnd(buffer, pos, 0);

                return decodeSbc(buffer, pos, end - pos, 0);
            }
            default:
                return undefined;
        }
    }


    function computeSize(value: unknown): number {
        if (value === null || value === undefined) {
            return 1;
        }

        switch (typeof value) {
            case 'bigint': return 9;
            case 'boolean': return 1;
            case 'number': {
                if (Number.isInteger(value)) {
                    if (value >= 0 && value <= 255) {
                        return 2;
                    }

                    if (value >= -2147483648 && value <= 2147483647) {
                        return 5;
                    }
                }

                return 9;
            }
            case 'string':
                return 5 + byteLen(value);
            case 'object': {
                if (value instanceof Date) {
                    return 9;
                }

                if (value instanceof Uint8Array) {
                    return 5 + value.length;
                }

                if (value instanceof Map || value instanceof Set) {
                    return -1;
                }

                if (ArrayBuffer.isView(value)) {
                    return -1;
                }

                if (Array.isArray(value)) {
                    return -1;
                }

                let obj = value as Record<string, unknown>,
                    schema = weakCache.get(obj) ?? matchSchema(obj) ?? null;

                if (!schema) {
                    schema = inferAndRegister(obj, registry, helpers, store);
                    setCache(schema, obj);
                }

                let fields = schema.fields,
                    size = 9 + schema.bitmapBytes;

                for (let i = 0, n = fields.length; i < n; i++) {
                    let f = fields[i]!,
                        v = obj[f.name];

                    if (f.nullable && v == null) {
                        continue;
                    }

                    if (f.fixedSize > 0) {
                        size += f.fixedSize;
                        continue;
                    }

                    switch (f.type) {
                        case 'array': {
                            if (!f.elementType) {
                                return -1;
                            }

                            let arr = v as unknown[],
                                elemSize = FIELD_SIZES[f.elementType.base] ?? 0;

                            if (elemSize > 0) {
                                size += varintSize(arr.length) + arr.length * elemSize;
                            }
                            else if (f.elementType.base === 'string') {
                                let arrSize = varintSize(arr.length);

                                for (let j = 0, m = arr.length; j < m; j++) {
                                    let bl = byteLen(arr[j] as string);

                                    arrSize += varintSize(bl) + bl;
                                }

                                size += arrSize;
                            }
                            else {
                                return -1;
                            }

                            break;
                        }
                        case 'bytes': {
                            let bl = (v as Uint8Array).length;

                            size += varintSize(bl) + bl;
                            break;
                        }
                        case 'object': {
                            if (f.refHash !== undefined) {
                                // Typed object: 1 byte varint len + nested fields (assumes < 128)
                                let refSchema = registry.schemas.get(f.refHash);

                                if (refSchema) {
                                    let nestedFields = refSchema.fields,
                                        nestedSize = refSchema.bitmapBytes;

                                    for (let j = 0, m = nestedFields.length; j < m; j++) {
                                        let nf = nestedFields[j]!,
                                            nv = (v as Record<string, unknown>)[nf.name];

                                        if (nf.nullable && nv == null) {
                                            continue;
                                        }

                                        if (nf.fixedSize > 0) {
                                            nestedSize += nf.fixedSize;
                                        }
                                        else {
                                            return -1;
                                        }
                                    }

                                    size += (nestedSize < 128 ? 1 : 9) + nestedSize;
                                }
                                else {
                                    return -1;
                                }
                            }
                            else {
                                let nested = computeSize(v);

                                if (nested === -1) {
                                    return -1;
                                }

                                size += nested;
                            }

                            break;
                        }
                        case 'string': {
                            let bl = byteLen(v as string);

                            size += varintSize(bl) + bl;
                            break;
                        }
                        default:
                            return -1;
                    }
                }

                return size;
            }
            default: return 1;
        }
    }


    function deserializeRegistry(data: Uint8Array): void {
        let len = data.length,
            pos = 0;

        if (pos + 2 > len) {
            throw new Error('Codec2: registry data truncated at schema count');
        }

        let schemaCount = data[pos]! | (data[pos + 1]! << 8);
        pos += 2;

        if (schemaCount > MAX_SCHEMA_COUNT) {
            throw new Error('Codec2: schema count ' + schemaCount + ' exceeds limit');
        }

        for (let i = 0; i < schemaCount; i++) {
            if (pos + 6 > len) {
                throw new Error('Codec2: registry data truncated at schema ' + i);
            }

            let hash = (data[pos]! | (data[pos + 1]! << 8) | (data[pos + 2]! << 16) | (data[pos + 3]! << 24)) >>> 0;
            pos += 4;

            let fieldCount = data[pos]! | (data[pos + 1]! << 8);
            pos += 2;

            let fields: FieldSpec[] = [];

            for (let j = 0; j < fieldCount; j++) {
                if (pos + 2 > len) {
                    throw new Error('Codec2: registry data truncated at field name length');
                }

                let nameLen = data[pos]! | (data[pos + 1]! << 8);
                pos += 2;

                if (nameLen === 0) {
                    throw new Error('Codec2: empty field name in registry data');
                }

                if (pos + nameLen > len) {
                    throw new Error('Codec2: registry data truncated at field name');
                }

                let name = readStr(data, pos, nameLen);

                if (!FIELD_NAME_RE.test(name)) {
                    throw new Error('Codec2: invalid field name in registry data: ' + name);
                }

                pos += nameLen;

                if (pos + 2 > len) {
                    throw new Error('Codec2: registry data truncated at field type length');
                }

                let typeLen = data[pos]! | (data[pos + 1]! << 8);
                pos += 2;

                if (typeLen === 0) {
                    throw new Error('Codec2: empty field type in registry data');
                }

                if (pos + typeLen > len) {
                    throw new Error('Codec2: registry data truncated at field type');
                }

                let type = readStr(data, pos, typeLen);

                pos += typeLen;

                // Validate type is known (parseFieldType will throw for unknown types during defineSchema,
                // but we validate early to reject garbage before any schema registration)
                parseFieldType(type);

                if (pos + 1 > len) {
                    throw new Error('Codec2: registry data truncated at field flags');
                }

                let flags = data[pos]!;
                pos += 1;

                fields.push({
                    name,
                    nullable: !!(flags & 1),
                    type,
                });
            }

            // Skip if already registered
            if (registry.schemas.has(hash)) {
                continue;
            }

            defineSchema(fields);
        }
    }


    function serializeRegistry(): Uint8Array {
        let schemas = [...registry.schemas.values()];

        // Calculate total size using UTF-8 byte lengths
        let size = 2; // u16 schemaCount

        for (let i = 0, n = schemas.length; i < n; i++) {
            let s = schemas[i]!;

            size += 4 + 2; // u32 hash + u16 fieldCount

            for (let j = 0, m = s.fields.length; j < m; j++) {
                let f = s.fields[j]!;

                size += 2 + byteLen(f.name) + 2 + byteLen(f.rawType) + 1;
            }
        }

        let buf = allocBuf(size),
            pos = 0;

        // Write schema count
        buf[pos] = schemas.length & 0xFF;
        buf[pos + 1] = (schemas.length >>> 8) & 0xFF;
        pos += 2;

        for (let i = 0, n = schemas.length; i < n; i++) {
            let s = schemas[i]!;

            // Write hash
            buf[pos] = s.hash & 0xFF;
            buf[pos + 1] = (s.hash >>> 8) & 0xFF;
            buf[pos + 2] = (s.hash >>> 16) & 0xFF;
            buf[pos + 3] = (s.hash >>> 24) & 0xFF;
            pos += 4;

            // Write field count
            let fc = s.fields.length;

            buf[pos] = fc & 0xFF;
            buf[pos + 1] = (fc >>> 8) & 0xFF;
            pos += 2;

            for (let j = 0; j < fc; j++) {
                let f = s.fields[j]!;

                // Write name (UTF-8)
                let bl = byteLen(f.name);

                buf[pos] = bl & 0xFF;
                buf[pos + 1] = (bl >>> 8) & 0xFF;
                pos += 2;
                writeUtf8.call(buf, f.name, pos, bl);
                pos += bl;

                // Write type (UTF-8, full structural type string)
                let tl = byteLen(f.rawType);

                buf[pos] = tl & 0xFF;
                buf[pos + 1] = (tl >>> 8) & 0xFF;
                pos += 2;
                writeUtf8.call(buf, f.rawType, pos, tl);
                pos += tl;

                // Write flags
                buf[pos] = f.nullable ? 1 : 0;
                pos += 1;
            }
        }

        return buf;
    }


    return { computeSize, decode, decodeAt, defineSchema, deserializeRegistry, encode, extractField, serializeRegistry };
};


export { codec };
export type { CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, SchemaRegistry } from './types';
export type { Schema } from './codegen';
export type { StoredSchema } from './cache';
