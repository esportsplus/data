// Tagged encoder/decoder — tag-based binary encoding for primitive + complex values
// Extracted from codec() closure; state threaded via DecodeContext / EncodeContext

import { MAX_ARRAY_COUNT } from './constants';
import { byteLen, isNode, readBI64, readF64, readStr, TYPED_ARRAY_BPE, TYPED_ARRAY_CTORS, TYPED_ARRAY_IDS, writeBI64, writeF64, writeUtf8 } from './platform';
import { inferAndRegister } from './schema';

import type { PersistentStore, SchemaRegistry } from './types';
import type { Schema, SbcHelpers } from './codegen';


type DecodeContext = {
    compress: boolean;
    lastDecodeFn: ((buf: Uint8Array, pos: number, depth: number) => unknown) | null;
    lastDecodeHash: number;
    lastDecodeSchema: Schema | null;
    resolveSchema: (hash: number) => Schema | null;
    schemas: Map<number, Schema>;
    setCache: (schema: Schema, decoded: object) => void;
};

type EncodeContext = {
    compress: boolean;
    helpers: SbcHelpers;
    matchSchema: (obj: Record<string, unknown>) => Schema | null;
    registry: SchemaRegistry;
    setCache: (schema: Schema, obj: object) => void;
    store: PersistentStore | null;
    weakCache: WeakMap<object, Schema>;
};


function decodeSbc(dctx: DecodeContext, buf: Uint8Array, offset: number, len: number, depth: number): unknown {
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

                arr[i] = decodeSbc(dctx, buf, p, end - p, depth + 1);
                p = end;
            }

            return arr;
        }

        case 8: {
            if (offset + 9 > buf.length) {
                throw new Error('Codec2: truncated tag-8/18 header');
            }

            let hash = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0,
                schema = hash === dctx.lastDecodeHash && dctx.lastDecodeSchema
                    ? dctx.lastDecodeSchema
                    : (dctx.schemas.get(hash) ?? dctx.resolveSchema(hash));

            if (!schema || !schema.decodeFn) {
                return null;
            }

            dctx.lastDecodeHash = hash;
            dctx.lastDecodeSchema = schema;

            return schema.decodeFn(buf, offset + 9, depth + 1);
        }

        case 18: {
            if (offset + 9 > buf.length) {
                throw new Error('Codec2: truncated tag-8/18 header');
            }

            let hash = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0,
                schema = dctx.schemas.get(hash) ?? dctx.resolveSchema(hash);

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
                let key = decodeSbc(dctx, buf, p, kEnd - p, depth + 1);

                p = kEnd;

                let vEnd = decodeTagEnd(buf, p, depth + 1);
                let val = decodeSbc(dctx, buf, p, vEnd - p, depth + 1);

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

                set.add(decodeSbc(dctx, buf, p, end - p, depth + 1));
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


function encodeSbc(ectx: EncodeContext, value: unknown, buf: Uint8Array, pos: number): number {
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

            let sLen = byteLen(value),
                needed = pos + 5 + sLen;

            buf[pos + 1] = sLen & 0xFF;
            buf[pos + 2] = (sLen >>> 8) & 0xFF;
            buf[pos + 3] = (sLen >>> 16) & 0xFF;
            buf[pos + 4] = (sLen >>> 24) & 0xFF;

            if (needed <= buf.length) {
                writeUtf8.call(buf, value, pos + 5, sLen);
            }

            return needed;
        }

        case 'object': {
            if (value instanceof Date) {
                buf[pos] = 10;
                writeF64.call(buf, value.getTime(), pos + 1);
                return pos + 9;
            }

            if (value instanceof Uint8Array) {
                let len = value.length,
                    needed = pos + 5 + len;

                buf[pos] = 6;
                buf[pos + 1] = len & 0xFF;
                buf[pos + 2] = (len >>> 8) & 0xFF;
                buf[pos + 3] = (len >>> 16) & 0xFF;
                buf[pos + 4] = (len >>> 24) & 0xFF;

                if (needed <= buf.length) {
                    buf.set(value, pos + 5);
                }

                return needed;
            }

            if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
                let ta = value as ArrayBufferView & { buffer: ArrayBuffer; byteLength: number; byteOffset: number };
                let typeId = TYPED_ARRAY_IDS.get(ta.constructor);

                if (typeId === undefined) {
                    buf[pos] = 0;
                    return pos + 1;
                }

                let bLen = ta.byteLength,
                    needed = pos + 6 + bLen;

                buf[pos] = 17;
                buf[pos + 1] = typeId;
                buf[pos + 2] = bLen & 0xFF;
                buf[pos + 3] = (bLen >>> 8) & 0xFF;
                buf[pos + 4] = (bLen >>> 16) & 0xFF;
                buf[pos + 5] = (bLen >>> 24) & 0xFF;

                if (needed <= buf.length) {
                    buf.set(new Uint8Array(ta.buffer, ta.byteOffset, bLen), pos + 6);
                }

                return needed;
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
                    p = encodeSbc(ectx, k, buf, p);
                    p = encodeSbc(ectx, v, buf, p);
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

                for (let v of value) { p = encodeSbc(ectx, v, buf, p); }
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
                    p = encodeSbc(ectx, value[i], buf, p);
                }

                return p;
            }

            // Plain object → schema-compiled path
            let obj = value as Record<string, unknown>,
                schema = ectx.weakCache.get(obj) ?? null;

            if (!schema) {
                schema = ectx.matchSchema(obj);

                if (!schema) {
                    schema = inferAndRegister(obj, ectx.registry, ectx.helpers, ectx.store);
                }

                ectx.setCache(schema, obj);
            }

            let end: number,
                h = schema.hash,
                useCompressed = ectx.compress && schema.compressible && schema.compressedEncodeFn;

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


export { decodeSbc, decodeTagEnd, encodeSbc };
export type { DecodeContext, EncodeContext };
