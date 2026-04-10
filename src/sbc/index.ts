// Codec2 — High-performance binary codec
// JIT-compiled per-shape encode/decode, zero per-field branching at runtime

import { FIELD_NAME_RE, FIELD_SIZES } from './constants';
import { compileSchema } from './codegen';
import { extractField } from './extract';
import { allocBuf, allocUnsafe, copyBuf } from './platform';
import { deserializeRegistry, serializeRegistry } from './registry';
import { computeNameHash, computeShapeHash, inferAndRegister, inferType, parseFieldType } from './schema';
import { computeSize } from './size';
import { decodeSbc, decodeTagEnd, encodeSbc } from './tagged';

import type { CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, SchemaRegistry } from './types';
import type { DecodeContext, EncodeContext } from './tagged';
import type { ExtractContext } from './extract';
import type { SizeContext } from './size';
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
    let cacheCounts: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        cacheFields: (FieldDef[] | null)[] = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
        cacheIdx = 0,
        cacheSchemas: (Schema | null)[] = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
        lastSortedKeys: string[] | null = null,
        typedSchemaFieldCounts = new Set<number>(),
        typedSchemas = new Map<number, Schema>(),  // nameHash → schema for defineSchema with structural types
        weakCache = new WeakMap<object, Schema>();

    function setCache(schema: Schema, obj: object): void {
        cacheSchemas[cacheIdx] = schema;
        cacheFields[cacheIdx] = schema.fields;
        cacheCounts[cacheIdx] = schema.fields.length;
        cacheIdx = (cacheIdx + 1) & 15;
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

    // Specialized object encoder — skips typeof/instanceof checks for known-object fields
    function encodeObj(obj: Record<string, unknown>, buf: Uint8Array, pos: number): number {
        let schema = weakCache.get(obj) ?? null;

        if (!schema) {
            schema = matchSchema(obj);

            if (!schema) {
                schema = inferAndRegister(obj, registry, helpers, store, lastSortedKeys ?? undefined);
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

    // Decode context — mutable slots for decode cache, shared with tagged.ts
    let dctx: DecodeContext = {
        compress,
        lastDecodeFn: null,
        lastDecodeHash: 0,
        lastDecodeSchema: null,
        resolveSchema: resolveSchemaFromCacheOrStore,
        schemas: registry.schemas,
        setCache,
    };

    // Encode context — mutable slots for encode cache, shared with tagged.ts
    let ectx: EncodeContext = {
        compress,
        helpers: null as unknown as SbcHelpers,
        lastSortedKeys: null,
        matchSchema,
        registry,
        setCache,
        store,
        weakCache,
    };

    // Bound wrappers — close over dctx/ectx so call sites keep the original 4/3-arg signature
    let boundDecodeSbc = (buf: Uint8Array, offset: number, len: number, depth: number) => decodeSbc(dctx, buf, offset, len, depth),
        boundDecodeTagEnd = decodeTagEnd,
        boundEncodeSbc = (value: unknown, buf: Uint8Array, pos: number) => encodeSbc(ectx, value, buf, pos);

    let helpers: SbcHelpers = {
        decodeSbc: boundDecodeSbc,
        decodeTagEnd: boundDecodeTagEnd,
        encodeObj,
        encodeSbc: boundEncodeSbc,
        lookupSchema: resolveSchemaFromCacheOrStore,
        registry: registry.schemas,
    };

    // Wire helpers into ectx after construction (circular ref)
    ectx.helpers = helpers;


    function matchSchema(obj: Record<string, unknown>): Schema | null {
        // Ring buffer cache — match on key names AND value types
        lastSortedKeys = null;
        ectx.lastSortedKeys = null;

        let keyCount = 0;

        for (let _ in obj) { keyCount++; }

        for (let i = 0; i < 16; i++) {
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

            lastSortedKeys = sortedKeys;
            ectx.lastSortedKeys = sortedKeys;

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
                    dctx.lastDecodeHash = bufHash;
                    dctx.lastDecodeFn = null;
                    dctx.lastDecodeSchema = hintSchema;

                    if (tag === 18 && hintSchema.compressedDecodeFn) {
                        return hintSchema.compressedDecodeFn(buffer, 9, 0);
                    }

                    if (hintSchema.decodeFn) {
                        dctx.lastDecodeFn = hintSchema.decodeFn;

                        return hintSchema.decodeFn(buffer, 9, 0);
                    }
                }
            }
            // Hash mismatch or non-object tag — fall through to normal decode
        }

        // Fast path: tag 8 (uncompressed object) — hottest path, minimize overhead
        if (buffer[0] === 8 && len >= 9 && len === buffer.length) {
            let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0;

            if (hash === dctx.lastDecodeHash && dctx.lastDecodeFn) {
                return dctx.lastDecodeFn(buffer, 9, 0);
            }

            let schema = registry.schemas.get(hash) ?? resolveSchemaFromCacheOrStore(hash);

            if (schema && schema.decodeFn) {
                dctx.lastDecodeHash = hash;
                dctx.lastDecodeFn = schema.decodeFn;
                dctx.lastDecodeSchema = schema;

                return schema.decodeFn(buffer, 9, 0);
            }
        }

        // Tag 18 (compressed object) fast path
        if (buffer[0] === 18 && len >= 9 && len === buffer.length) {
            let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0,
                schema = hash === dctx.lastDecodeHash && dctx.lastDecodeSchema
                    ? dctx.lastDecodeSchema
                    : (registry.schemas.get(hash) ?? resolveSchemaFromCacheOrStore(hash));

            if (schema) {
                dctx.lastDecodeHash = hash;
                dctx.lastDecodeFn = null;
                dctx.lastDecodeSchema = schema;

                if (schema.compressedDecodeFn) {
                    return schema.compressedDecodeFn(buffer, 9, 0);
                }

                if (schema.decodeFn) {
                    return schema.decodeFn(buffer, 9, 0);
                }
            }
        }

        return boundDecodeSbc(buffer, 0, len, 0);
    }


    // Retry-on-overflow wrappers — catch RangeError from JIT-compiled encoders
    // and tagged encoder, grow the buffer, and retry until it fits.
    function tryEncode(fn: (obj: unknown, buf: Uint8Array, pos: number) => number, obj: unknown, pos: number): number {
        while (true) {
            try {
                let end = fn(obj, encodeBuf, pos);

                if (end <= encodeBuf.length) {
                    return end;
                }

                encodeBuf = allocBuf(Math.max(end, encodeBuf.length) * 2);
            }
            catch (e) {
                if (!(e instanceof RangeError)) {
                    throw e;
                }

                encodeBuf = allocBuf(encodeBuf.length * 2);
            }
        }
    }

    function tryEncodeSbc(value: unknown, pos: number): number {
        while (true) {
            try {
                let end = boundEncodeSbc(value, encodeBuf, pos);

                if (end <= encodeBuf.length) {
                    return end;
                }

                encodeBuf = allocBuf(Math.max(end, encodeBuf.length) * 2);
            }
            catch (e) {
                if (!(e instanceof RangeError)) {
                    throw e;
                }

                encodeBuf = allocBuf(encodeBuf.length * 2);
            }
        }
    }


    function encodeObject(schema: Schema, obj: Record<string, unknown>, view: boolean): Uint8Array {
        let end: number,
            h = schema.hash,
            useCompressed = compress && schema.compressible && schema.compressedEncodeFn;

        if (useCompressed) {
            end = tryEncode(schema.compressedEncodeFn!, obj, 9);
            encodeBuf[0] = 18;
        }
        else {
            end = tryEncode(schema.encodeFn!, obj, 9);
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
                    schema = inferAndRegister(obj, registry, helpers, store, lastSortedKeys ?? undefined);
                }

                setCache(schema, obj);
            }

            return encodeObject(schema, obj, view);
        }

        // Generic path
        let end = tryEncodeSbc(value, 0);

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

            return boundDecodeSbc(buffer, offset, 9 + dataLen, 0);
        }

        let end = decodeTagEnd(buffer, offset, 0);

        return boundDecodeSbc(buffer, offset, end - offset, 0);
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


    // Extract context — threads closure state to extractField
    let extractCtx: ExtractContext = {
        decode,
        decodeSbc: boundDecodeSbc,
        schemas: registry.schemas,
    };

    // Size context — threads closure state to computeSize
    let sizeCtx: SizeContext = {
        helpers: null as unknown as SbcHelpers,
        matchSchema,
        registry,
        setCache,
        store,
        weakCache,
    };

    // Wire helpers into sizeCtx after construction (circular ref)
    sizeCtx.helpers = helpers;


    return {
        computeSize: (value: unknown) => computeSize(sizeCtx, value),
        decode,
        decodeAt,
        defineSchema,
        deserializeRegistry: (data: Uint8Array) => deserializeRegistry(data, defineSchema, registry.schemas),
        encode,
        extractField: (buffer: Uint8Array, fieldName: string) => extractField(extractCtx, buffer, fieldName),
        serializeRegistry: () => serializeRegistry(registry.schemas),
    };
};


export { codec };
export type { CodecOptions, DecodeOptions, EncodeOptions, FieldSpec, PersistentStore, SchemaRegistry } from './types';
export type { Schema } from './codegen';
export type { StoredSchema } from './cache';
