// Schema Binary Codec — CSP-Safe (no eval / new Function)
// Closure-based encoder/decoder/computeSize/extractors using monomorphic field access.
// Wire-compatible with codegen-compiled schemas — identical binary output.

import { allocBuf, allocUnsafe, byteLen, copyBuf, FIELD_SIZES, isNode, readBI64, readF64, readI16, readI32, readU16, readU32, readShortStr, writeBI64, writeF64, writeI16, writeI32, writeU16, writeU32, writeUtf8 } from './platform';
import { buildSchemaFromDef, validateFieldName } from './codegen';
import { createRegistry, inferSchema, lookupSchema, parseFieldType, registerSchema, serializeFieldType } from './registry';

import type { FieldDef, FieldType, Schema, SchemaRegistry } from './platform';


type DecodeFn = (buf: Uint8Array, pos: number) => unknown;

type EncodeFn = (obj: unknown, buf: Uint8Array, pos: number) => number;

type ExtractFn = (buf: Uint8Array, pos: number) => unknown;

type SizeFn = (obj: unknown) => number;


// ─── Encoder ────────────────────────────────────────────────────────────────────

function encodeFixed(field: FieldDef, obj: Record<string, unknown>, buf: Uint8Array, off: number): void {
    let val = obj[field.name];

    switch (field.type) {
        case 'bigint': writeBI64.call(buf, val as bigint, off); break;
        case 'boolean': buf[off] = (val as boolean) ? 1 : 0; break;
        case 'date': writeF64.call(buf, (val as Date).getTime(), off); break;
        case 'float64': writeF64.call(buf, val as number, off); break;
        case 'int8': buf[off] = (val as number) & 0xFF; break;
        case 'int16': writeI16.call(buf, val as number, off); break;
        case 'int32': writeI32.call(buf, val as number, off); break;
        case 'uint8': buf[off] = val as number; break;
        case 'uint16': writeU16.call(buf, val as number, off); break;
        case 'uint32': writeU32.call(buf, val as number, off); break;
    }
}

function encodeVar(field: FieldDef, obj: Record<string, unknown>, buf: Uint8Array, vp: number, encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number): number {
    let type = field.type,
        val = obj[field.name];

    if (typeof type === 'string') {
        if (type === 'string') {
            let str = val as string,
                len = byteLen(str);

            writeU32.call(buf, len, vp);
            vp += 4;
            writeUtf8.call(buf, str, vp, len);

            return vp + len;
        }

        if (type === 'bytes') {
            let bytes = val as Uint8Array;

            writeU32.call(buf, bytes.length, vp);
            vp += 4;
            buf.set(bytes, vp);

            return vp + bytes.length;
        }

        return vp;
    }

    if (type.kind === 'nullable') {
        // Null bitmap handled by caller — only encode inner value when non-null
        if (val == null) {
            return vp;
        }

        return encodeVarInner(type.inner, val, buf, vp, encodeSbc);
    }

    if (type.kind === 'object') {
        let startPos = vp;

        vp += 4;
        vp = encodeSbc(val, buf, vp);
        writeU32.call(buf, vp - startPos - 4, startPos);

        return vp;
    }

    if (type.kind === 'array') {
        let arr = val as unknown[];

        writeU16.call(buf, arr.length, vp);
        vp += 2;

        return encodeArrayElements(arr, type.element, buf, vp, encodeSbc);
    }

    return vp;
}

function encodeVarInner(type: FieldType, val: unknown, buf: Uint8Array, vp: number, encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number): number {
    if (typeof type === 'string') {
        switch (type) {
            case 'bigint': writeBI64.call(buf, val as bigint, vp); return vp + 8;
            case 'boolean': buf[vp] = (val as boolean) ? 1 : 0; return vp + 1;
            case 'bytes': {
                let bytes = val as Uint8Array;

                writeU32.call(buf, bytes.length, vp);
                vp += 4;
                buf.set(bytes, vp);

                return vp + bytes.length;
            }
            case 'date': writeF64.call(buf, (val as Date).getTime(), vp); return vp + 8;
            case 'float64': writeF64.call(buf, val as number, vp); return vp + 8;
            case 'int8': buf[vp] = (val as number) & 0xFF; return vp + 1;
            case 'int16': writeI16.call(buf, val as number, vp); return vp + 2;
            case 'int32': writeI32.call(buf, val as number, vp); return vp + 4;
            case 'string': {
                let str = val as string,
                    len = byteLen(str);

                writeU32.call(buf, len, vp);
                vp += 4;
                writeUtf8.call(buf, str, vp, len);

                return vp + len;
            }
            case 'uint8': buf[vp] = val as number; return vp + 1;
            case 'uint16': writeU16.call(buf, val as number, vp); return vp + 2;
            case 'uint32': writeU32.call(buf, val as number, vp); return vp + 4;
        }
    }

    if (typeof type === 'object' && type.kind === 'object') {
        let startPos = vp;

        vp += 4;
        vp = encodeSbc(val, buf, vp);
        writeU32.call(buf, vp - startPos - 4, startPos);

        return vp;
    }

    return vp;
}

function encodeArrayElements(arr: unknown[], elem: FieldType, buf: Uint8Array, vp: number, encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number): number {
    if (typeof elem === 'string') {
        switch (elem) {
            case 'float64':
                for (let i = 0, n = arr.length; i < n; i++) {
                    writeF64.call(buf, arr[i] as number, vp);
                    vp += 8;
                }

                return vp;
            case 'int32':
                for (let i = 0, n = arr.length; i < n; i++) {
                    writeI32.call(buf, arr[i] as number, vp);
                    vp += 4;
                }

                return vp;
            case 'uint32':
                for (let i = 0, n = arr.length; i < n; i++) {
                    writeU32.call(buf, arr[i] as number, vp);
                    vp += 4;
                }

                return vp;
            case 'uint16':
                for (let i = 0, n = arr.length; i < n; i++) {
                    writeU16.call(buf, arr[i] as number, vp);
                    vp += 2;
                }

                return vp;
            case 'string':
                for (let i = 0, n = arr.length; i < n; i++) {
                    let str = arr[i] as string,
                        len = byteLen(str);

                    writeU32.call(buf, len, vp);
                    vp += 4;
                    writeUtf8.call(buf, str, vp, len);
                    vp += len;
                }

                return vp;
            case 'mixed':
                for (let i = 0, n = arr.length; i < n; i++) {
                    let startPos = vp;

                    vp += 4;
                    vp = encodeSbc(arr[i], buf, vp);
                    writeU32.call(buf, vp - startPos - 4, startPos);
                }

                return vp;
        }
    }

    if (typeof elem === 'object' && elem.kind === 'object') {
        for (let i = 0, n = arr.length; i < n; i++) {
            let startPos = vp;

            vp += 4;
            vp = encodeSbc(arr[i], buf, vp);
            writeU32.call(buf, vp - startPos - 4, startPos);
        }

        return vp;
    }

    return vp;
}


// ─── Decoder ────────────────────────────────────────────────────────────────────

function decodeFixed(field: FieldDef, buf: Uint8Array, off: number): unknown {
    switch (field.type) {
        case 'bigint': return readBI64.call(buf, off);
        case 'boolean': return !!buf[off];
        case 'date': return new Date(readF64.call(buf, off));
        case 'float64': return readF64.call(buf, off);
        case 'int8': return (buf[off]! << 24 >> 24);
        case 'int16': return readI16.call(buf, off);
        case 'int32': return readI32.call(buf, off);
        case 'uint8': return buf[off];
        case 'uint16': return readU16.call(buf, off);
        case 'uint32': return readU32.call(buf, off);
        default: return undefined;
    }
}

function decodeVar(field: FieldDef, buf: Uint8Array, vp: number, bm: number, decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown): { value: unknown; vp: number } {
    let type = field.type;

    if (typeof type === 'string') {
        if (type === 'string') {
            let len = readU32.call(buf, vp);

            vp += 4;

            let val = readShortStr(buf, vp, vp + len);

            return { value: val, vp: vp + len };
        }

        if (type === 'bytes') {
            let len = readU32.call(buf, vp);

            vp += 4;

            return { value: buf.subarray(vp, vp + len), vp: vp + len };
        }

        return { value: undefined, vp };
    }

    if (type.kind === 'nullable') {
        if (!(bm & (1 << field._nullIndex!))) {
            return { value: null, vp };
        }

        return decodeVarInner(type.inner, buf, vp, decodeSbc);
    }

    if (type.kind === 'object') {
        let len = readU32.call(buf, vp);

        vp += 4;

        let val = decodeSbc(buf, vp, len);

        return { value: val, vp: vp + len };
    }

    if (type.kind === 'array') {
        let count = readU16.call(buf, vp);

        vp += 2;

        let arr = new Array(count);

        vp = decodeArrayElements(arr, count, type.element, buf, vp, decodeSbc);

        return { value: arr, vp };
    }

    return { value: undefined, vp };
}

function decodeVarInner(type: FieldType, buf: Uint8Array, vp: number, _decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown): { value: unknown; vp: number } {
    if (typeof type === 'string') {
        switch (type) {
            case 'bigint': return { value: readBI64.call(buf, vp), vp: vp + 8 };
            case 'boolean': return { value: !!buf[vp], vp: vp + 1 };
            case 'bytes': {
                let len = readU32.call(buf, vp);

                vp += 4;

                return { value: buf.subarray(vp, vp + len), vp: vp + len };
            }
            case 'date': return { value: new Date(readF64.call(buf, vp)), vp: vp + 8 };
            case 'float64': return { value: readF64.call(buf, vp), vp: vp + 8 };
            case 'int8': return { value: (buf[vp]! << 24 >> 24), vp: vp + 1 };
            case 'int16': return { value: readI16.call(buf, vp), vp: vp + 2 };
            case 'int32': return { value: readI32.call(buf, vp), vp: vp + 4 };
            case 'string': {
                let len = readU32.call(buf, vp);

                vp += 4;

                let val = readShortStr(buf, vp, vp + len);

                return { value: val, vp: vp + len };
            }
            case 'uint8': return { value: buf[vp], vp: vp + 1 };
            case 'uint16': return { value: readU16.call(buf, vp), vp: vp + 2 };
            case 'uint32': return { value: readU32.call(buf, vp), vp: vp + 4 };
        }
    }

    return { value: undefined, vp };
}

function decodeArrayElements(arr: unknown[], count: number, elem: FieldType, buf: Uint8Array, vp: number, decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown): number {
    if (typeof elem === 'string') {
        switch (elem) {
            case 'float64':
                for (let i = 0; i < count; i++) {
                    arr[i] = readF64.call(buf, vp);
                    vp += 8;
                }

                return vp;
            case 'int32':
                for (let i = 0; i < count; i++) {
                    arr[i] = readI32.call(buf, vp);
                    vp += 4;
                }

                return vp;
            case 'uint32':
                for (let i = 0; i < count; i++) {
                    arr[i] = readU32.call(buf, vp);
                    vp += 4;
                }

                return vp;
            case 'uint16':
                for (let i = 0; i < count; i++) {
                    arr[i] = readU16.call(buf, vp);
                    vp += 2;
                }

                return vp;
            case 'string':
                for (let i = 0; i < count; i++) {
                    let len = readU32.call(buf, vp);

                    vp += 4;
                    arr[i] = readShortStr(buf, vp, vp + len);
                    vp += len;
                }

                return vp;
            case 'mixed':
                for (let i = 0; i < count; i++) {
                    let len = readU32.call(buf, vp);

                    vp += 4;
                    arr[i] = decodeSbc(buf, vp, len);
                    vp += len;
                }

                return vp;
        }
    }

    if (typeof elem === 'object' && elem.kind === 'object') {
        for (let i = 0; i < count; i++) {
            let len = readU32.call(buf, vp);

            vp += 4;
            arr[i] = decodeSbc(buf, vp, len);
            vp += len;
        }

        return vp;
    }

    return vp;
}


// ─── Build Encoder (closure-based, no new Function) ─────────────────────────────

function bitmapBytes(count: number): number {
    return (count + 7) >> 3;
}

function buildEncoder(schema: Schema, encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number): EncodeFn {
    let fields = schema.fields,
        fixedFields: FieldDef[] = [],
        hasNullable = schema.nullableCount > 0,
        nullBmBytes = hasNullable ? bitmapBytes(schema.nullableCount) : 0,
        varFields: FieldDef[] = [];

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.fixedSize > 0) {
            fixedFields.push(field);
        }
        else {
            varFields.push(field);
        }
    }

    let fN = fixedFields.length,
        fixedSize = schema.fixedSize,
        vN = varFields.length;

    return (obj: unknown, buf: Uint8Array, pos: number): number => {
        let o = obj as Record<string, unknown>;

        // Null bitmap
        let bmPos = -1,
            bm = 0;

        if (hasNullable) {
            bmPos = pos;
            pos += nullBmBytes;
        }

        // Fixed fields
        for (let i = 0; i < fN; i++) {
            encodeFixed(fixedFields[i]!, o, buf, pos + fixedFields[i]!.offset);
        }

        // Variable fields
        let vp = pos + fixedSize;

        for (let i = 0; i < vN; i++) {
            let field = varFields[i]!;

            if (typeof field.type === 'object' && field.type.kind === 'nullable') {
                let val = o[field.name];

                if (val != null) {
                    bm |= (1 << field._nullIndex!);
                    vp = encodeVarInner(field.type.inner, val, buf, vp, encodeSbc);
                }
            }
            else {
                vp = encodeVar(field, o, buf, vp, encodeSbc);
            }
        }

        // Write null bitmap
        if (hasNullable && bmPos >= 0) {
            buf[bmPos] = bm & 0xFF;

            if (nullBmBytes > 1) {
                buf[bmPos + 1] = (bm >> 8) & 0xFF;
            }
        }

        return vp;
    };
}


// ─── Build Decoder (closure-based, no new Function) ─────────────────────────────

function buildDecoder(schema: Schema, decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown): DecodeFn {
    let fields = schema.fields,
        fixedFields: FieldDef[] = [],
        hasNullable = schema.nullableCount > 0,
        nullBmBytes = hasNullable ? bitmapBytes(schema.nullableCount) : 0,
        sortedNames = fields.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(f => f.name),
        varFields: FieldDef[] = [];

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.fixedSize > 0) {
            fixedFields.push(field);
        }
        else {
            varFields.push(field);
        }
    }

    let fN = fixedFields.length,
        fixedSize = schema.fixedSize,
        sN = sortedNames.length,
        vN = varFields.length;

    return (buf: Uint8Array, pos: number): unknown => {
        let bm = 0,
            result: Record<string, unknown> = {};

        // Read null bitmap
        if (hasNullable) {
            bm = buf[pos]!;

            if (nullBmBytes > 1) {
                bm |= buf[pos + 1]! << 8;
            }

            pos += nullBmBytes;
        }

        // Decode fixed fields
        for (let i = 0; i < fN; i++) {
            let field = fixedFields[i]!;

            result[field.name] = decodeFixed(field, buf, pos + field.offset);
        }

        // Decode variable fields
        let vp = pos + fixedSize;

        for (let i = 0; i < vN; i++) {
            let field = varFields[i]!,
                decoded = decodeVar(field, buf, vp, bm, decodeSbc);

            result[field.name] = decoded.value;
            vp = decoded.vp;
        }

        // Return object with sorted keys for consistent property order
        let sorted: Record<string, unknown> = {};

        for (let i = 0; i < sN; i++) {
            sorted[sortedNames[i]!] = result[sortedNames[i]!];
        }

        return sorted;
    };
}


// ─── Build ComputeSize (closure-based, no new Function) ─────────────────────────

function buildComputeSize(schema: Schema, registry: SchemaRegistry): SizeFn {
    let bmBytes = bitmapBytes(schema.nullableCount),
        fields = schema.fields,
        fixedTotal = 9 + bmBytes + schema.fixedSize,
        n = fields.length;

    return (obj: unknown): number => {
        let o = obj as Record<string, unknown>,
            s = fixedTotal;

        for (let i = 0; i < n; i++) {
            let f = fields[i]!;

            if (f.fixedSize > 0) {
                continue;
            }

            let type = f.type,
                val = o[f.name];

            if (typeof type === 'string') {
                if (type === 'string') {
                    s += 4 + byteLen(val as string);
                }
                else if (type === 'bytes') {
                    s += 4 + (val as Uint8Array).length;
                }
            }
            else if (type.kind === 'object') {
                let sub = lookupSchema(val as Record<string, unknown>, registry);

                if (!sub || !sub.computeSize) {
                    return -1;
                }

                let subSize = sub.computeSize(val);

                if (subSize < 0) {
                    return -1;
                }

                s += 4 + subSize;
            }
            else if (type.kind === 'array') {
                let arr = val as unknown[],
                    elem = type.element;

                if (typeof elem === 'string') {
                    let elemSize = FIELD_SIZES[elem];

                    if (elemSize && elemSize > 0) {
                        s += 2 + arr.length * elemSize;
                    }
                    else if (elem === 'string') {
                        s += 2;

                        for (let j = 0, m = arr.length; j < m; j++) {
                            s += 4 + byteLen(arr[j] as string);
                        }
                    }
                }
            }
            else if (type.kind === 'nullable') {
                if (val == null) {
                    continue;
                }

                let inner = type.inner;

                if (typeof inner === 'string') {
                    if (inner === 'string') {
                        s += 4 + byteLen(val as string);
                    }
                    else if (inner === 'bytes') {
                        s += 4 + (val as Uint8Array).length;
                    }
                    else {
                        let innerSize = FIELD_SIZES[inner];

                        if (innerSize && innerSize > 0) {
                            s += innerSize;
                        }
                    }
                }
                else if (typeof inner === 'object' && inner.kind === 'array') {
                    let arr = val as unknown[],
                        elem = inner.element;

                    if (typeof elem === 'string') {
                        let elemSize = FIELD_SIZES[elem];

                        if (elemSize && elemSize > 0) {
                            s += 2 + arr.length * elemSize;
                        }
                        else if (elem === 'string') {
                            s += 2;

                            for (let j = 0, m = arr.length; j < m; j++) {
                                s += 4 + byteLen(arr[j] as string);
                            }
                        }
                    }
                }
            }
        }

        return s;
    };
}


// ─── Build Field Extractors (closure-based, no new Function) ────────────────────

function buildFieldExtractors(schema: Schema): Map<string, ExtractFn> {
    let extractors = new Map<string, ExtractFn>();
    let varFields: FieldDef[] = [];

    // Fixed-size fields: O(1) direct offset read
    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            let offset = field.offset,
                type = field.type;

            extractors.set(field.name, (buf: Uint8Array, pos: number): unknown => {
                return decodeFixed({ fixedSize: FIELD_SIZES[type as string] ?? 0, name: '', offset: 0, type } as FieldDef, buf, pos + offset);
            });
        }
        else {
            varFields.push(field);
        }
    }

    // Variable-size fields: scan through preceding var fields
    let fixedSize = schema.fixedSize;

    for (let vi = 0, vn = varFields.length; vi < vn; vi++) {
        let target = varFields[vi]!;

        // Only string/bytes extraction (most common filter fields)
        if (typeof target.type !== 'string' || (target.type !== 'string' && target.type !== 'bytes')) {
            continue;
        }

        // Check all preceding var fields are skippable
        let canExtract = true;

        for (let j = 0; j < vi; j++) {
            let prev = varFields[j]!;

            if (typeof prev.type === 'string' && (prev.type === 'string' || prev.type === 'bytes')) {
                continue;
            }

            if (typeof prev.type === 'object' && prev.type.kind === 'object') {
                continue;
            }

            canExtract = false;
            break;
        }

        if (!canExtract) {
            continue;
        }

        let precedingCount = vi,
            targetType = target.type;

        extractors.set(target.name, (buf: Uint8Array, pos: number): unknown => {
            let bl = buf.length,
                vp = pos + fixedSize;

            // Skip preceding var fields
            for (let j = 0; j < precedingCount; j++) {
                if (vp + 4 > bl) {
                    return undefined;
                }

                let len = readU32.call(buf, vp);

                if (vp + 4 + len > bl) {
                    return undefined;
                }

                vp += 4 + len;
            }

            if (vp + 4 > bl) {
                return undefined;
            }

            let len = readU32.call(buf, vp);

            vp += 4;

            if (vp + len > bl) {
                return undefined;
            }

            if (targetType === 'string') {
                return readShortStr(buf, vp, vp + len);
            }

            return buf.subarray(vp, vp + len);
        });
    }

    return extractors;
}


// ─── Schema Serialization ───────────────────────────────────────────────────────

interface SerializedSchema {
    fields: { fixedSize: number; name: string; type: string }[];
    hash: number;
    id: number;
    nullableCount: number;
}

function serializeSchema(schema: Schema): SerializedSchema {
    return {
        fields: schema.fields.map((f) => ({
            fixedSize: f.fixedSize,
            name: f.name,
            type: serializeFieldType(f.type),
        })),
        hash: schema.hash,
        id: schema.id,
        nullableCount: schema.nullableCount,
    };
}

function deserializeSchema(data: SerializedSchema): Schema {
    for (let i = 0, n = data.fields.length; i < n; i++) {
        validateFieldName(data.fields[i]!.name);
    }

    return buildSchemaFromDef(data, parseFieldType);
}


// ─── Compile Schema (CSP-safe) ─────────────────────────────────────────────────

function compileSafeSchema(schema: Schema, registry: SchemaRegistry, helpers: { decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number }): void {
    schema.encodeFn = buildEncoder(schema, helpers.encodeSbc);
    schema.decodeFn = buildDecoder(schema, helpers.decodeSbc);
    schema.computeSize = buildComputeSize(schema, registry);
    schema.fieldExtractors = buildFieldExtractors(schema);

    // Build null index map
    if (schema.nullableCount > 0) {
        let nullMap = new Map<string, number>();

        for (let i = 0, n = schema.fields.length; i < n; i++) {
            let field = schema.fields[i]!;

            if (field._nullIndex !== undefined) {
                nullMap.set(field.name, field._nullIndex);
            }
        }

        schema.nullIndexMap = nullMap;
    }
}


// ─── CSP-Safe Codec Factory ─────────────────────────────────────────────────────

const createSafeCodec = (): {
    decode(buffer: Uint8Array, length?: number): unknown;
    encode(value: unknown): Uint8Array;
    extractField(buffer: Uint8Array, fieldName: string, length?: number): unknown;
    importSchema(data: SerializedSchema): Schema;
    exportSchema(obj: Record<string, unknown>): SerializedSchema;
} => {
    let encodeBuf = allocBuf(65536),
        registry = createRegistry(),
        sbcHelpers = {
            decodeSbc: (buf: Uint8Array, offset: number, len: number): unknown => decodeSbc(buf, offset, len),
            encodeSbc: (value: unknown, buf: Uint8Array, pos: number): number => encodeSbc(value, buf, pos),
        };

    function decodeTagEnd(buf: Uint8Array, offset: number, tag: number, depth: number = 0): number {
        if (depth > 128) {
            throw new RangeError('SBC: decode nesting depth exceeds 128');
        }

        switch (tag) {
            case 0: return offset + 1;
            case 245: {
                let end = offset + 9 + readU32.call(buf, offset + 5);

                if (end > buf.length) {
                    throw new RangeError('SBC: tag length extends beyond buffer');
                }

                return end;
            }
            case 248: return offset + 9;
            case 250: return offset + 9;
            case 251: return offset + 2;
            case 252: return offset + 9;
            case 255: return offset + 2;
            case 253: {
                let end = offset + 5 + readU32.call(buf, offset + 1);

                if (end > buf.length) {
                    throw new RangeError('SBC: tag length extends beyond buffer');
                }

                return end;
            }
            case 254: {
                let end = offset + 5 + readU32.call(buf, offset + 1);

                if (end > buf.length) {
                    throw new RangeError('SBC: tag length extends beyond buffer');
                }

                return end;
            }
            case 246: {
                let end = offset + 9 + readU32.call(buf, offset + 5);

                if (end > buf.length) {
                    throw new RangeError('SBC: tag length extends beyond buffer');
                }

                return end;
            }
            case 249: {
                if (offset + 3 > buf.length) {
                    throw new RangeError('SBC: array header extends beyond buffer');
                }

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

                return readShortStr(buf, offset + 5, offset + 5 + sLen);
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

            case 255:
                if (offset + 2 > bufLen) {
                    throw new RangeError('SBC: uint8 tag extends beyond buffer');
                }

                return buf[offset + 1]!;

            case 246: {
                if (offset + 9 > bufLen) {
                    throw new RangeError('SBC: object header extends beyond buffer');
                }

                let hash = readU32.call(buf, offset + 1),
                    schema = registry.schemasByHash.get(hash);

                if (!schema || !schema.decodeFn) {
                    return null;
                }

                return schema.decodeFn(buf, offset + 9);
            }

            default:
                return null;
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

            case 'number': {
                let n = value as number;

                if (n >= 0 && n <= 255 && Number.isInteger(n)) {
                    buf[pos] = 255;
                    buf[pos + 1] = n;

                    return pos + 2;
                }

                buf[pos] = 252;
                writeF64.call(buf, n, pos + 1);

                return pos + 9;
            }

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

                if (value instanceof Map) {
                    let map = value as Map<unknown, unknown>;

                    if (map.size > 0xFFFF) {
                        throw new RangeError('SBC: map size exceeds u16 limit: ' + map.size);
                    }

                    buf[pos] = 249;
                    writeU16.call(buf, map.size, pos + 1);

                    let p = pos + 3;

                    for (let [k, v] of map) {
                        buf[p] = 249;
                        writeU16.call(buf, 2, p + 1);
                        p += 3;
                        p = encodeSbc(k, buf, p, depth + 1);
                        p = encodeSbc(v, buf, p, depth + 1);
                    }

                    return p;
                }

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
                let obj = value as Record<string, unknown>,
                    keysOut: string[][] = [],
                    schema = lookupSchema(obj, registry, keysOut);

                if (!schema) {
                    schema = inferSchema(obj, registry, keysOut[0]);
                    registerSchema(schema, registry);
                    compileSafeSchema(schema, registry, sbcHelpers);
                }

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
        // Fast path: schema-compiled object with known size
        if (value !== null && value !== undefined && typeof value === 'object'
            && !(value instanceof Date) && !Array.isArray(value)
            && !(value instanceof Map) && !(value instanceof Set)
            && !ArrayBuffer.isView(value)) {

            let obj = value as Record<string, unknown>,
                schema = lookupSchema(obj, registry);

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

        // Fixed-size primitives
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
            let n = value as number;

            if (n >= 0 && n <= 255 && Number.isInteger(n)) {
                let p = allocUnsafe(2);

                p[0] = 255;
                p[1] = n;

                return p;
            }

            let p = allocUnsafe(9);

            p[0] = 252;
            writeF64.call(p, n, 1);

            return p;
        }

        if (vtype === 'bigint') {
            let p = allocUnsafe(9);

            p[0] = 248;
            writeBI64.call(p, value as bigint, 1);

            return p;
        }

        // Slow path: variable-length
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

            if (len >= 9 && buffer[0] === 246) {
                let hash = readU32.call(buffer, 1),
                    schema = registry.schemasByHash.get(hash);

                if (schema?.decodeFn) {
                    return schema.decodeFn(buffer, 9);
                }
            }

            if (len > 0 && buffer[0] !== 246) {
                return decodeSbc(buffer, 0, len);
            }

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

        encode: encodeValue,

        extractField(buffer: Uint8Array, fieldName: string, length?: number): unknown {
            let len = length ?? buffer.length;

            if (len < 9 || buffer[0] !== 246) {
                return undefined;
            }

            let hash = readU32.call(buffer, 1),
                schema = registry.schemasByHash.get(hash);

            if (!schema?.fieldExtractors) {
                return undefined;
            }

            let bitmapBytesCount = schema.nullableCount > 0 ? bitmapBytes(schema.nullableCount) : 0;

            if (bitmapBytesCount > 0 && schema.nullIndexMap) {
                let nullIdx = schema.nullIndexMap.get(fieldName);

                if (nullIdx !== undefined) {
                    let bitMask = 1 << (nullIdx & 7);

                    if (!(buffer[9 + (nullIdx >> 3)]! & bitMask)) {
                        return null;
                    }
                }
            }

            let extractor = schema.fieldExtractors.get(fieldName);

            if (!extractor) {
                return undefined;
            }

            return extractor(buffer, 9 + bitmapBytesCount);
        },

        importSchema(data: SerializedSchema): Schema {
            let schema = deserializeSchema(data);

            registerSchema(schema, registry);
            compileSafeSchema(schema, registry, sbcHelpers);

            return schema;
        },

        exportSchema(obj: Record<string, unknown>): SerializedSchema {
            let keysOut: string[][] = [],
                schema = lookupSchema(obj, registry, keysOut);

            if (!schema) {
                schema = inferSchema(obj, registry, keysOut[0]);
                registerSchema(schema, registry);
                compileSafeSchema(schema, registry, sbcHelpers);
            }

            return serializeSchema(schema);
        },
    };
};


export { buildComputeSize, buildDecoder, buildEncoder, buildFieldExtractors, compileSafeSchema, createSafeCodec, deserializeSchema, serializeSchema };

export type { SerializedSchema };
