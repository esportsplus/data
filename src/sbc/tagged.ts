// Tagged encoder/decoder — tag-based binary encoding for primitive + complex values
// Extracted from codec() closure; state threaded via DecodeContext / EncodeContext

import { MAX_ARRAY_COUNT } from './constants';
import { byteLen, classifyPackedArray, readBI64, readF64, readStr, TYPED_ARRAY_BPE, TYPED_ARRAY_CTORS, TYPED_ARRAY_IDS, writeBI64, writeF64, writeUtf8 } from './platform';
import { inferAndRegister } from './schema';

import type { SchemaCache } from './cache';
import type { Schema, SbcHelpers } from './codegen';
import type { PersistentStore, SchemaRegistry } from './types';


// int64 bounds — writeBigInt64LE throws RangeError above these on Node and silently
// wraps modulo 2^64 in the browser (DataView.setBigInt64), so guard every int64 write.
const INT64_MIN = -(2n ** 63n);

const INT64_OVERFLOW = 2n ** 63n;


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
    lastSortedKeys: string[] | null;
    matchSchema: (obj: Record<string, unknown>) => Schema | null;
    registry: SchemaRegistry;
    revalidateCached: (obj: Record<string, unknown>, schema: Schema) => boolean;
    schemaCache: SchemaCache;
    setCache: (schema: Schema, obj: object) => void;
    store: PersistentStore | null;
    weakCache: WeakMap<object, Schema>;
};


function decodeSbc(dctx: DecodeContext, buf: Uint8Array, offset: number, end: number, depth: number): unknown {
    if (depth > 64) {
        throw new Error('Codec2: max decode depth exceeded');
    }

    if (offset >= end) {
        throw new Error('Codec2: empty buffer');
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

            if (offset + 5 + sLen > end) {
                throw new Error('Codec2: truncated string at offset ' + offset);
            }

            return readStr(buf, offset + 5, sLen);
        }

        case 6: {
            let bLen = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

            if (offset + 5 + bLen > end) {
                throw new Error('Codec2: truncated bytes at offset ' + offset);
            }

            // Always a plain Uint8Array COPY (README contract): constructor === Uint8Array,
            // no pooled Buffer aliasing into the source buffer, structuredClone-safe.
            return new Uint8Array(buf.subarray(offset + 5, offset + 5 + bLen));
        }

        case 7: {
            if (offset + 5 > end) {
                throw new Error('Codec2: truncated array at offset ' + offset);
            }

            let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

            if (count > MAX_ARRAY_COUNT) {
                throw new Error('Codec2: array count ' + count + ' exceeds limit');
            }

            let arr = new Array(count),
                p = offset + 5;

            for (let i = 0; i < count; i++) {
                let tagEnd = decodeTagEnd(buf, p, end, depth + 1);

                arr[i] = decodeSbc(dctx, buf, p, tagEnd, depth + 1);
                p = tagEnd;
            }

            return arr;
        }

        case 8: {
            if (offset + 9 > end) {
                throw new Error('Codec2: truncated tag-8/18 header');
            }

            let dataLen = (buf[offset + 5]! | (buf[offset + 6]! << 8) | (buf[offset + 7]! << 16) | (buf[offset + 8]! << 24)) >>> 0;

            if (offset + 9 + dataLen > end) {
                throw new Error('Codec2: truncated tag-8 object at offset ' + offset);
            }

            let hash = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0,
                schema = hash === dctx.lastDecodeHash && dctx.lastDecodeSchema
                    ? dctx.lastDecodeSchema
                    : (dctx.schemas.get(hash) ?? dctx.resolveSchema(hash));

            if (!schema || !schema.decodeFn) {
                throw new Error('Codec2: unknown schema hash ' + hash);
            }

            // lastDecodeFn must move with lastDecodeHash: decode()'s cross-call fast-path dispatches
            // dctx.lastDecodeFn whenever hash === lastDecodeHash. Leaving it stale here runs a prior
            // shape's decodeFn on this shape's bytes when decode() and decodeAt() interleave.
            dctx.lastDecodeFn = schema.decodeFn;
            dctx.lastDecodeHash = hash;
            dctx.lastDecodeSchema = schema;

            return schema.decodeFn(buf, offset + 9, depth + 1);
        }

        case 18: {
            if (offset + 9 > end) {
                throw new Error('Codec2: truncated tag-8/18 header');
            }

            let dataLen = (buf[offset + 5]! | (buf[offset + 6]! << 8) | (buf[offset + 7]! << 16) | (buf[offset + 8]! << 24)) >>> 0;

            if (offset + 9 + dataLen > end) {
                throw new Error('Codec2: truncated tag-18 object at offset ' + offset);
            }

            let hash = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0,
                schema = dctx.schemas.get(hash) ?? dctx.resolveSchema(hash);

            if (!schema) {
                throw new Error('Codec2: unknown schema hash ' + hash);
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
            // packed number[] — [12][u8 typeId][u32 byteLen][raw LE elements], tag 17's
            // payload layout decoded into a plain Array (never a TypedArray) at the classified width.
            if (offset + 6 > end) {
                throw new Error('Codec2: truncated packed array at offset ' + offset);
            }

            let typeId = buf[offset + 1]!,
                bpe = TYPED_ARRAY_BPE[typeId],
                packedLen = (buf[offset + 2]! | (buf[offset + 3]! << 8) | (buf[offset + 4]! << 16) | (buf[offset + 5]! << 24)) >>> 0;

            if (bpe === undefined) {
                throw new Error('Codec2: unknown packed array typeId ' + typeId);
            }

            if (packedLen % bpe !== 0) {
                throw new Error('Codec2: packed array byteLength not aligned');
            }

            let count = packedLen / bpe;

            if (count > MAX_ARRAY_COUNT) {
                throw new Error('Codec2: array count ' + count + ' exceeds limit');
            }

            if (offset + 6 + packedLen > end) {
                throw new Error('Codec2: truncated packed array at offset ' + offset);
            }

            let arr = new Array(count),
                p = offset + 6;

            switch (typeId) {
                case 1:
                    for (let i = 0; i < count; i++) {
                        arr[i] = readF64.call(buf, p);
                        p += 8;
                    }
                    break;
                case 2:
                    for (let i = 0; i < count; i++) {
                        arr[i] = (buf[p]! << 24) >> 24;
                        p += 1;
                    }
                    break;
                case 3:
                    for (let i = 0; i < count; i++) {
                        arr[i] = ((buf[p]! | (buf[p + 1]! << 8)) << 16) >> 16;
                        p += 2;
                    }
                    break;
                case 4:
                    for (let i = 0; i < count; i++) {
                        arr[i] = (buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16) | (buf[p + 3]! << 24)) | 0;
                        p += 4;
                    }
                    break;
                case 5:
                case 6:
                    for (let i = 0; i < count; i++) {
                        arr[i] = buf[p]!;
                        p += 1;
                    }
                    break;
                case 7:
                    for (let i = 0; i < count; i++) {
                        arr[i] = buf[p]! | (buf[p + 1]! << 8);
                        p += 2;
                    }
                    break;
                case 8:
                    for (let i = 0; i < count; i++) {
                        arr[i] = (buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16) | (buf[p + 3]! << 24)) >>> 0;
                        p += 4;
                    }
                    break;
                default:
                    throw new Error('Codec2: unsupported packed array typeId ' + typeId);
            }

            return arr;
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

            if (offset + 6 + bLen > end) {
                throw new Error('Codec2: truncated typed array at offset ' + offset);
            }

            // Bounds check above confines [start, start + bLen) to the view window, so
            // the copy never reaches adjacent bytes sharing the backing ArrayBuffer.
            let start = buf.byteOffset + offset + 6,
                copied = buf.buffer.slice(start, start + bLen) as ArrayBuffer;

            return new (Ctor as new (buf: ArrayBuffer, off: number, len: number) => ArrayBufferView)(copied, 0, bLen / bpe);
        }

        default:
            throw new Error('Codec2: unknown tag ' + tag + ' at offset ' + offset);
    }
}


function decodeTagEnd(buf: Uint8Array, offset: number, end: number, depth: number): number {
    if (depth > 64) {
        throw new Error('Codec2: max decode depth exceeded');
    }

    if (offset >= end) {
        throw new Error('Codec2: empty buffer');
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

            if (offset + 5 + sLen > end) {
                throw new Error('Codec2: truncated string at offset ' + offset);
            }

            return offset + 5 + sLen;
        }
        case 6: {
            let bLen = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

            if (offset + 5 + bLen > end) {
                throw new Error('Codec2: truncated bytes at offset ' + offset);
            }

            return offset + 5 + bLen;
        }
        case 7: {
            if (offset + 5 > end) {
                throw new Error('Codec2: truncated array at offset ' + offset);
            }

            let count = (buf[offset + 1]! | (buf[offset + 2]! << 8) | (buf[offset + 3]! << 16) | (buf[offset + 4]! << 24)) >>> 0;

            if (count > MAX_ARRAY_COUNT) {
                throw new Error('Codec2: array count ' + count + ' exceeds limit');
            }

            let p = offset + 5;

            for (let i = 0; i < count; i++) {
                p = decodeTagEnd(buf, p, end, depth + 1);
            }

            return p;
        }
        case 8: case 18: {
            if (offset + 9 > end) {
                throw new Error('Codec2: truncated tag-8/18 header');
            }

            let dataLen = (buf[offset + 5]! | (buf[offset + 6]! << 8) | (buf[offset + 7]! << 16) | (buf[offset + 8]! << 24)) >>> 0;

            if (offset + 9 + dataLen > end) {
                throw new Error('Codec2: truncated tag-8/18 object at offset ' + offset);
            }

            return offset + 9 + dataLen;
        }
        case 11:
            return offset + 5;
        case 12: {
            if (offset + 6 > end) {
                throw new Error('Codec2: truncated packed array at offset ' + offset);
            }

            let packedLen = (buf[offset + 2]! | (buf[offset + 3]! << 8) | (buf[offset + 4]! << 16) | (buf[offset + 5]! << 24)) >>> 0;

            if (offset + 6 + packedLen > end) {
                throw new Error('Codec2: truncated packed array at offset ' + offset);
            }

            return offset + 6 + packedLen;
        }
        case 17: {
            let bLen = (buf[offset + 2]! | (buf[offset + 3]! << 8) | (buf[offset + 4]! << 16) | (buf[offset + 5]! << 24)) >>> 0;

            if (offset + 6 + bLen > end) {
                throw new Error('Codec2: truncated typed array at offset ' + offset);
            }

            return offset + 6 + bLen;
        }
        default:
            throw new Error('Codec2: unknown tag ' + tag + ' at offset ' + offset);
    }
}


function unrepresentable(value: unknown): never {
    let ctor = value == null ? undefined : (value as { constructor?: { name?: string } }).constructor;

    throw new Error('Codec2: unrepresentable value of type ' + (ctor?.name ?? typeof value));
}


function encodeSbc(ectx: EncodeContext, value: unknown, buf: Uint8Array, pos: number): number {
    if (value === null || value === undefined) {
        buf[pos] = 0;
        return pos + 1;
    }

    switch (typeof value) {
        case 'bigint':
            if (value < INT64_MIN || value >= INT64_OVERFLOW) {
                throw new Error('Codec2: bigint out of int64 range');
            }

            buf[pos] = 9;
            if (pos + 9 <= buf.length) {
                writeBI64.call(buf, value, pos + 1);
            }
            return pos + 9;

        case 'boolean':
            buf[pos] = value ? 2 : 1;
            return pos + 1;

        case 'number': {
            let n = value as number;

            if (Number.isInteger(n) && !Object.is(n, -0)) {
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
            if (pos + 9 <= buf.length) {
                writeF64.call(buf, n, pos + 1);
            }
            return pos + 9;
        }

        case 'string': {
            let sl = (value as string).length;

            buf[pos] = 5;

            // Single-pass ASCII fast path: write + validate simultaneously
            if (sl < 17) {
                let ascii = true,
                    p = pos + 5;

                for (let k = 0; k < sl; k++) {
                    let c = (value as string).charCodeAt(k);

                    if (c > 127) {
                        ascii = false;
                        break;
                    }

                    buf[p + k] = c;
                }

                if (ascii) {
                    buf[pos + 1] = sl;
                    buf[pos + 2] = 0;
                    buf[pos + 3] = 0;
                    buf[pos + 4] = 0;

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
                if (pos + 9 <= buf.length) {
                    writeF64.call(buf, value.getTime(), pos + 1);
                }
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
                    unrepresentable(value);
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
                    let src = ta instanceof Uint8Array ? ta : new Uint8Array(ta.buffer, ta.byteOffset, bLen);

                    buf.set(src, pos + 6);
                }

                return needed;
            }

            if (Array.isArray(value)) {
                let len = value.length;

                if (len > 0 && typeof value[0] === 'number') {
                    // Packed number[] → tag 17's payload layout: [12][u8 typeId][u32 byteLen][raw LE
                    // elements], one shared classifier picking the narrowest lossless width.
                    let typeId = classifyPackedArray(value as number[]);

                    if (typeId !== -1) {
                        let bpe = TYPED_ARRAY_BPE[typeId]!,
                            packedLen = len * bpe,
                            needed = pos + 6 + packedLen;

                        buf[pos] = 12;
                        buf[pos + 1] = typeId;
                        buf[pos + 2] = packedLen & 0xFF;
                        buf[pos + 3] = (packedLen >>> 8) & 0xFF;
                        buf[pos + 4] = (packedLen >>> 16) & 0xFF;
                        buf[pos + 5] = (packedLen >>> 24) & 0xFF;

                        if (needed <= buf.length) {
                            let p = pos + 6;

                            switch (typeId) {
                                case 1:
                                    for (let i = 0; i < len; i++) {
                                        writeF64.call(buf, value[i], p);
                                        p += 8;
                                    }
                                    break;
                                case 2:
                                case 5:
                                case 6:
                                    for (let i = 0; i < len; i++) {
                                        buf[p] = value[i] & 0xFF;
                                        p += 1;
                                    }
                                    break;
                                case 3:
                                case 7:
                                    for (let i = 0; i < len; i++) {
                                        let v = value[i];

                                        buf[p] = v & 0xFF;
                                        buf[p + 1] = (v >>> 8) & 0xFF;
                                        p += 2;
                                    }
                                    break;
                                case 4:
                                case 8:
                                    for (let i = 0; i < len; i++) {
                                        let v = value[i];

                                        buf[p] = v & 0xFF;
                                        buf[p + 1] = (v >>> 8) & 0xFF;
                                        buf[p + 2] = (v >>> 16) & 0xFF;
                                        buf[p + 3] = (v >>> 24) & 0xFF;
                                        p += 4;
                                    }
                                    break;
                            }
                        }

                        return needed;
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

            // Runtime backstop for the Encodable constraint: reject any object that is
            // not a plain record (Map, Set, WeakMap, RegExp, Promise, class instances).
            // The TypeScript constraint is the primary gate; this catches `any`-typed and
            // plain-JS call sites the compiler never saw.
            let ctor = (value as { constructor?: unknown }).constructor;

            if (ctor !== Object && ctor !== undefined) {
                unrepresentable(value);
            }

            // Plain object → schema-compiled path
            let obj = value as Record<string, unknown>,
                schema = ectx.weakCache.get(obj) ?? null;

            if (schema && !ectx.revalidateCached(obj, schema)) {
                schema = null;
            }

            if (!schema) {
                schema = ectx.matchSchema(obj);

                if (!schema) {
                    schema = inferAndRegister(obj, ectx.registry, ectx.helpers, ectx.store, ectx.schemaCache, ectx.lastSortedKeys ?? undefined);
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

        case 'function':
        case 'symbol':
            return unrepresentable(value);

        default:
            return unrepresentable(value);
    }
}


export { decodeSbc, decodeTagEnd, encodeSbc };
export type { DecodeContext, EncodeContext };
