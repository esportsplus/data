import { FIELD_SIZES, FNV_OFFSET, FNV_PRIME, KNOWN_TYPES } from './constants';
import { compileSchema } from './codegen';
import { readBI64, readF64 } from './platform';

import type { SchemaCache } from './cache';
import type { FieldDef, ParsedType, Schema, SbcHelpers } from './codegen';
import type { FieldSpec, PersistentStore, SchemaRegistry } from './types';


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
            throw new Error('@esportsplus/data: codec empty array element type');
        }

        return { base: 'array', elementType: parseFieldType(inner) };
    }

    if (type.startsWith('object(') && type.endsWith(')')) {
        let hashStr = type.slice(7, -1),
            hash = Number(hashStr);

        if (!hashStr || !Number.isFinite(hash) || !Number.isInteger(hash) || hash < 0) {
            throw new Error('@esportsplus/data: codec invalid object hash: ' + hashStr);
        }

        return { base: 'object', hash: hash >>> 0 };
    }

    if (!(type in KNOWN_TYPES)) {
        throw new Error('@esportsplus/data: codec unknown field type: ' + type);
    }

    return { base: type };
}


function inferType(value: unknown): string {
    if (value === null || value === undefined) {
        return 'mixed';
    }

    switch (typeof value) {
        case 'bigint': return 'int64';
        case 'boolean': return 'boolean';
        case 'number': {
            let n = value as number;

            if (Number.isInteger(n) && !Object.is(n, -0)) {
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

            if (Array.isArray(value)) {
                return 'array';
            }

            return 'object';
        }
        default: return 'mixed';
    }
}


function numericTypeCanWidenTo(from: string, to: string): boolean {
    switch (from) {
        case 'int8': return to === 'int16' || to === 'int32';
        case 'int16': return to === 'int32';
        case 'uint8': return to === 'int16' || to === 'int32' || to === 'uint16' || to === 'uint32';
        case 'uint16': return to === 'int32' || to === 'uint32';
        default: return false;
    }
}


function fieldsMatch(existing: Schema, keys: string[], types: string[], nullable: boolean[]): boolean {
    let ef = existing.fields;

    if (ef.length !== keys.length) {
        return false;
    }

    for (let i = 0, n = keys.length; i < n; i++) {
        if (ef[i]!.name !== keys[i] || ef[i]!.rawType !== types[i] || ef[i]!.nullable !== nullable[i]) {
            return false;
        }
    }

    return true;
}


function hashTypesOf(types: string[], nullable: boolean[]): string[] {
    let out: string[] = new Array(types.length);

    for (let i = 0, n = types.length; i < n; i++) {
        out[i] = nullable[i] ? types[i]! + '?' : types[i]!;
    }

    return out;
}


// A null/undefined sample defers the field's base type instead of collapsing it to 'mixed'
// forever: the field is registered nullable with type 'mixed' (provisional — decodable via
// the generic tagged fallback, but never persisted to the PersistentStore) and, on the first
// record supplying a non-null value for that key, upgrades in place to the resolved base type
// under its OWN hash. A null observed for a field of an already-resolved non-nullable schema
// upgrades the same way, so both arrival orders converge on one final hash.
function inferAndRegister(obj: Record<string, unknown>, registry: SchemaRegistry, helpers: SbcHelpers, store: PersistentStore | null, schemaCache: SchemaCache, sortedKeys?: string[]): Schema {
    let keys = sortedKeys ?? Object.keys(obj).sort(),
        n = keys.length,
        isNull: boolean[] = new Array(n),
        nullable: boolean[] = new Array(n),
        types: string[] = new Array(n);

    for (let i = 0; i < n; i++) {
        let v = obj[keys[i]!];

        if (v === null || v === undefined) {
            isNull[i] = true;
            nullable[i] = true;
            types[i] = 'mixed';
        }
        else {
            isNull[i] = false;
            nullable[i] = false;
            types[i] = inferType(v);
        }
    }

    let hash = computeShapeHash(keys, hashTypesOf(types, nullable)),
        existing = registry.schemas.get(hash);

    if (existing) {
        if (!fieldsMatch(existing, keys, types, nullable)) {
            throw new Error('@esportsplus/data: codec schema hash collision — two distinct schemas share hash ' + hash);
        }

        return existing;
    }

    // Cache miss — consult sibling shapes sharing this key set for a base type or nullable
    // flag a prior record already established that this record alone can't see.
    let nameHash = computeNameHash(keys),
        siblings = registry.byNameHash.get(nameHash),
        chosen: Schema | null = null;

    if (siblings) {
        for (let s = 0, sn = siblings.length; s < sn; s++) {
            let candidate = siblings[s]!,
                cf = candidate.fields,
                compatible = cf.length === n;

            if (compatible) {
                for (let i = 0; i < n; i++) {
                    let f = cf[i]!;

                    if (f.name !== keys[i]) {
                        compatible = false;
                        break;
                    }

                    if (isNull[i]) {
                        continue;
                    }

                    if (f.type !== types[i] && !(f.type === 'mixed' && f.nullable) && !numericTypeCanWidenTo(types[i]!, f.type)) {
                        compatible = false;
                        break;
                    }
                }
            }

            if (compatible) {
                chosen = candidate;
                break;
            }
        }
    }

    if (chosen) {
        let cf = chosen.fields;

        for (let i = 0; i < n; i++) {
            let f = cf[i]!;

            if (isNull[i]) {
                if (f.type !== 'mixed') {
                    types[i] = f.type;
                }
            }
            else {
                if (numericTypeCanWidenTo(types[i]!, f.type)) {
                    types[i] = f.type;
                }

                if (f.nullable) {
                    nullable[i] = true;
                }
            }
        }

        hash = computeShapeHash(keys, hashTypesOf(types, nullable));
        existing = registry.schemas.get(hash);

        if (existing) {
            if (!fieldsMatch(existing, keys, types, nullable)) {
                throw new Error('@esportsplus/data: codec schema hash collision — two distinct schemas share hash ' + hash);
            }

            return existing;
        }
    }

    let fields: FieldDef[] = new Array(n),
        nullableCount = 0;

    for (let i = 0; i < n; i++) {
        let fs = FIELD_SIZES[types[i]!] ?? 0,
            isNullable = nullable[i]!,
            name = keys[i]!,
            nullIdx = isNullable ? nullableCount++ : -1;

        fields[i] = { fixedSize: fs, name, nullable: isNullable, nullIndex: nullIdx, rawType: types[i]!, type: types[i]! };
    }

    if (nullableCount > 16) {
        throw new Error('@esportsplus/data: codec max 16 nullable fields per schema');
    }

    let boolFields: number[] = [],
        float64Fields: number[] = [],
        intFields: number[] = [],
        provisional = false;

    for (let i = 0, m = fields.length; i < m; i++) {
        let f = fields[i]!,
            t = f.type;

        if (t === 'boolean') {
            boolFields.push(i);
        }
        else if (t === 'float64') {
            float64Fields.push(i);
        }
        else if (t === 'int16' || t === 'int32' || t === 'uint16' || t === 'uint32') {
            intFields.push(i);
        }
        else if (t === 'mixed' && f.nullable) {
            provisional = true;
        }
    }

    let schema: Schema = {
        bitmapBytes: Math.ceil(nullableCount / 8),
        boolFields,
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible: (boolFields.length > 0 || float64Fields.length > 0 || intFields.length > 0) && boolFields.length <= 16,
        decodeFn: null,
        encodeFn: null,
        fields,
        hash,
        nullableCount,
    };

    compileSchema(schema, helpers);
    registry.schemas.set(hash, schema);

    let siblingList = registry.byNameHash.get(nameHash);

    if (siblingList) {
        siblingList.push(schema);
    }
    else {
        registry.byNameHash.set(nameHash, [schema]);
    }

    let storedFields: FieldSpec[] = new Array(n);

    for (let i = 0; i < n; i++) {
        storedFields[i] = { name: keys[i]!, nullable: nullable[i], type: types[i]! };
    }

    schemaCache.set(hash, { fields: storedFields, hash });

    if (store && !provisional) {
        store.set(hash, { fields: storedFields, hash });
    }

    return schema;
}


function readFixedField(buf: Uint8Array, pos: number, type: string): unknown {
    switch (type) {
        case 'int64': return readBI64.call(buf, pos);
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
