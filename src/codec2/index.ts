// Codec2 — High-performance binary codec
// JIT-compiled per-shape encode/decode, zero per-field branching at runtime

import { compileSchema } from './codegen';
import { allocBuf, allocUnsafe, byteLen, copyBuf, isNode, readBI64, readF64, readStr, writeBI64, writeF64, writeUtf8 } from './platform';

import type { FieldDef, Schema, SbcHelpers } from './codegen';


type SchemaRegistry = {
    nextId: number;
    schemas: Map<number, Schema>;
};


let MAX_ARRAY_COUNT = 1048576; // 2^20 — guard against DoS from untrusted u32 counts


// FNV-1a
let FNV_OFFSET = 0x811c9dc5 | 0,
    FNV_PRIME = 0x01000193 | 0;

let FIELD_SIZES: Record<string, number> = {
    bigint: 8,
    boolean: 1,
    date: 8,
    float64: 8,
    int8: 1,
    int16: 2,
    int32: 4,
    uint8: 1,
    uint16: 2,
    uint32: 4,
};


function computeShapeHash(keys: string[], types: string[]): number {
    let h = FNV_OFFSET;

    for (let i = 0, n = keys.length; i < n; i++) {
        let k = keys[i]!;

        for (let j = 0, m = k.length; j < m; j++) {
            h ^= k.charCodeAt(j);
            h = Math.imul(h, FNV_PRIME);
        }

        h ^= 0xFF;
        h = Math.imul(h, FNV_PRIME);

        let t = types[i]!;

        for (let j = 0, m = t.length; j < m; j++) {
            h ^= t.charCodeAt(j);
            h = Math.imul(h, FNV_PRIME);
        }

        h ^= 0xFE;
        h = Math.imul(h, FNV_PRIME);
    }

    return h >>> 0;
}


function inferType(value: unknown): string {
    if (value === null || value === undefined) {
        return 'mixed';
    }

    switch (typeof value) {
        case 'bigint': return 'bigint';
        case 'boolean': return 'boolean';
        case 'number': {
            let n = value as number;

            if (Number.isInteger(n)) {
                if (n >= 0 && n <= 255) {
                    return 'uint8';
                }

                if (n >= 0 && n <= 65535) {
                    return 'uint16';
                }

                if (n >= -2147483648 && n <= 2147483647) {
                    return 'int32';
                }
            }

            return 'float64';
        }
        case 'string': return 'string';
        case 'object': {
            if (value instanceof Date) {
                return 'date';
            }

            if (value instanceof Uint8Array) {
                return 'bytes';
            }

            if (Array.isArray(value)) {
                return 'array';
            }

            return 'object';
        }
        default: return 'mixed';
    }
}


function inferAndRegister(obj: Record<string, unknown>, registry: SchemaRegistry, helpers: SbcHelpers): Schema {
    let keys = Object.keys(obj).sort(),
        types: string[] = new Array(keys.length);

    for (let i = 0, n = keys.length; i < n; i++) {
        types[i] = inferType(obj[keys[i]!]);
    }

    let hash = computeShapeHash(keys, types),
        existing = registry.schemas.get(hash);

    if (existing) {
        let ef = existing.fields,
            match = ef.length === keys.length;

        if (match) {
            for (let i = 0, n = keys.length; i < n; i++) {
                if (ef[i]!.name !== keys[i] || ef[i]!.type !== types[i]) {
                    match = false;
                    break;
                }
            }
        }

        if (match) {
            return existing;
        }

        throw new Error('Codec2: schema hash collision — two distinct schemas share hash ' + hash);
    }

    let fields: FieldDef[] = new Array(keys.length),
        fixedSize = 0,
        offset = 0;

    for (let i = 0, n = keys.length; i < n; i++) {
        let fs = FIELD_SIZES[types[i]!] ?? 0,
            name = keys[i]!;

        fields[i] = { fixedSize: fs, name, offset, type: types[i]! };

        if (fs > 0) {
            fixedSize += fs;
            offset += fs;
        }
    }

    let schema: Schema = {
        decodeFn: null,
        encodeFn: null,
        fields,
        fixedSize,
        hash,
        id: registry.nextId++,
    };

    compileSchema(schema, helpers);
    registry.schemas.set(hash, schema);

    return schema;
}


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

const createCodec = (): { decode(buffer: Uint8Array, length?: number): unknown; encode(value: unknown, view?: boolean): Uint8Array } => {
    let encodeBuf = allocBuf(65536),
        registry: SchemaRegistry = {
            nextId: 1,
            schemas: new Map(),
        };

    // Multi-schema cache — handles nested objects without breaking
    let cacheCounts: number[] = [0, 0, 0, 0],
        cacheFields: (FieldDef[] | null)[] = [null, null, null, null],
        cacheIdx = 0,
        cacheSchemas: (Schema | null)[] = [null, null, null, null],
        weakCache = new WeakMap<object, Schema>();

    function setCache(schema: Schema, obj: object): void {
        cacheSchemas[cacheIdx] = schema;
        cacheFields[cacheIdx] = schema.fields;
        cacheCounts[cacheIdx] = schema.fields.length;
        cacheIdx = (cacheIdx + 1) & 3;
        weakCache.set(obj, schema);
    }

    // Decode fast path: cache last-used schema to avoid Map lookup
    let lastDecodeHash = 0,
        lastDecodeSchema: Schema | null = null;

    // Specialized object encoder — skips typeof/instanceof checks for known-object fields
    function encodeObj(obj: Record<string, unknown>, buf: Uint8Array, pos: number): number {
        let schema = weakCache.get(obj) ?? null;

        if (!schema) {
            schema = matchSchema(obj);

            if (!schema) {
                schema = inferAndRegister(obj, registry, helpers);
            }

            setCache(schema, obj);
        }

        let h = schema.hash;

        buf[pos] = 8;
        buf[pos + 1] = h & 0xFF;
        buf[pos + 2] = (h >>> 8) & 0xFF;
        buf[pos + 3] = (h >>> 16) & 0xFF;
        buf[pos + 4] = (h >>> 24) & 0xFF;

        let end = schema.encodeFn!(obj, buf, pos + 9),
            dataLen = end - pos - 9;

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
                let hash = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0,
                    schema = hash === lastDecodeHash && lastDecodeSchema
                        ? lastDecodeSchema
                        : registry.schemas.get(hash);

                if (!schema || !schema.decodeFn) {
                    return null;
                }

                lastDecodeHash = hash;
                lastDecodeSchema = schema;

                return schema.decodeFn(buf, offset + 9, depth + 1);
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

                let arr = new Array(count),
                    p = offset + 5;

                for (let i = 0; i < count; i++) {
                    arr[i] = buf[p + i]!;
                }

                return arr;
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
                return offset + 5 + sLen;
            }
            case 6: {
                let bLen = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;
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
            case 8: {
                let dataLen = (buf[offset + 5]! | (buf[offset + 6]! << 8) | (buf[offset + 7]! << 16) | (buf[offset + 8]! << 24)) >>> 0;
                return offset + 9 + dataLen;
            }
            case 11:
                return offset + 5;
            case 12: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;
                return offset + 5 + count;
            }
            case 13: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;
                return offset + 5 + count * 8;
            }
            case 14: {
                let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;
                return offset + 5 + count * 4;
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

                if (Array.isArray(value)) {
                    let len = value.length;

                    if (len > 0 && typeof value[0] === 'number') {
                        // Try packed numeric array
                        let allUint8 = true,
                            allInt32 = true,
                            allNumber = true;

                        for (let i = 0; i < len; i++) {
                            let v = value[i];

                            if (typeof v !== 'number') {
                                allNumber = false;
                                allUint8 = false;
                                allInt32 = false;
                                break;
                            }

                            let isInt = Number.isInteger(v);

                            if (!isInt || v < 0 || v > 255) {
                                allUint8 = false;
                            }

                            if (!isInt || v < -2147483648 || v > 2147483647) {
                                allInt32 = false;
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
                        schema = inferAndRegister(obj, registry, helpers);
                    }

                    setCache(schema, obj);
                }

                let h = schema.hash;

                buf[pos] = 8;
                buf[pos + 1] = h & 0xFF;
                buf[pos + 2] = (h >>> 8) & 0xFF;
                buf[pos + 3] = (h >>> 16) & 0xFF;
                buf[pos + 4] = (h >>> 24) & 0xFF;

                let end = schema.encodeFn!(obj, buf, pos + 9),
                    dataLen = end - pos - 9;

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
        // O(1) WeakMap lookup for repeated objects
        let cached = weakCache.get(obj);

        if (cached) {
            return cached;
        }

        // Fallback: ring buffer cache — match on key names AND value types
        let keyCount = 0;

        for (let _ in obj) {
            keyCount++;
        }

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

                if (!(f.name in obj) || inferType(obj[f.name]) !== f.type) {
                    match = false;
                    break;
                }
            }

            if (match) {
                return schema;
            }
        }

        return null;
    }


    function decode(buffer: Uint8Array, length?: number): unknown {
        let len = length ?? buffer.length;

        // Fast path: tag 8 (object) — only when length covers full buffer
        if (buffer[0] === 8 && len === buffer.length) {
            let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0,
                schema = hash === lastDecodeHash && lastDecodeSchema
                    ? lastDecodeSchema
                    : registry.schemas.get(hash);

            if (schema && schema.decodeFn) {
                lastDecodeHash = hash;
                lastDecodeSchema = schema;

                return schema.decodeFn(buffer, 9, 0);
            }
        }

        return decodeSbc(buffer, 0, len, 0);
    }


    // view=true returns a subarray into the shared encode buffer (zero-copy).
    // BORROW SEMANTICS: the returned slice is invalidated by the next encode() call.
    // Callers must consume the view synchronously or copy it before re-encoding.
    function encode(value: unknown, view?: boolean): Uint8Array {
        // Fast path: plain object
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Uint8Array)) {
            let obj = value as Record<string, unknown>,
                schema = weakCache.get(obj) ?? null;

            if (!schema) {
                schema = matchSchema(obj);

                if (!schema) {
                    schema = inferAndRegister(obj, registry, helpers);
                }

                setCache(schema, obj);
            }

            let end = schema.encodeFn!(obj, encodeBuf, 9),
                h = schema.hash;

            while (end > encodeBuf.length) {
                encodeBuf = allocBuf(Math.max(end, encodeBuf.length) * 2);
                end = schema.encodeFn!(obj, encodeBuf, 9);
            }

            encodeBuf[0] = 8;
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


    return { decode, encode };
};


export { createCodec };
export type { Schema, SchemaRegistry };
