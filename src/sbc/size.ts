// Size computation — compute the exact encoded byte size without encoding.
// Total over encode's domain: computeSize(v) === encode(v).length for every v encode accepts,
// and computeSize(v) throws the matching Codec2 error for every v encode rejects. Layouts are
// mirrored from the encoders (src/sbc/tagged.ts encodeSbc, src/sbc/codegen.ts compileEncoder /
// compileCompressedEncoder); state is threaded via SizeContext.

import { FIELD_SIZES } from './constants';
import { INT64_MIN, INT64_OVERFLOW } from './constants';
import { byteLen, classifyPackedArray, TYPED_ARRAY_BPE, TYPED_ARRAY_IDS, zigzagEncode } from './platform';
import { unrepresentable } from './tagged';
import { inferAndRegister, varintSize } from './schema';

import type { SchemaCache } from './cache';
import type { FieldDef, Schema, SbcHelpers } from './codegen';
import type { PersistentStore, SchemaRegistry } from './types';


type SizeContext = {
    compress: boolean;
    helpers: SbcHelpers;
    matchSchema(obj: Record<string, unknown>): Schema | null;
    registry: SchemaRegistry;
    revalidateCached(obj: Record<string, unknown>, schema: Schema): boolean;
    schemaCache: SchemaCache;
    store: PersistentStore | null;
    weakCache: WeakMap<object, Schema>;
};


// int64 bounds — literal mirror of src/sbc/tagged.ts:14-16 (unexported there); encodeSbc throws
// on the same range so the bigint domain agrees.

function computeSize(ctx: SizeContext, value: unknown): number {
    if (value === null || value === undefined) {
        return 1;
    }

    switch (typeof value) {
        case 'bigint':
            if (value < INT64_MIN || value >= INT64_OVERFLOW) {
                throw new Error('Codec2: bigint out of int64 range');
            }

            return 9;

        case 'boolean':
            return 1;

        case 'number': {
            if (Number.isInteger(value) && !Object.is(value, -0)) {
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

            if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
                let typeId = TYPED_ARRAY_IDS.get((value as { constructor: Function }).constructor);

                if (typeId === undefined) {
                    return unrepresentable(value);
                }

                return 6 + value.byteLength;
            }

            if (Array.isArray(value)) {
                if (value.length > 0 && typeof value[0] === 'number') {
                    let typeId = classifyPackedArray(value as number[]);

                    if (typeId !== -1) {
                        return 6 + value.length * TYPED_ARRAY_BPE[typeId]!;
                    }
                }

                let size = 5;

                for (let i = 0, n = value.length; i < n; i++) {
                    size += computeSize(ctx, value[i]);
                }

                return size;
            }

            // Plain-object gate mirrors encodeSbc:615-619 — non-plain values (Map, Set, RegExp,
            // class instances) are unrepresentable on the tagged path.
            let ctor = (value as { constructor?: unknown }).constructor;

            if (ctor !== Object && ctor !== undefined) {
                return unrepresentable(value);
            }

            let obj = value as Record<string, unknown>,
                schema = resolveObjSchema(ctx, obj);

            return 9 + sizeObjectPayload(ctx, schema, obj);
        }

        case 'function':
        case 'symbol':
            return unrepresentable(value);

        default:
            return unrepresentable(value);
    }
}


function resolveObjSchema(ctx: SizeContext, obj: Record<string, unknown>): Schema {
    let schema = ctx.weakCache.get(obj) ?? null;

    if (schema && !ctx.revalidateCached(obj, schema)) {
        schema = null;
    }

    if (!schema) {
        schema = ctx.matchSchema(obj);

        if (!schema) {
            schema = inferAndRegister(obj, ctx.registry, ctx.helpers, ctx.store, ctx.schemaCache);
        }

    }

    return schema;
}


// Mirrors compileEncoder's array arm (src/sbc/codegen.ts:225-307) and the identical compressed
// arm (:1078-1160): typed-element arrays follow their codegen widths; generic (elementType-less)
// arrays follow the packed flag layout (5 + count*bpe) or the tagged fallback (5 + Σ elements).
function sizeArrayField(ctx: SizeContext, f: FieldDef, v: unknown): number {
    let arr = v as unknown[],
        count = arr.length;

    if (!f.elementType) {
        let typeId = classifyPackedArray(arr as number[]);

        if (typeId >= 0) {
            return 5 + count * TYPED_ARRAY_BPE[typeId]!;
        }

        let size = 5;

        for (let i = 0; i < count; i++) {
            size += computeSize(ctx, arr[i]);
        }

        return size;
    }

    let base = f.elementType.base,
        elemFixed = FIELD_SIZES[base] ?? 0;

    if (elemFixed > 0) {
        return varintSize(count) + count * elemFixed;
    }

    if (base === 'string') {
        let size = varintSize(count);

        for (let i = 0; i < count; i++) {
            let bl = byteLen(arr[i] as string);

            size += varintSize(bl) + bl;
        }

        return size;
    }

    if (base === 'bytes') {
        let size = varintSize(count);

        for (let i = 0; i < count; i++) {
            let bl = (arr[i] as Uint8Array).length;

            size += varintSize(bl) + bl;
        }

        return size;
    }

    if (base === 'object' && f.elementType.hash !== undefined) {
        let refSchema = ctx.registry.schemas.get(f.elementType.hash);

        if (refSchema) {
            let size = varintSize(count);

            for (let i = 0; i < count; i++) {
                let pl = sizeUncompressed(ctx, refSchema, arr[i] as Record<string, unknown>);

                size += varintSize(pl) + pl;
            }

            return size;
        }
    }

    // Container element types (array<array>, array<mixed>, ...) and uncompiled object refs — the
    // codegen tagged fallback: varint count + Σ tagged element sizes.
    let size = varintSize(count);

    for (let i = 0; i < count; i++) {
        size += computeSize(ctx, arr[i]);
    }

    return size;
}


// Compressed object payload — mirrors compileCompressedEncoder (src/sbc/codegen.ts:903-1219):
// null bitmap + bool bitmap + pass-1 fixed + pass-2 varint ints + pass-3 adaptive float64 +
// pass-4 variable fields. Field order within a size is irrelevant, so the four passes collapse
// into one walk.
function sizeCompressed(ctx: SizeContext, schema: Schema, obj: Record<string, unknown>): number {
    let boolCount = schema.boolFields.length,
        fields = schema.fields,
        size = schema.bitmapBytes + (boolCount > 0 ? Math.ceil(boolCount / 8) : 0);

    for (let i = 0, n = fields.length; i < n; i++) {
        let f = fields[i]!,
            v = obj[f.name];

        if (f.nullable && v == null) {
            continue;
        }

        switch (f.type) {
            case 'boolean':
                break;

            case 'date':
            case 'int64':
                size += 8;
                break;

            case 'int8':
            case 'uint8':
                size += 1;
                break;

            case 'int16':
            case 'int32':
                size += varintSize(zigzagEncode(v as number));
                break;

            case 'uint16':
            case 'uint32':
                size += varintSize(v as number);
                break;

            case 'float64': {
                let fv = v as number;

                if (Number.isInteger(fv) && fv >= -2147483648 && fv <= 2147483647) {
                    size += 1 + varintSize(zigzagEncode(fv));
                }
                else {
                    size += 9;
                }

                break;
            }

            default:
                size += sizeVariableField(ctx, f, v);
        }
    }

    return size;
}


// Object field — mirrors compileEncoder's object arm (src/sbc/codegen.ts:309-328): a refHash to a
// compiled schema is a varint-prefixed UNCOMPRESSED nested payload (encodeFn is always the
// uncompressed fn); otherwise the field routes through encodeObj (compress-aware, 9-byte header).
function sizeObjectField(ctx: SizeContext, f: FieldDef, v: unknown): number {
    if (f.refHash !== undefined) {
        let refSchema = ctx.registry.schemas.get(f.refHash);

        if (refSchema) {
            let pl = sizeUncompressed(ctx, refSchema, v as Record<string, unknown>);

            return varintSize(pl) + pl;
        }
    }

    return sizeEncodeObj(ctx, v);
}


// Picks the encoder each object nesting level uses — the same predicate as encodeSbc:641 /
// encodeObj:237 / encodeObject:617.
function sizeObjectPayload(ctx: SizeContext, schema: Schema, obj: Record<string, unknown>): number {
    if (ctx.compress && schema.compressible && schema.compressedEncodeFn) {
        return sizeCompressed(ctx, schema, obj);
    }

    return sizeUncompressed(ctx, schema, obj);
}


// Uncompressed object payload — mirrors compileEncoder (src/sbc/codegen.ts:141-344): null bitmap +
// fixed-width fields inline + variable fields per their arms; a null nullable field costs 0 bytes.
function sizeUncompressed(ctx: SizeContext, schema: Schema, obj: Record<string, unknown>): number {
    let fields = schema.fields,
        size = schema.bitmapBytes;

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

        size += sizeVariableField(ctx, f, v);
    }

    return size;
}


// Shared variable-width field sizer — string/bytes/array/object/typedarray/mixed size identically
// under both the uncompressed and compressed layouts (typedarray/mixed route through the tagged
// encoder via _enc).
function sizeVariableField(ctx: SizeContext, f: FieldDef, v: unknown): number {
    switch (f.type) {
        case 'array':
            return sizeArrayField(ctx, f, v);

        case 'bytes': {
            let bl = (v as Uint8Array).length;

            return varintSize(bl) + bl;
        }

        case 'mixed':
        case 'typedarray':
            return computeSize(ctx, v);

        case 'object':
            return sizeObjectField(ctx, f, v);

        case 'string': {
            let bl = byteLen(v as string);

            return varintSize(bl) + bl;
        }

        default:
            throw new Error('Codec2: size walker reached unknown field type ' + f.type);
    }
}


// Mirrors encodeObj (src/sbc/index.ts:210-260): non-plain values are unencodable; a plain object
// is a compress-aware tag-8/18 body (9-byte header + payload).
function sizeEncodeObj(ctx: SizeContext, v: unknown): number {
    let ctor = (v as { constructor?: unknown } | null)?.constructor;

    if (ctor !== Object && ctor !== undefined) {
        throw new Error('Codec2: unencodable value (' + ((ctor as { name?: string }).name ?? typeof v) + ')');
    }

    let obj = v as Record<string, unknown>,
        schema = resolveObjSchema(ctx, obj);

    return 9 + sizeObjectPayload(ctx, schema, obj);
}


export { computeSize };
export type { SizeContext };
