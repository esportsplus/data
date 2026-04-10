// Registry serialization/deserialization — wire format for schema exchange
// Extracted from codec() closure; pure functions with explicit parameters

import { FIELD_NAME_RE, MAX_SCHEMA_COUNT } from './constants';
import { allocBuf, byteLen, readStr, writeUtf8 } from './platform';
import { parseFieldType } from './schema';

import type { FieldSpec } from './types';
import type { Schema } from './codegen';


function deserializeRegistry(data: Uint8Array, defineSchemaFn: (fields: FieldSpec[]) => number, schemas: Map<number, Schema>): void {
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
        if (schemas.has(hash)) {
            continue;
        }

        defineSchemaFn(fields);
    }
}


function serializeRegistry(schemas: Map<number, Schema>): Uint8Array {
    let schemaArr = [...schemas.values()];

    // Calculate total size using UTF-8 byte lengths
    let size = 2; // u16 schemaCount

    for (let i = 0, n = schemaArr.length; i < n; i++) {
        let s = schemaArr[i]!;

        size += 4 + 2; // u32 hash + u16 fieldCount

        for (let j = 0, m = s.fields.length; j < m; j++) {
            let f = s.fields[j]!;

            size += 2 + byteLen(f.name) + 2 + byteLen(f.rawType) + 1;
        }
    }

    let buf = allocBuf(size),
        pos = 0;

    // Write schema count
    buf[pos] = schemaArr.length & 0xFF;
    buf[pos + 1] = (schemaArr.length >>> 8) & 0xFF;
    pos += 2;

    for (let i = 0, n = schemaArr.length; i < n; i++) {
        let s = schemaArr[i]!;

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


export { deserializeRegistry, serializeRegistry };
