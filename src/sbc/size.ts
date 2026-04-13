// Size computation — compute encoded byte size without encoding
// Extracted from codec() closure; state threaded via SizeContext

import { FIELD_SIZES } from './constants';
import { byteLen } from './platform';
import { inferAndRegister, varintSize } from './schema';

import type { PersistentStore, SchemaRegistry } from './types';
import type { Schema, SbcHelpers } from './codegen';


type SizeContext = {
    helpers: SbcHelpers;
    matchSchema(obj: Record<string, unknown>): Schema | null;
    registry: SchemaRegistry;
    setCache(schema: Schema, obj: object): void;
    store: PersistentStore | null;
    weakCache: WeakMap<object, Schema>;
};


function computeSize(ctx: SizeContext, value: unknown): number {
    if (value === null || value === undefined) {
        return 1;
    }

    switch (typeof value) {
        case 'bigint': return 9;
        case 'boolean': return 1;
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
                schema = ctx.weakCache.get(obj) ?? ctx.matchSchema(obj) ?? null;

            if (!schema) {
                schema = inferAndRegister(obj, ctx.registry, ctx.helpers, ctx.store);
                ctx.setCache(schema, obj);
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
                            let refSchema = ctx.registry.schemas.get(f.refHash);

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
                            let nested = computeSize(ctx, v);

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


export { computeSize };
export type { SizeContext };
