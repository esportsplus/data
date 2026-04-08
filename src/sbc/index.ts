// Schema Binary Codec (SBC) — Zero-overhead value encoding
// Tag 246: hash-referenced objects stored with central schema DB
// Primitives: tags 248-254 (self-describing, no schema needed)

import { encodeTypedArrayInto } from '~/typed-array-codec';

import { compileCompressedDecoder, compileCompressedEncoder, compileSchema } from './codegen';
import { allocBuf, allocUnsafe, byteLen, copyBuf, isNode, readBI64, readF64, readU16, readU32, readUtf8, writeBI64, writeF64, writeU16, writeU32, writeUtf8 } from './platform';
import { createRegistry, inferSchema, lookupSchema, registerSchema } from './registry';

import type { InternPool, Schema, SchemaStoreInterface } from './platform';


const createCodec = (schemaStore?: SchemaStoreInterface, options?: { compression?: boolean }, internPool?: InternPool): { decode(buffer: Uint8Array, length?: number): unknown; decodeAt(buffer: Uint8Array, offset: number): unknown; encode(value: unknown): Uint8Array; extractField(buffer: Uint8Array, fieldName: string, length?: number): unknown } => {
    let compression = options?.compression ?? false,
        encodeBuf = allocBuf(65536),
        registry = createRegistry(),
        sbcHelpers = {
            decodeSbc: (buf: Uint8Array, offset: number, len: number): unknown => decodeSbc(buf, offset, len),
            encodeSbc: (value: unknown, buf: Uint8Array, pos: number): number => encodeSbc(value, buf, pos),
        };

    let cachedCtorSchema = new Map<Function, Schema>(),
        internDecode = internPool?.decode,
        internEncode = internPool?.encode,
        internFieldSet = internPool?.fields;

    // Wire helpers into schema store so compiled decoders can call decodeSbc/encodeSbc
    if (schemaStore?._setHelpers) {
        schemaStore._setHelpers(sbcHelpers);
    }

    // Wire intern pool into schema store so schemas loaded from DB get intern-aware compile
    if (schemaStore && internPool && schemaStore._setIntern) {
        schemaStore._setIntern(internPool);
    }

    // Tag table:
    // 0 = null, 246 = hash-referenced object, 248 = bigint,
    // 249 = array, 250 = date, 251 = boolean, 252 = number,
    // 253 = string, 254 = bytes (Uint8Array)

    function decodeSbc(buf: Uint8Array, offset: number, len: number): unknown {
        if (len === 0) {
            return undefined;
        }

        let bufLen = buf.length,
            tag = buf[offset]!;

        switch (tag) {
            case 0:
                return null;

            case 248:
                if (offset + 9 > bufLen) {
                    throw new RangeError('SBC: bigint tag extends beyond buffer');
                }

                return readBI64.call(buf, offset + 1);

            case 249: {
                if (offset + 3 > bufLen) {
                    throw new RangeError('SBC: array header extends beyond buffer');
                }

                let count = readU16.call(buf, offset + 1),
                    arr = new Array(count),
                    p = offset + 3;

                for (let i = 0; i < count; i++) {
                    if (p >= bufLen) {
                        throw new RangeError('SBC: array element extends beyond buffer');
                    }

                    let elemTag = buf[p]!,
                        elemEnd = decodeTagEnd(buf, p, elemTag);

                    if (elemEnd > bufLen) {
                        throw new RangeError('SBC: array element extends beyond buffer');
                    }

                    arr[i] = decodeSbc(buf, p, elemEnd - p);
                    p = elemEnd;
                }

                return arr;
            }

            case 250:
                if (offset + 9 > bufLen) {
                    throw new RangeError('SBC: date tag extends beyond buffer');
                }

                return new Date(readF64.call(buf, offset + 1));

            case 251:
                if (offset + 2 > bufLen) {
                    throw new RangeError('SBC: boolean tag extends beyond buffer');
                }

                return !!buf[offset + 1];

            case 252:
                if (offset + 9 > bufLen) {
                    throw new RangeError('SBC: number tag extends beyond buffer');
                }

                return readF64.call(buf, offset + 1);

            case 253: {
                if (offset + 5 > bufLen) {
                    throw new RangeError('SBC: string header extends beyond buffer');
                }

                let sLen = readU32.call(buf, offset + 1);

                if (offset + 5 + sLen > bufLen) {
                    throw new RangeError('SBC: string data extends beyond buffer');
                }

                return readUtf8.call(buf, offset + 5, offset + 5 + sLen);
            }

            case 254: {
                if (offset + 5 > bufLen) {
                    throw new RangeError('SBC: bytes header extends beyond buffer');
                }

                let bLen = readU32.call(buf, offset + 1);

                if (offset + 5 + bLen > bufLen) {
                    throw new RangeError('SBC: bytes data extends beyond buffer');
                }

                let slice = buf.subarray(offset + 5, offset + 5 + bLen);

                if (isNode) {
                    return Buffer.from(slice);
                }

                return new Uint8Array(slice);
            }

            case 245: {
                // Compressed hash-referenced object: [245][u32 hash][u32 len][compressed_field_values...]
                let hash = readU32.call(buf, offset + 1),
                    schema = schemaStore ? schemaStore.get(hash) : registry.schemasByHash.get(hash);

                if (!schema) {
                    return null;
                }

                if (schema.compressedDecodeFn) {
                    return schema.compressedDecodeFn(buf, offset + 9);
                }

                // Compressed data but no compressed decoder compiled — compile on demand
                if (schema.compressible) {
                    schema.compressedDecodeFn = compileCompressedDecoder(schema, sbcHelpers, internFieldSet, internDecode);
                    schema.compressedEncodeFn = compileCompressedEncoder(schema, sbcHelpers, internFieldSet, internEncode);

                    return schema.compressedDecodeFn(buf, offset + 9);
                }

                return null;
            }

            case 246: {
                // Hash-referenced object: [246][u32 hash][u32 len][field_values...]
                let hash = readU32.call(buf, offset + 1),
                    schema = schemaStore ? schemaStore.get(hash) : registry.schemasByHash.get(hash);

                if (!schema || !schema.decodeFn) {
                    return null;
                }

                return schema.decodeFn(buf, offset + 9);
            }

            default:
                return null;
        }
    }

    function decodeTagEnd(buf: Uint8Array, offset: number, tag: number, depth: number = 0): number {
        if (depth > 128) {
            throw new RangeError('SBC: decode nesting depth exceeds 128');
        }

        switch (tag) {
            case 0: return offset + 1;
            case 245: {
                let end = offset + 9 + readU32.call(buf, offset + 5);
                if (end > buf.length) throw new RangeError('SBC: tag length extends beyond buffer');
                return end;
            }
            case 248: return offset + 9;
            case 250: return offset + 9;
            case 251: return offset + 2;
            case 252: return offset + 9;
            case 253: {
                let end = offset + 5 + readU32.call(buf, offset + 1);
                if (end > buf.length) throw new RangeError('SBC: tag length extends beyond buffer');
                return end;
            }
            case 254: {
                let end = offset + 5 + readU32.call(buf, offset + 1);
                if (end > buf.length) throw new RangeError('SBC: tag length extends beyond buffer');
                return end;
            }
            case 246: {
                let end = offset + 9 + readU32.call(buf, offset + 5);
                if (end > buf.length) throw new RangeError('SBC: tag length extends beyond buffer');
                return end;
            }
            case 249: {
                let count = readU16.call(buf, offset + 1),
                    p = offset + 3;

                for (let i = 0; i < count; i++) {
                    p = decodeTagEnd(buf, p, buf[p]!, depth + 1);
                }

                return p;
            }
            default:
                throw new RangeError('SBC: unknown tag ' + tag + ' at offset ' + offset);
        }
    }

    function encodeSbc(value: unknown, buf: Uint8Array, pos: number, depth: number = 0): number {
        if (value === null || value === undefined) {
            buf[pos] = 0;

            return pos + 1;
        }

        switch (typeof value) {
            case 'bigint':
                buf[pos] = 248;
                writeBI64.call(buf, value, pos + 1);

                return pos + 9;

            case 'boolean':
                buf[pos] = 251;
                buf[pos + 1] = value ? 1 : 0;

                return pos + 2;

            case 'number':
                buf[pos] = 252;
                writeF64.call(buf, value, pos + 1);

                return pos + 9;

            case 'string': {
                let sLen = byteLen(value),
                    end = pos + 5 + sLen;

                if (end > buf.length) {
                    return end;
                }

                buf[pos] = 253;
                writeU32.call(buf, sLen, pos + 1);
                writeUtf8.call(buf, value, pos + 5, sLen);

                return end;
            }

            case 'object': {
                if (depth > 128) {
                    throw new RangeError('SBC: encode nesting depth exceeds 128');
                }

                if (value instanceof Date) {
                    buf[pos] = 250;
                    writeF64.call(buf, value.getTime(), pos + 1);

                    return pos + 9;
                }

                // Typed arrays (Float32Array, Int16Array, etc.) — encode with typed-array-codec header
                // The get() path checks for TYPED_ARRAY_MARKER before calling SBC decode
                if (ArrayBuffer.isView(value) && !(value instanceof DataView) && !(value instanceof Uint8Array)) {
                    let end = encodeTypedArrayInto(value, buf, pos);

                    if (end !== -1) {
                        return end;
                    }
                }

                if (value instanceof Uint8Array) {
                    let end = pos + 5 + value.length;

                    if (end > buf.length) {
                        return end;
                    }

                    buf[pos] = 254;
                    writeU32.call(buf, value.length, pos + 1);
                    buf.set(value, pos + 5);

                    return end;
                }

                if (Array.isArray(value)) {
                    if (value.length > 0xFFFF) {
                        throw new RangeError('SBC: array length exceeds u16 limit: ' + value.length);
                    }

                    buf[pos] = 249;
                    writeU16.call(buf, value.length, pos + 1);

                    let p = pos + 3;

                    for (let i = 0, n = value.length; i < n; i++) {
                        p = encodeSbc(value[i], buf, p, depth + 1);
                    }

                    return p;
                }

                // Map → encode as array of [key, value] pairs (preserves all key types)
                if (value instanceof Map) {
                    let map = value as Map<unknown, unknown>;

                    if (map.size > 0xFFFF) {
                        throw new RangeError('SBC: map size exceeds u16 limit: ' + map.size);
                    }

                    buf[pos] = 249;
                    writeU16.call(buf, map.size, pos + 1);

                    let p = pos + 3;

                    for (let [k, v] of map) {
                        // Each entry as a 2-element array [key, value]
                        buf[p] = 249;
                        writeU16.call(buf, 2, p + 1);
                        p += 3;
                        p = encodeSbc(k, buf, p, depth + 1);
                        p = encodeSbc(v, buf, p, depth + 1);
                    }

                    return p;
                }

                // Set → encode as array
                if (value instanceof Set) {
                    let set = value as Set<unknown>;

                    if (set.size > 0xFFFF) {
                        throw new RangeError('SBC: set size exceeds u16 limit: ' + set.size);
                    }

                    buf[pos] = 249;
                    writeU16.call(buf, set.size, pos + 1);

                    let p = pos + 3;

                    for (let item of set) {
                        p = encodeSbc(item, buf, p, depth + 1);
                    }

                    return p;
                }

                // Plain object — hash-referenced (tag 246)
                // Wire: [246][u32 hash][u32 len][field_values...]
                let obj = value as Record<string, unknown>,
                    keysOut: string[][] = [],
                    schema = (obj.constructor !== Object && obj.constructor !== undefined && cachedCtorSchema.get(obj.constructor as Function)) || lookupSchema(obj, registry, keysOut);

                if (!schema) {
                    schema = inferSchema(obj, registry, keysOut[0]);
                    registerSchema(schema, registry);
                    compileSchema(schema, registry, sbcHelpers, compression, internFieldSet, internEncode, internDecode, lookupSchema);

                    if (schemaStore) {
                        schemaStore.register(schema.hash, schema);
                    }
                }

                // Use compressed path if available
                if (compression && schema.compressedEncodeFn) {
                    buf[pos] = 245;
                    writeU32.call(buf, schema.hash, pos + 1);

                    let end = schema.compressedEncodeFn(obj, buf, pos + 9);

                    writeU32.call(buf, end - pos - 9, pos + 5);

                    return end;
                }

                // Pre-check: if schema can compute exact size, verify buffer has room
                if (schema.computeSize) {
                    let needed = schema.computeSize(obj);

                    if (needed > 0 && pos + needed > buf.length) {
                        return pos + needed;
                    }
                }

                buf[pos] = 246;
                writeU32.call(buf, schema.hash, pos + 1);

                let end = schema.encodeFn!(obj, buf, pos + 9);

                writeU32.call(buf, end - pos - 9, pos + 5);

                return end;
            }

            default:
                buf[pos] = 0;

                return pos + 1;
        }
    }

    function encodeValue(value: unknown): Uint8Array {
        // Fast path: schema-compiled object with known size (non-compressed only)
        if (!compression && value !== null && value !== undefined && typeof value === 'object'
            && !(value instanceof Date) && !Array.isArray(value)
            && !(value instanceof Map) && !(value instanceof Set)
            && !ArrayBuffer.isView(value)) {

            let obj = value as Record<string, unknown>,
                schema = lookupSchema(obj, registry);

            if (schema && obj.constructor !== Object && obj.constructor !== undefined) {
                cachedCtorSchema.set(obj.constructor as Function, schema);
            }

            if (schema?.computeSize && schema.encodeFn) {
                let size = schema.computeSize(obj);

                if (size > 0) {
                    let result = allocUnsafe(size);

                    result[0] = 246;
                    writeU32.call(result, schema.hash, 1);

                    let end = schema.encodeFn(obj, result, 9);

                    writeU32.call(result, end - 9, 5);

                    return result;
                }
            }
        }

        // Fast path: fixed-size primitives — encode directly, no scratch buffer needed
        if (value === null || value === undefined) {
            let p = allocUnsafe(1);

            p[0] = 0;

            return p;
        }

        let vtype = typeof value;

        if (vtype === 'boolean') {
            let p = allocUnsafe(2);

            p[0] = 251;
            p[1] = (value as boolean) ? 1 : 0;

            return p;
        }

        if (vtype === 'number') {
            let p = allocUnsafe(9);

            p[0] = 252;
            writeF64.call(p, value as number, 1);

            return p;
        }

        if (vtype === 'bigint') {
            let p = allocUnsafe(9);

            p[0] = 248;
            writeBI64.call(p, value as bigint, 1);

            return p;
        }

        // Slow path: variable-length types, nested objects, compressed, unknown schema
        let end = encodeSbc(value, encodeBuf, 0);

        while (end > encodeBuf.length) {
            encodeBuf = allocBuf(Math.max(end, encodeBuf.length) * 2);
            end = encodeSbc(value, encodeBuf, 0);
        }

        let result = allocUnsafe(end);

        copyBuf(encodeBuf, result, 0, 0, end);

        return result;
    }

    return {
        decode(buffer: Uint8Array, length?: number): unknown {
            let len = length ?? buffer.length;

            if (len < buffer.length) {
                buffer = buffer.subarray(0, len);
            }

            if (len >= 9 && (buffer[0] === 245 || buffer[0] === 246)) {
                let hash = readU32.call(buffer, 1),
                    schema = schemaStore ? schemaStore.getCached(hash) : registry.schemasByHash.get(hash);

                if (schema) {
                    if (buffer[0] === 245 && schema.compressedDecodeFn) {
                        return schema.compressedDecodeFn(buffer, 9);
                    }

                    if (schema.decodeFn) {
                        return schema.decodeFn(buffer, 9);
                    }

                    return decodeSbc(buffer, 0, len);
                }
            }

            if (len > 0 && buffer[0] !== 245 && buffer[0] !== 246) {
                // Primitive — no schema involvement, no clobbering risk
                return decodeSbc(buffer, 0, len);
            }

            // Slow path: schema not in cache, need DB lookup (may clobber buffer)
            let buf = allocUnsafe(len);

            if (isNode) {
                let src = buffer instanceof Buffer ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, len);

                src.copy(buf as Buffer, 0, 0, len);
            }
            else {
                buf.set(buffer.subarray(0, len));
            }

            return decodeSbc(buf, 0, len);
        },

        decodeAt(buffer: Uint8Array, offset: number): unknown {
            let tag = buffer[offset]!,
                len = (tag === 245 || tag === 246) ? 9 + readU32.call(buffer, offset + 5) : decodeTagEnd(buffer, offset, tag) - offset;

            return decodeSbc(buffer, offset, len);
        },

        encode: encodeValue,

        extractField(buffer: Uint8Array, fieldName: string, length?: number): unknown {
            let len = length ?? buffer.length;

            // Only uncompressed schema objects (tag 246) support field extraction
            // Tag 245 = compressed — can't extract without full decompression
            if (len < 9 || buffer[0] !== 246) {
                return undefined;
            }

            let hash = readU32.call(buffer, 1),
                schema = schemaStore?.get(hash) ?? registry.schemasByHash.get(hash);

            if (!schema?.fieldExtractors) {
                return undefined;
            }

            // Account for null bitmap bytes between header and field data
            let bitmapBytes = schema.nullableCount > 0 ? Math.ceil(schema.nullableCount / 8) : 0;

            // Check if target field is nullable and currently null (before extractor lookup)
            if (bitmapBytes > 0) {
                for (let i = 0, n = schema.fields.length; i < n; i++) {
                    let field = schema.fields[i]!;

                    if (field.name === fieldName && field._nullIndex !== undefined) {
                        let bitMask = 1 << (field._nullIndex & 7);

                        // Bit NOT set means field is null
                        if (!(buffer[9 + (field._nullIndex >> 3)]! & bitMask)) {
                            return null;
                        }

                        break;
                    }
                }
            }

            let extractor = schema.fieldExtractors.get(fieldName);

            if (!extractor) {
                return undefined;
            }

            // Fields start at offset 9 + bitmapBytes (past tag+hash+len header + null bitmap)
            return extractor(buffer, 9 + bitmapBytes);
        },
    };
};


export { createCodec };
export { buildSchema, compileSchema, validateFieldTypeString } from './codegen';
export { createInternPool, createRegistry, createSchemaStore, decodeFieldDefs, deserializeRegistry, inferFieldType, inferSchema, lookupSchema, parseFieldType, registerSchema, resolveSchema, serializeFieldType, serializeRegistry } from './registry';

export type { ArrayFieldType, FieldDef, FieldType, InternDb, InternPool, NullableFieldType, ObjectFieldType, Schema, SchemaRegistry, SchemaStoreInterface } from './platform';
