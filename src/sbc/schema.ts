import { FIELD_SIZES, FNV_OFFSET, FNV_PRIME, KNOWN_TYPES } from './constants';
import { compileSchema } from './codegen';
import { readBI64, readF64 } from './platform';

import type { FieldDef, ParsedType, Schema, SbcHelpers } from './codegen';
import type { FieldSpec, PersistentStore, SchemaRegistry } from './types';

import cache from './cache';


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


function computeNameHash(keys: string[]): number {
    let h = FNV_OFFSET;

    for (let i = 0, n = keys.length; i < n; i++) {
        let k = keys[i]!;

        for (let j = 0, m = k.length; j < m; j++) {
            h ^= k.charCodeAt(j);
            h = Math.imul(h, FNV_PRIME);
        }

        h ^= 0xFF;
        h = Math.imul(h, FNV_PRIME);
    }

    return h >>> 0;
}


function varintSize(n: number): number {
    if (n < 128) {
        return 1;
    }

    if (n < 16384) {
        return 2;
    }

    if (n < 2097152) {
        return 3;
    }

    if (n < 268435456) {
        return 4;
    }

    return 5;
}


function parseFieldType(type: string): ParsedType {
    if (type.startsWith('array<') && type.endsWith('>')) {
        let inner = type.slice(6, -1);

        if (!inner) {
            throw new Error('Codec2: empty array element type');
        }

        return { base: 'array', elementType: parseFieldType(inner) };
    }

    if (type.startsWith('object(') && type.endsWith(')')) {
        let hashStr = type.slice(7, -1),
            hash = Number(hashStr);

        if (!hashStr || !Number.isFinite(hash) || !Number.isInteger(hash) || hash < 0) {
            throw new Error('Codec2: invalid object hash: ' + hashStr);
        }

        return { base: 'object', hash: hash >>> 0 };
    }

    if (!(type in KNOWN_TYPES)) {
        throw new Error('Codec2: unknown field type: ' + type);
    }

    return { base: type };
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

            if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
                return 'typedarray';
            }

            if (value instanceof Map) {
                return 'map';
            }

            if (value instanceof Set) {
                return 'set';
            }

            if (Array.isArray(value)) {
                return 'array';
            }

            return 'object';
        }
        default: return 'mixed';
    }
}


function inferAndRegister(obj: Record<string, unknown>, registry: SchemaRegistry, helpers: SbcHelpers, store: PersistentStore | null, sortedKeys?: string[]): Schema {
    let keys = sortedKeys ?? Object.keys(obj).sort(),
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
                if (ef[i]!.name !== keys[i] || ef[i]!.rawType !== types[i]) {
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

        fields[i] = { fixedSize: fs, name, nullable: false, nullIndex: -1, offset, rawType: types[i]!, type: types[i]! };

        if (fs > 0) {
            fixedSize += fs;
            offset += fs;
        }
    }

    let boolFields: number[] = [],
        compFixedSize = 0,
        float64Fields: number[] = [],
        intFields: number[] = [];

    for (let i = 0, n = fields.length; i < n; i++) {
        let t = fields[i]!.type;

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
        bitmapBytes: 0,
        boolFields,
        compFixedSize,
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible: boolFields.length > 0 || float64Fields.length > 0 || intFields.length > 0,
        decodeFn: null,
        encodeFn: null,
        fields,
        fixedSize,
        float64Fields,
        hash,
        id: registry.nextId++,
        intFields,
        nullableCount: 0,
    };

    compileSchema(schema, helpers);
    registry.schemas.set(hash, schema);

    let storedFields: FieldSpec[] = new Array(keys.length);

    for (let i = 0, n = keys.length; i < n; i++) {
        storedFields[i] = { name: keys[i]!, type: types[i]! };
    }

    cache.set(hash, { fields: storedFields, hash });

    if (store) {
        store.set(hash, { fields: storedFields, hash });
    }

    return schema;
}


function readFixedField(buf: Uint8Array, pos: number, type: string): unknown {
    switch (type) {
        case 'bigint': return readBI64.call(buf, pos);
        case 'boolean': return !!buf[pos]!;
        case 'date': return new Date(readF64.call(buf, pos));
        case 'float64': return readF64.call(buf, pos);
        case 'int8': return (buf[pos]! << 24) >> 24;
        case 'int16': return ((buf[pos]! | (buf[pos + 1]! << 8)) << 16) >> 16;
        case 'int32': return (buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16) | (buf[pos + 3]! << 24)) | 0;
        case 'uint8': return buf[pos]!;
        case 'uint16': return buf[pos]! | (buf[pos + 1]! << 8);
        case 'uint32': return (buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16) | (buf[pos + 3]! << 24)) >>> 0;
        default: return undefined;
    }
}


export { computeNameHash, computeShapeHash, inferAndRegister, inferType, parseFieldType, readFixedField, varintSize };
