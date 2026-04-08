// Schema Binary Codec — CSP-Safe v2 (no eval / new Function)
// Optimized closure-based encoder/decoder with:
//   1. Single-pass encoding into shared growable buffer (no computeSize pass)
//   2. Constructor-keyed fast path (skips instanceof cascade + lookupSchema)
//   3. Unrolled field writers with types resolved at compile time (no per-field switch)
// Wire-compatible with codegen and safe-v1 — identical binary output.

import { allocUnsafe, byteLen, isNode, readBI64, readF64, readI16, readI32, readShortStr, readU16, readU32, writeBI64, writeF64, writeI16, writeI32, writeU16, writeU32, writeUtf8 } from './platform';
import { buildSchemaFromDef, validateFieldName } from './codegen';
import { createRegistry, inferSchema, lookupSchema, parseFieldType, registerSchema, serializeFieldType } from './registry';

import type { FieldDef, FieldType, Schema, SchemaRegistry } from './platform';


type DecodeFn = (buf: Uint8Array, pos: number) => unknown;

type EncodeFn = (obj: unknown, buf: Uint8Array, pos: number) => number;

type ExtractFn = (buf: Uint8Array, pos: number) => unknown;

// Per-field writer: reads value from obj, writes to buf at off, returns new offset (for var fields)
type FixedWriterFn = (obj: Record<string, unknown>, buf: Uint8Array, off: number) => void;

type VarWriterFn = (obj: Record<string, unknown>, buf: Uint8Array, vp: number) => number;

// Per-field reader: reads from buf at off, returns value
type FixedReaderFn = (buf: Uint8Array, off: number) => unknown;

type VarReaderFn = (buf: Uint8Array, vp: number, bm: number) => { value: unknown; vp: number };


interface SerializedSchema {
    fields: { fixedSize: number; name: string; type: string }[];
    hash: number;
    id: number;
    nullableCount: number;
}


// ─── Unrolled Field Writer Factories ────────────────────────────────────────────
// Build one function per field at schema compile time — no switch dispatch per encode.

function makeFixedWriter(name: string, type: FieldType, offset: number): FixedWriterFn {
    switch (type) {
        case 'bigint': return (obj, buf, off) => { writeBI64.call(buf, obj[name] as bigint, off + offset); };
        case 'boolean': return (obj, buf, off) => { buf[off + offset] = (obj[name] as boolean) ? 1 : 0; };
        case 'date': return (obj, buf, off) => { writeF64.call(buf, (obj[name] as Date).getTime(), off + offset); };
        case 'float64': return (obj, buf, off) => { writeF64.call(buf, obj[name] as number, off + offset); };
        case 'int8': return (obj, buf, off) => { buf[off + offset] = (obj[name] as number) & 0xFF; };
        case 'int16': return (obj, buf, off) => { writeI16.call(buf, obj[name] as number, off + offset); };
        case 'int32': return (obj, buf, off) => { writeI32.call(buf, obj[name] as number, off + offset); };
        case 'uint8': return (obj, buf, off) => { buf[off + offset] = obj[name] as number; };
        case 'uint16': return (obj, buf, off) => { writeU16.call(buf, obj[name] as number, off + offset); };
        case 'uint32': return (obj, buf, off) => { writeU32.call(buf, obj[name] as number, off + offset); };
        default: return () => {};
    }
}

function makeFixedReader(_name: string, type: FieldType, offset: number): FixedReaderFn {
    switch (type) {
        case 'bigint': return (buf, off) => readBI64.call(buf, off + offset);
        case 'boolean': return (buf, off) => !!buf[off + offset];
        case 'date': return (buf, off) => new Date(readF64.call(buf, off + offset));
        case 'float64': return (buf, off) => readF64.call(buf, off + offset);
        case 'int8': return (buf, off) => (buf[off + offset]! << 24 >> 24);
        case 'int16': return (buf, off) => readI16.call(buf, off + offset);
        case 'int32': return (buf, off) => readI32.call(buf, off + offset);
        case 'uint8': return (buf, off) => buf[off + offset]!;
        case 'uint16': return (buf, off) => readU16.call(buf, off + offset);
        case 'uint32': return (buf, off) => readU32.call(buf, off + offset);
        default: return () => undefined;
    }
}

function makeVarWriter(name: string, type: FieldType, _nullIndex: number | undefined, encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number): VarWriterFn {
    if (typeof type === 'string') {
        if (type === 'string') {
            return (obj, buf, vp) => {
                let str = obj[name] as string,
                    len = byteLen(str);

                writeU32.call(buf, len, vp);
                vp += 4;
                writeUtf8.call(buf, str, vp, len);

                return vp + len;
            };
        }

        if (type === 'bytes') {
            return (obj, buf, vp) => {
                let bytes = obj[name] as Uint8Array;

                writeU32.call(buf, bytes.length, vp);
                vp += 4;
                buf.set(bytes, vp);

                return vp + bytes.length;
            };
        }

        return (_obj, _buf, vp) => vp;
    }

    if (type.kind === 'nullable') {
        let inner = type.inner;

        return (obj, buf, vp) => {
            let val = obj[name];

            if (val == null) {
                return vp;
            }

            return writeVarInner(inner, val, buf, vp, encodeSbc);
        };
    }

    if (type.kind === 'object') {
        return (obj, buf, vp) => {
            let startPos = vp;

            vp += 4;
            vp = encodeSbc(obj[name], buf, vp);
            writeU32.call(buf, vp - startPos - 4, startPos);

            return vp;
        };
    }

    if (type.kind === 'array') {
        let elem = type.element;

        return (obj, buf, vp) => {
            let arr = obj[name] as unknown[];

            writeU16.call(buf, arr.length, vp);
            vp += 2;

            return writeArrayElements(arr, elem, buf, vp, encodeSbc);
        };
    }

    return (_obj, _buf, vp) => vp;
}

function makeVarReader(_name: string, type: FieldType, nullIndex: number | undefined, decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown): VarReaderFn {
    if (typeof type === 'string') {
        if (type === 'string') {
            return (buf, vp) => {
                let len = readU32.call(buf, vp);

                vp += 4;

                return { value: readShortStr(buf, vp, vp + len), vp: vp + len };
            };
        }

        if (type === 'bytes') {
            return (buf, vp) => {
                let len = readU32.call(buf, vp);

                vp += 4;

                return { value: buf.subarray(vp, vp + len), vp: vp + len };
            };
        }

        return (_buf, vp) => ({ value: undefined, vp });
    }

    if (type.kind === 'nullable') {
        let inner = type.inner,
            idx = nullIndex!;

        return (buf, vp, bm) => {
            if (!(bm & (1 << idx))) {
                return { value: null, vp };
            }

            return readVarInner(inner, buf, vp, decodeSbc);
        };
    }

    if (type.kind === 'object') {
        return (buf, vp) => {
            let len = readU32.call(buf, vp);

            vp += 4;

            return { value: decodeSbc(buf, vp, len), vp: vp + len };
        };
    }

    if (type.kind === 'array') {
        let elem = type.element;

        return (buf, vp) => {
            let count = readU16.call(buf, vp);

            vp += 2;

            let arr = new Array(count);

            vp = readArrayElements(arr, count, elem, buf, vp, decodeSbc);

            return { value: arr, vp };
        };
    }

    return (_buf, vp) => ({ value: undefined, vp });
}


// ─── Shared Helpers ─────────────────────────────────────────────────────────────

function writeVarInner(type: FieldType, val: unknown, buf: Uint8Array, vp: number, encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number): number {
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

function writeArrayElements(arr: unknown[], elem: FieldType, buf: Uint8Array, vp: number, encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number): number {
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
            case 'uint16':
                for (let i = 0, n = arr.length; i < n; i++) {
                    writeU16.call(buf, arr[i] as number, vp);
                    vp += 2;
                }

                return vp;
            case 'uint32':
                for (let i = 0, n = arr.length; i < n; i++) {
                    writeU32.call(buf, arr[i] as number, vp);
                    vp += 4;
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

function readVarInner(type: FieldType, buf: Uint8Array, vp: number, _decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown): { value: unknown; vp: number } {
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

                return { value: readShortStr(buf, vp, vp + len), vp: vp + len };
            }
            case 'uint8': return { value: buf[vp], vp: vp + 1 };
            case 'uint16': return { value: readU16.call(buf, vp), vp: vp + 2 };
            case 'uint32': return { value: readU32.call(buf, vp), vp: vp + 4 };
        }
    }

    return { value: undefined, vp };
}

function readArrayElements(arr: unknown[], count: number, elem: FieldType, buf: Uint8Array, vp: number, decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown): number {
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
            case 'string':
                for (let i = 0; i < count; i++) {
                    let len = readU32.call(buf, vp);

                    vp += 4;
                    arr[i] = readShortStr(buf, vp, vp + len);
                    vp += len;
                }

                return vp;
            case 'uint16':
                for (let i = 0; i < count; i++) {
                    arr[i] = readU16.call(buf, vp);
                    vp += 2;
                }

                return vp;
            case 'uint32':
                for (let i = 0; i < count; i++) {
                    arr[i] = readU32.call(buf, vp);
                    vp += 4;
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


// ─── Build Encoder v2 (unrolled, no per-field switch) ───────────────────────────

function bitmapBytes(count: number): number {
    return (count + 7) >> 3;
}

function buildEncoderV2(schema: Schema, encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number): EncodeFn {
    let fields = schema.fields,
        fixedSize = schema.fixedSize,
        fixedWriters: FixedWriterFn[] = [],
        hasNullable = schema.nullableCount > 0,
        nullBmBytes = hasNullable ? bitmapBytes(schema.nullableCount) : 0,
        nullableVarIndices: number[] = [],
        nullableVarNullIdx: number[] = [],
        nullableVarNames: string[] = [],
        varWriters: VarWriterFn[] = [];

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.fixedSize > 0) {
            fixedWriters.push(makeFixedWriter(field.name, field.type, field.offset));
        }
        else if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            // Track nullable var fields separately for bitmap
            let vi = varWriters.length;

            nullableVarIndices.push(vi);
            nullableVarNullIdx.push(field._nullIndex!);
            nullableVarNames.push(field.name);
            varWriters.push(makeVarWriter(field.name, field.type, field._nullIndex, encodeSbc));
        }
        else {
            varWriters.push(makeVarWriter(field.name, field.type, field._nullIndex, encodeSbc));
        }
    }

    let fN = fixedWriters.length,
        nN = nullableVarIndices.length,
        vN = varWriters.length;

    return (obj: unknown, buf: Uint8Array, pos: number): number => {
        let o = obj as Record<string, unknown>;

        // Null bitmap
        let bmPos = -1,
            bm = 0;

        if (hasNullable) {
            bmPos = pos;
            pos += nullBmBytes;
        }

        // Fixed fields — each writer has offset baked in
        for (let i = 0; i < fN; i++) {
            fixedWriters[i]!(o, buf, pos);
        }

        // Variable fields
        let vp = pos + fixedSize;

        for (let i = 0; i < vN; i++) {
            vp = varWriters[i]!(o, buf, vp);
        }

        // Compute null bitmap from nullable var fields
        if (hasNullable && bmPos >= 0) {
            for (let i = 0; i < nN; i++) {
                if (o[nullableVarNames[i]!] != null) {
                    bm |= (1 << nullableVarNullIdx[i]!);
                }
            }

            buf[bmPos] = bm & 0xFF;

            if (nullBmBytes > 1) {
                buf[bmPos + 1] = (bm >> 8) & 0xFF;
            }
        }

        return vp;
    };
}


// ─── Build Decoder v2 (unrolled, no per-field switch) ───────────────────────────

function buildDecoderV2(schema: Schema, decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown): DecodeFn {
    let fields = schema.fields,
        fixedReaders: { name: string; read: FixedReaderFn }[] = [],
        hasNullable = schema.nullableCount > 0,
        nullBmBytes = hasNullable ? bitmapBytes(schema.nullableCount) : 0,
        sortedNames = fields.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(f => f.name),
        varReaders: { name: string; read: VarReaderFn }[] = [];

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.fixedSize > 0) {
            fixedReaders.push({ name: field.name, read: makeFixedReader(field.name, field.type, field.offset) });
        }
        else {
            varReaders.push({ name: field.name, read: makeVarReader(field.name, field.type, field._nullIndex, decodeSbc) });
        }
    }

    let fN = fixedReaders.length,
        fixedSize = schema.fixedSize,
        sN = sortedNames.length,
        vN = varReaders.length;

    return (buf: Uint8Array, pos: number): unknown => {
        let bm = 0,
            result: Record<string, unknown> = {};

        if (hasNullable) {
            bm = buf[pos]!;

            if (nullBmBytes > 1) {
                bm |= buf[pos + 1]! << 8;
            }

            pos += nullBmBytes;
        }

        for (let i = 0; i < fN; i++) {
            let r = fixedReaders[i]!;

            result[r.name] = r.read(buf, pos);
        }

        let vp = pos + fixedSize;

        for (let i = 0; i < vN; i++) {
            let r = varReaders[i]!,
                decoded = r.read(buf, vp, bm);

            result[r.name] = decoded.value;
            vp = decoded.vp;
        }

        // Sorted key order for consistency
        let sorted: Record<string, unknown> = {};

        for (let i = 0; i < sN; i++) {
            sorted[sortedNames[i]!] = result[sortedNames[i]!];
        }

        return sorted;
    };
}


// ─── Build Field Extractors v2 ──────────────────────────────────────────────────

function buildFieldExtractorsV2(schema: Schema): Map<string, ExtractFn> {
    let extractors = new Map<string, ExtractFn>(),
        fixedSize = schema.fixedSize,
        varFields: FieldDef[] = [];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            let reader = makeFixedReader(field.name, field.type, field.offset);

            extractors.set(field.name, (buf: Uint8Array, pos: number): unknown => reader(buf, pos));
        }
        else {
            varFields.push(field);
        }
    }

    for (let vi = 0, vn = varFields.length; vi < vn; vi++) {
        let target = varFields[vi]!;

        if (typeof target.type !== 'string' || (target.type !== 'string' && target.type !== 'bytes')) {
            continue;
        }

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

function serializeSchemaV2(schema: Schema): SerializedSchema {
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

function deserializeSchemaV2(data: SerializedSchema): Schema {
    for (let i = 0, n = data.fields.length; i < n; i++) {
        validateFieldName(data.fields[i]!.name);
    }

    return buildSchemaFromDef(data, parseFieldType);
}


// ─── Compile Schema v2 ─────────────────────────────────────────────────────────

function compileSafeSchemaV2(schema: Schema, _registry: SchemaRegistry, helpers: { decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number }): void {
    schema.encodeFn = buildEncoderV2(schema, helpers.encodeSbc);
    schema.decodeFn = buildDecoderV2(schema, helpers.decodeSbc);
    schema.fieldExtractors = buildFieldExtractorsV2(schema);

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


// ─── CSP-Safe Codec v2 Factory ──────────────────────────────────────────────────

const createSafeCodecV2 = (): {
    decode(buffer: Uint8Array, length?: number): unknown;
    encode(value: unknown): Uint8Array;
    exportSchema(obj: Record<string, unknown>): SerializedSchema;
    extractField(buffer: Uint8Array, fieldName: string, length?: number): unknown;
    importSchema(data: SerializedSchema): Schema;
} => {
    // Shared growable encode buffer — single allocation, reused across calls
    let buf = allocUnsafe(65536),
        bufLen = 65536,
        ctorCache = new WeakMap<Function, (obj: Record<string, unknown>) => Uint8Array>(),
        hashCache = new Map<number, (obj: Record<string, unknown>) => Uint8Array>(),
        lastFieldCount = 0,
        lastFieldNames: string[] | null = null,
        lastHash = 0,
        lastDirectFn: ((obj: Record<string, unknown>) => Uint8Array) | null = null,
        registry = createRegistry(),
        sbcHelpers = {
            decodeSbc: (b: Uint8Array, offset: number, len: number): unknown => decodeSbc(b, offset, len),
            encodeSbc: (value: unknown, b: Uint8Array, pos: number): number => encodeSbc(value, b, pos),
        };

    function ensureCapacity(needed: number): void {
        if (needed <= bufLen) {
            return;
        }

        bufLen = Math.max(needed, bufLen * 2);
        buf = allocUnsafe(bufLen);
    }

    // Get or create direct encoder for a schema — cached by hash
    function getDirectEncoder(schema: Schema): (obj: Record<string, unknown>) => Uint8Array {
        let hash = schema.hash;

        // Monomorphic fast path — same schema as last call
        if (hash === lastHash && lastDirectFn) {
            return lastDirectFn;
        }

        let cached = hashCache.get(hash);

        if (cached) {
            lastHash = hash;
            lastDirectFn = cached;

            return cached;
        }

        let encodeFn = schema.encodeFn!;

        let fn = (obj: Record<string, unknown>): Uint8Array => {
            ensureCapacity(65536);
            buf[0] = 246;
            writeU32.call(buf, hash, 1);

            let end = encodeFn(obj, buf, 9);

            if (end > bufLen) {
                ensureCapacity(end + 1024);
                buf[0] = 246;
                writeU32.call(buf, hash, 1);
                end = encodeFn(obj, buf, 9);
            }

            writeU32.call(buf, end - 9, 5);

            let result = allocUnsafe(end);

            result.set(buf.subarray(0, end));

            return result;
        };

        hashCache.set(hash, fn);
        lastHash = hash;
        lastDirectFn = fn;
        lastFieldCount = schema.fields.length;
        lastFieldNames = schema.fields.map(f => f.name);

        return fn;
    }

    function resolveAndEncode(obj: Record<string, unknown>): Uint8Array {
        let keysOut: string[][] = [],
            schema = lookupSchema(obj, registry, keysOut);

        if (!schema) {
            schema = inferSchema(obj, registry, keysOut[0]);
            registerSchema(schema, registry);
            compileSafeSchemaV2(schema, registry, sbcHelpers);
        }

        // Cache by constructor too for custom classes
        let ctor = obj.constructor;

        if (ctor !== Object && ctor !== undefined) {
            ctorCache.set(ctor, getDirectEncoder(schema));
        }

        return getDirectEncoder(schema)(obj);
    }

    function decodeTagEnd(b: Uint8Array, offset: number, tag: number, depth: number = 0): number {
        if (depth > 128) {
            throw new RangeError('SBC: decode nesting depth exceeds 128');
        }

        switch (tag) {
            case 0: return offset + 1;
            case 245:
            case 246: return offset + 9 + readU32.call(b, offset + 5);
            case 248: return offset + 9;
            case 249: {
                let count = readU16.call(b, offset + 1),
                    p = offset + 3;

                for (let i = 0; i < count; i++) {
                    p = decodeTagEnd(b, p, b[p]!, depth + 1);
                }

                return p;
            }
            case 250: return offset + 9;
            case 251: return offset + 2;
            case 252: return offset + 9;
            case 253: return offset + 5 + readU32.call(b, offset + 1);
            case 254: return offset + 5 + readU32.call(b, offset + 1);
            case 255: return offset + 2;
            default:
                throw new RangeError('SBC: unknown tag ' + tag + ' at offset ' + offset);
        }
    }

    function decodeSbc(b: Uint8Array, offset: number, len: number): unknown {
        if (len === 0) {
            return undefined;
        }

        let tag = b[offset]!;

        switch (tag) {
            case 0:
                return null;

            case 248:
                return readBI64.call(b, offset + 1);

            case 249: {
                let count = readU16.call(b, offset + 1),
                    arr = new Array(count),
                    p = offset + 3;

                for (let i = 0; i < count; i++) {
                    let elemTag = b[p]!,
                        elemEnd = decodeTagEnd(b, p, elemTag);

                    arr[i] = decodeSbc(b, p, elemEnd - p);
                    p = elemEnd;
                }

                return arr;
            }

            case 250:
                return new Date(readF64.call(b, offset + 1));

            case 251:
                return !!b[offset + 1];

            case 252:
                return readF64.call(b, offset + 1);

            case 253: {
                let sLen = readU32.call(b, offset + 1);

                return readShortStr(b, offset + 5, offset + 5 + sLen);
            }

            case 254: {
                let bLen = readU32.call(b, offset + 1),
                    slice = b.subarray(offset + 5, offset + 5 + bLen);

                if (isNode) {
                    return Buffer.from(slice);
                }

                return new Uint8Array(slice);
            }

            case 255:
                return b[offset + 1]!;

            case 246: {
                let hash = readU32.call(b, offset + 1),
                    schema = registry.schemasByHash.get(hash);

                if (!schema || !schema.decodeFn) {
                    return null;
                }

                return schema.decodeFn(b, offset + 9);
            }

            default:
                return null;
        }
    }

    function encodeSbc(value: unknown, b: Uint8Array, pos: number, depth: number = 0): number {
        if (value === null || value === undefined) {
            b[pos] = 0;

            return pos + 1;
        }

        switch (typeof value) {
            case 'bigint':
                b[pos] = 248;
                writeBI64.call(b, value, pos + 1);

                return pos + 9;

            case 'boolean':
                b[pos] = 251;
                b[pos + 1] = value ? 1 : 0;

                return pos + 2;

            case 'number': {
                let n = value as number;

                if (n >= 0 && n <= 255 && Number.isInteger(n)) {
                    b[pos] = 255;
                    b[pos + 1] = n;

                    return pos + 2;
                }

                b[pos] = 252;
                writeF64.call(b, n, pos + 1);

                return pos + 9;
            }

            case 'string': {
                let sLen = byteLen(value),
                    end = pos + 5 + sLen;

                if (end > b.length) {
                    return end;
                }

                b[pos] = 253;
                writeU32.call(b, sLen, pos + 1);
                writeUtf8.call(b, value, pos + 5, sLen);

                return end;
            }

            case 'object': {
                if (depth > 128) {
                    throw new RangeError('SBC: encode nesting depth exceeds 128');
                }

                if (value instanceof Date) {
                    b[pos] = 250;
                    writeF64.call(b, value.getTime(), pos + 1);

                    return pos + 9;
                }

                if (value instanceof Uint8Array) {
                    let end = pos + 5 + value.length;

                    if (end > b.length) {
                        return end;
                    }

                    b[pos] = 254;
                    writeU32.call(b, value.length, pos + 1);
                    b.set(value, pos + 5);

                    return end;
                }

                if (Array.isArray(value)) {
                    b[pos] = 249;
                    writeU16.call(b, value.length, pos + 1);

                    let p = pos + 3;

                    for (let i = 0, n = value.length; i < n; i++) {
                        p = encodeSbc(value[i], b, p, depth + 1);
                    }

                    return p;
                }

                if (value instanceof Map) {
                    let map = value as Map<unknown, unknown>;

                    b[pos] = 249;
                    writeU16.call(b, map.size, pos + 1);

                    let p = pos + 3;

                    for (let [k, v] of map) {
                        b[p] = 249;
                        writeU16.call(b, 2, p + 1);
                        p += 3;
                        p = encodeSbc(k, b, p, depth + 1);
                        p = encodeSbc(v, b, p, depth + 1);
                    }

                    return p;
                }

                if (value instanceof Set) {
                    let set = value as Set<unknown>;

                    b[pos] = 249;
                    writeU16.call(b, set.size, pos + 1);

                    let p = pos + 3;

                    for (let item of set) {
                        p = encodeSbc(item, b, p, depth + 1);
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
                    compileSafeSchemaV2(schema, registry, sbcHelpers);
                }

                b[pos] = 246;
                writeU32.call(b, schema.hash, pos + 1);

                let end = schema.encodeFn!(obj, b, pos + 9);

                writeU32.call(b, end - pos - 9, pos + 5);

                return end;
            }

            default:
                b[pos] = 0;

                return pos + 1;
        }
    }

    // ─── Public API ─────────────────────────────────────────────────────────────

    function encode(value: unknown): Uint8Array {
        // Fast path 0: monomorphic — same shape as last object encoded
        if (value !== null && typeof value === 'object' && lastDirectFn && lastFieldNames) {
            let ctor = (value as Record<string, unknown>).constructor;

            if (ctor === Object || ctor === undefined) {
                let obj = value as Record<string, unknown>,
                    keys = Object.keys(obj);

                if (keys.length === lastFieldCount) {
                    let match = true;

                    for (let i = 0, n = lastFieldCount; i < n; i++) {
                        if (!(lastFieldNames[i]! in obj)) {
                            match = false;
                            break;
                        }
                    }

                    if (match) {
                        return lastDirectFn(obj);
                    }
                }
            }
        }

        // Fast path 1: constructor-cached direct encoder (skips typeof, instanceof, lookupSchema)
        if (value !== null && typeof value === 'object') {
            let ctor = (value as Record<string, unknown>).constructor;

            if (ctor !== undefined && ctor !== Object) {
                // Check for non-plain-object types first (these should NOT hit ctorCache)
                if (value instanceof Date) {
                    let p = allocUnsafe(9);

                    p[0] = 250;
                    writeF64.call(p, (value as Date).getTime(), 1);

                    return p;
                }

                if (value instanceof Uint8Array) {
                    let p = allocUnsafe(5 + (value as Uint8Array).length);

                    p[0] = 254;
                    writeU32.call(p, (value as Uint8Array).length, 1);
                    p.set(value as Uint8Array, 5);

                    return p;
                }

                let cached = ctorCache.get(ctor);

                if (cached) {
                    return cached(value as Record<string, unknown>);
                }
            }

            // Fast path 2: plain object with known schema — use cached direct encoder
            if (!Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set) && !ArrayBuffer.isView(value)) {
                let obj = value as Record<string, unknown>,
                    schema = lookupSchema(obj, registry);

                if (schema?.encodeFn) {
                    return getDirectEncoder(schema)(obj);
                }

                return resolveAndEncode(obj);
            }
        }

        // Primitives and slow path
        if (value === null || value === undefined) {
            let p = allocUnsafe(1);

            p[0] = 0;

            return p;
        }

        if (typeof value === 'boolean') {
            let p = allocUnsafe(2);

            p[0] = 251;
            p[1] = value ? 1 : 0;

            return p;
        }

        if (typeof value === 'number') {
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

        if (typeof value === 'bigint') {
            let p = allocUnsafe(9);

            p[0] = 248;
            writeBI64.call(p, value, 1);

            return p;
        }

        // Variable-length slow path (arrays, maps, sets, strings, bytes)
        ensureCapacity(65536);

        let end = encodeSbc(value, buf, 0);

        while (end > bufLen) {
            ensureCapacity(end + 1024);
            end = encodeSbc(value, buf, 0);
        }

        let result = allocUnsafe(end);

        result.set(buf.subarray(0, end));

        return result;
    }

    function decode(buffer: Uint8Array, length?: number): unknown {
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

        return decodeSbc(buffer, 0, len);
    }

    function extractField(buffer: Uint8Array, fieldName: string, length?: number): unknown {
        let len = length ?? buffer.length;

        if (len < 9 || buffer[0] !== 246) {
            return undefined;
        }

        let hash = readU32.call(buffer, 1),
            schema = registry.schemasByHash.get(hash);

        if (!schema?.fieldExtractors) {
            return undefined;
        }

        let extractor = schema.fieldExtractors.get(fieldName);

        if (!extractor) {
            return undefined;
        }

        return extractor(buffer, 9);
    }

    function importSchema(data: SerializedSchema): Schema {
        let schema = deserializeSchemaV2(data);

        registerSchema(schema, registry);
        compileSafeSchemaV2(schema, registry, sbcHelpers);

        return schema;
    }

    function exportSchema(obj: Record<string, unknown>): SerializedSchema {
        let schema = lookupSchema(obj, registry);

        if (!schema) {
            schema = inferSchema(obj, registry);
            registerSchema(schema, registry);
            compileSafeSchemaV2(schema, registry, sbcHelpers);
        }

        return serializeSchemaV2(schema);
    }

    return { decode, encode, exportSchema, extractField, importSchema };
};


export { buildDecoderV2, buildEncoderV2, buildFieldExtractorsV2, compileSafeSchemaV2, createSafeCodecV2, deserializeSchemaV2, serializeSchemaV2 };
export type { SerializedSchema };
