// SBC Encoder Variant Benchmarks
// Compares the current `new Function()` codegen encoder against eval-free alternatives.
//
// Variants:
//   1. codegen   — current encoder: `new Function()` string-compiled per schema
//   2. dispatch  — opcode dispatch table: schema → op[] loop, switch-based write
//   3. closure   — closure chain: schema → composed function pipeline, no code strings
//   4. direct    — direct DataView sequential writes with field descriptor array
//   5. hybrid    — closure-per-field with unrolled fixed prefix + var loop
//
// Each variant produces identical wire output (verified before benchmarking).

import { afterAll, bench, describe } from 'vitest';
import { pack } from 'msgpackr';

import { allocUnsafe, byteLen, FIELD_SIZES, isNode, readU32, writeBI64, writeF64, writeU16, writeU32, writeUtf8, writeVarint, writeZigzag } from '../../src/sbc/platform';
import { compileSchema, buildSchema } from '../../src/sbc/codegen';
import { createCodec, createRegistry, inferSchema, lookupSchema, registerSchema } from '../../src/sbc';

import { createCodec as createProtoCodec } from '../utils';
import { createSafeCodec } from '../../src/sbc/safe';
import { createSafeCodecV2 } from '../../src/sbc/safe-v2';

import type { FieldDef, FieldType, Schema, SchemaRegistry } from '../../src/sbc/platform';


// ─── Shared Types ───────────────────────────────────────────────────────────────


type EncodeFn = (obj: Record<string, unknown>, buf: Uint8Array, pos: number) => number;

type SizeFn = (obj: Record<string, unknown>) => number;


// ─── Variant 2: Dispatch Table ──────────────────────────────────────────────────
// Pre-compute an array of operation descriptors from the schema.
// The encoder loops through ops and dispatches via switch.

const enum Op {
    BIGINT,
    BOOLEAN,
    BYTES,
    DATE,
    FLOAT64,
    INT8,
    INT16,
    INT32,
    STRING,
    UINT8,
    UINT16,
    UINT32,
}

interface FixedOp {
    field: string;
    offset: number;
    op: Op;
}

interface VarOp {
    field: string;
    op: Op;
}

function typeToOp(type: FieldType): Op | null {
    if (typeof type !== 'string') {
        return null;
    }

    switch (type) {
        case 'bigint': return Op.BIGINT;
        case 'boolean': return Op.BOOLEAN;
        case 'bytes': return Op.BYTES;
        case 'date': return Op.DATE;
        case 'float64': return Op.FLOAT64;
        case 'int8': return Op.INT8;
        case 'int16': return Op.INT16;
        case 'int32': return Op.INT32;
        case 'string': return Op.STRING;
        case 'uint8': return Op.UINT8;
        case 'uint16': return Op.UINT16;
        case 'uint32': return Op.UINT32;
        default: return null;
    }
}

function buildDispatchEncoder(schema: Schema): EncodeFn {
    let fixedOps: FixedOp[] = [],
        varOps: VarOp[] = [];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!,
            op = typeToOp(field.type);

        if (op === null) {
            continue;
        }

        if (field.fixedSize > 0) {
            fixedOps.push({ field: field.name, offset: field.offset, op });
        }
        else {
            varOps.push({ field: field.name, op });
        }
    }

    return (obj: Record<string, unknown>, buf: Uint8Array, pos: number): number => {
        // Fixed fields
        for (let i = 0, n = fixedOps.length; i < n; i++) {
            let { field, offset, op } = fixedOps[i]!,
                off = pos + offset,
                val = obj[field];

            switch (op) {
                case Op.BIGINT:
                    writeBI64.call(buf, val as bigint, off);
                    break;
                case Op.BOOLEAN:
                    buf[off] = (val as boolean) ? 1 : 0;
                    break;
                case Op.DATE:
                    writeF64.call(buf, (val as Date).getTime(), off);
                    break;
                case Op.FLOAT64:
                    writeF64.call(buf, val as number, off);
                    break;
                case Op.INT8:
                    buf[off] = (val as number) & 0xFF;
                    break;
                case Op.INT16:
                    writeU16.call(buf, (val as number) & 0xFFFF, off);
                    break;
                case Op.INT32:
                    writeU32.call(buf, val as number, off);
                    break;
                case Op.UINT8:
                    buf[off] = val as number;
                    break;
                case Op.UINT16:
                    writeU16.call(buf, val as number, off);
                    break;
                case Op.UINT32:
                    writeU32.call(buf, val as number, off);
                    break;
            }
        }

        // Variable fields
        let vp = pos + schema.fixedSize;

        for (let i = 0, n = varOps.length; i < n; i++) {
            let { field, op } = varOps[i]!,
                val = obj[field];

            switch (op) {
                case Op.STRING: {
                    let str = val as string,
                        len = byteLen(str);

                    writeU32.call(buf, len, vp);
                    vp += 4;
                    writeUtf8.call(buf, str, vp, len);
                    vp += len;
                    break;
                }
                case Op.BYTES: {
                    let bytes = val as Uint8Array;

                    writeU32.call(buf, bytes.length, vp);
                    vp += 4;
                    buf.set(bytes, vp);
                    vp += bytes.length;
                    break;
                }
            }
        }

        return vp;
    };
}


// ─── Variant 3: Closure Chain ───────────────────────────────────────────────────
// Build a linked chain of closures at schema-compile time.
// Each closure captures its field name and offset, writes one field, returns new pos.

type FieldWriter = (obj: Record<string, unknown>, buf: Uint8Array, pos: number) => number;

function makeFixedWriter(field: string, offset: number, type: FieldType): FieldWriter | null {
    switch (type) {
        case 'bigint':
            return (obj, buf, pos) => { writeBI64.call(buf, obj[field] as bigint, pos + offset); return pos; };
        case 'boolean':
            return (obj, buf, pos) => { buf[pos + offset] = (obj[field] as boolean) ? 1 : 0; return pos; };
        case 'date':
            return (obj, buf, pos) => { writeF64.call(buf, (obj[field] as Date).getTime(), pos + offset); return pos; };
        case 'float64':
            return (obj, buf, pos) => { writeF64.call(buf, obj[field] as number, pos + offset); return pos; };
        case 'int8':
            return (obj, buf, pos) => { buf[pos + offset] = (obj[field] as number) & 0xFF; return pos; };
        case 'int16':
            return (obj, buf, pos) => { writeU16.call(buf, (obj[field] as number) & 0xFFFF, pos + offset); return pos; };
        case 'int32':
            return (obj, buf, pos) => { writeU32.call(buf, obj[field] as number, pos + offset); return pos; };
        case 'uint8':
            return (obj, buf, pos) => { buf[pos + offset] = obj[field] as number; return pos; };
        case 'uint16':
            return (obj, buf, pos) => { writeU16.call(buf, obj[field] as number, pos + offset); return pos; };
        case 'uint32':
            return (obj, buf, pos) => { writeU32.call(buf, obj[field] as number, pos + offset); return pos; };
        default:
            return null;
    }
}

function makeVarWriter(field: string, type: FieldType): FieldWriter | null {
    switch (type) {
        case 'string':
            return (obj, buf, vp) => {
                let str = obj[field] as string,
                    len = byteLen(str);

                writeU32.call(buf, len, vp);
                vp += 4;
                writeUtf8.call(buf, str, vp, len);

                return vp + len;
            };
        case 'bytes':
            return (obj, buf, vp) => {
                let bytes = obj[field] as Uint8Array;

                writeU32.call(buf, bytes.length, vp);
                vp += 4;
                buf.set(bytes, vp);

                return vp + bytes.length;
            };
        default:
            return null;
    }
}

function buildClosureEncoder(schema: Schema): EncodeFn {
    let fixedWriters: FieldWriter[] = [],
        varWriters: FieldWriter[] = [];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            let w = makeFixedWriter(field.name, field.offset, field.type);

            if (w) {
                fixedWriters.push(w);
            }
        }
        else {
            let w = makeVarWriter(field.name, field.type);

            if (w) {
                varWriters.push(w);
            }
        }
    }

    let fixedN = fixedWriters.length,
        varN = varWriters.length;

    return (obj: Record<string, unknown>, buf: Uint8Array, pos: number): number => {
        for (let i = 0; i < fixedN; i++) {
            fixedWriters[i]!(obj, buf, pos);
        }

        let vp = pos + schema.fixedSize;

        for (let i = 0; i < varN; i++) {
            vp = varWriters[i]!(obj, buf, vp);
        }

        return vp;
    };
}


// ─── Variant 4: Direct DataView ─────────────────────────────────────────────────
// No code generation, no closures. Pure DataView sequential writes
// driven by reading field descriptors directly from the schema.

function buildDirectEncoder(schema: Schema): EncodeFn {
    let fields = schema.fields,
        fixedSize = schema.fixedSize,
        n = fields.length;

    return (obj: Record<string, unknown>, buf: Uint8Array, pos: number): number => {
        // Fixed fields — inline dispatch on each field's type
        for (let i = 0; i < n; i++) {
            let field = fields[i]!;

            if (field.fixedSize <= 0) {
                continue;
            }

            let off = pos + field.offset,
                val = obj[field.name];

            switch (field.type) {
                case 'bigint':
                    writeBI64.call(buf, val as bigint, off);
                    break;
                case 'boolean':
                    buf[off] = (val as boolean) ? 1 : 0;
                    break;
                case 'date':
                    writeF64.call(buf, (val as Date).getTime(), off);
                    break;
                case 'float64':
                    writeF64.call(buf, val as number, off);
                    break;
                case 'int8':
                    buf[off] = (val as number) & 0xFF;
                    break;
                case 'int16':
                    writeU16.call(buf, (val as number) & 0xFFFF, off);
                    break;
                case 'int32':
                    writeU32.call(buf, val as number, off);
                    break;
                case 'uint8':
                    buf[off] = val as number;
                    break;
                case 'uint16':
                    writeU16.call(buf, val as number, off);
                    break;
                case 'uint32':
                    writeU32.call(buf, val as number, off);
                    break;
            }
        }

        // Variable fields
        let vp = pos + fixedSize;

        for (let i = 0; i < n; i++) {
            let field = fields[i]!;

            if (field.fixedSize > 0) {
                continue;
            }

            let val = obj[field.name];

            if (field.type === 'string') {
                let str = val as string,
                    len = byteLen(str);

                writeU32.call(buf, len, vp);
                vp += 4;
                writeUtf8.call(buf, str, vp, len);
                vp += len;
            }
            else if (field.type === 'bytes') {
                let bytes = val as Uint8Array;

                writeU32.call(buf, bytes.length, vp);
                vp += 4;
                buf.set(bytes, vp);
                vp += bytes.length;
            }
        }

        return vp;
    };
}


// ─── Variant 5: Hybrid (unrolled fixed + var loop) ──────────────────────────────
// Pre-builds a single closure that has the fixed-field writes baked in
// as individual captured offsets (no loop for fixed), then loops variable fields.

function buildHybridEncoder(schema: Schema): EncodeFn {
    // Separate fixed fields into individual captured closures for monomorphic access
    let fixedFn: ((obj: Record<string, unknown>, buf: Uint8Array, pos: number) => void) | null = null,
        varWriters: FieldWriter[] = [];

    // Build a single fixed-field writer that captures all fixed field offsets
    let fixedFields: FieldDef[] = [];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            fixedFields.push(field);
        }
        else {
            let w = makeVarWriter(field.name, field.type);

            if (w) {
                varWriters.push(w);
            }
        }
    }

    // Build specialized fixed writer based on field count + types
    if (fixedFields.length === 1) {
        let f = fixedFields[0]!,
            field = f.name,
            offset = f.offset;

        fixedFn = buildSingleFixedWriter(field, offset, f.type);
    }
    else if (fixedFields.length > 1) {
        let writers: ((obj: Record<string, unknown>, buf: Uint8Array, pos: number) => void)[] = [];

        for (let i = 0, n = fixedFields.length; i < n; i++) {
            let f = fixedFields[i]!,
                w = buildSingleFixedWriter(f.name, f.offset, f.type);

            if (w) {
                writers.push(w);
            }
        }

        let wn = writers.length;

        fixedFn = (obj, buf, pos) => {
            for (let i = 0; i < wn; i++) {
                writers[i]!(obj, buf, pos);
            }
        };
    }

    let fixedSize = schema.fixedSize,
        varN = varWriters.length;

    if (fixedFn && varN > 0) {
        let ff = fixedFn;

        return (obj: Record<string, unknown>, buf: Uint8Array, pos: number): number => {
            ff(obj, buf, pos);

            let vp = pos + fixedSize;

            for (let i = 0; i < varN; i++) {
                vp = varWriters[i]!(obj, buf, vp);
            }

            return vp;
        };
    }

    if (fixedFn) {
        let ff = fixedFn;

        return (obj: Record<string, unknown>, buf: Uint8Array, pos: number): number => {
            ff(obj, buf, pos);

            return pos + fixedSize;
        };
    }

    return (obj: Record<string, unknown>, buf: Uint8Array, pos: number): number => {
        let vp = pos + fixedSize;

        for (let i = 0; i < varN; i++) {
            vp = varWriters[i]!(obj, buf, vp);
        }

        return vp;
    };
}

function buildSingleFixedWriter(field: string, offset: number, type: FieldType): ((obj: Record<string, unknown>, buf: Uint8Array, pos: number) => void) | null {
    switch (type) {
        case 'bigint':
            return (obj, buf, pos) => { writeBI64.call(buf, obj[field] as bigint, pos + offset); };
        case 'boolean':
            return (obj, buf, pos) => { buf[pos + offset] = (obj[field] as boolean) ? 1 : 0; };
        case 'date':
            return (obj, buf, pos) => { writeF64.call(buf, (obj[field] as Date).getTime(), pos + offset); };
        case 'float64':
            return (obj, buf, pos) => { writeF64.call(buf, obj[field] as number, pos + offset); };
        case 'int8':
            return (obj, buf, pos) => { buf[pos + offset] = (obj[field] as number) & 0xFF; };
        case 'int16':
            return (obj, buf, pos) => { writeU16.call(buf, (obj[field] as number) & 0xFFFF, pos + offset); };
        case 'int32':
            return (obj, buf, pos) => { writeU32.call(buf, obj[field] as number, pos + offset); };
        case 'uint8':
            return (obj, buf, pos) => { buf[pos + offset] = obj[field] as number; };
        case 'uint16':
            return (obj, buf, pos) => { writeU16.call(buf, obj[field] as number, pos + offset); };
        case 'uint32':
            return (obj, buf, pos) => { writeU32.call(buf, obj[field] as number, pos + offset); };
        default:
            return null;
    }
}


// ─── Variant 6: Flat Array Encoder ──────────────────────────────────────────────
// Encode field descriptors as a flat numeric array for cache-friendly iteration.
// Layout: [op, offset, fieldIndex, op, offset, fieldIndex, ...]
// Field names pre-resolved to indices into a names array at compile time.

function buildFlatArrayEncoder(schema: Schema): EncodeFn {
    let fieldNames: string[] = [],
        fixedOps: number[] = [],
        varTypes: number[] = [],
        varFieldIndices: number[] = [];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!,
            op = typeToOp(field.type);

        if (op === null) {
            continue;
        }

        let idx = fieldNames.length;

        fieldNames.push(field.name);

        if (field.fixedSize > 0) {
            fixedOps.push(op, field.offset, idx);
        }
        else {
            varTypes.push(op);
            varFieldIndices.push(idx);
        }
    }

    let fixedLen = fixedOps.length,
        fixedSize = schema.fixedSize,
        names = fieldNames,
        varLen = varTypes.length;

    return (obj: Record<string, unknown>, buf: Uint8Array, pos: number): number => {
        // Fixed fields — flat array iteration
        for (let i = 0; i < fixedLen; i += 3) {
            let op = fixedOps[i]!,
                off = pos + fixedOps[i + 1]!,
                val = obj[names[fixedOps[i + 2]!]!];

            switch (op) {
                case Op.BIGINT:
                    writeBI64.call(buf, val as bigint, off);
                    break;
                case Op.BOOLEAN:
                    buf[off] = (val as boolean) ? 1 : 0;
                    break;
                case Op.DATE:
                    writeF64.call(buf, (val as Date).getTime(), off);
                    break;
                case Op.FLOAT64:
                    writeF64.call(buf, val as number, off);
                    break;
                case Op.INT8:
                    buf[off] = (val as number) & 0xFF;
                    break;
                case Op.INT16:
                    writeU16.call(buf, (val as number) & 0xFFFF, off);
                    break;
                case Op.INT32:
                    writeU32.call(buf, val as number, off);
                    break;
                case Op.UINT8:
                    buf[off] = val as number;
                    break;
                case Op.UINT16:
                    writeU16.call(buf, val as number, off);
                    break;
                case Op.UINT32:
                    writeU32.call(buf, val as number, off);
                    break;
            }
        }

        // Variable fields
        let vp = pos + fixedSize;

        for (let i = 0; i < varLen; i++) {
            let val = obj[names[varFieldIndices[i]!]!];

            switch (varTypes[i]) {
                case Op.STRING: {
                    let str = val as string,
                        len = byteLen(str);

                    writeU32.call(buf, len, vp);
                    vp += 4;
                    writeUtf8.call(buf, str, vp, len);
                    vp += len;
                    break;
                }
                case Op.BYTES: {
                    let bytes = val as Uint8Array;

                    writeU32.call(buf, bytes.length, vp);
                    vp += 4;
                    buf.set(bytes, vp);
                    vp += bytes.length;
                    break;
                }
            }
        }

        return vp;
    };
}


// ─── Variant 7: Monomorphic Closure (inline captured fields) ────────────────────
// Instead of looping through writers, build a single closure that inlines all
// field writes sequentially. Each field name and offset is a closed-over constant.
// This gives V8 the best chance to optimize — each property access is monomorphic
// and each write call site sees a single type.

function buildMonomorphicEncoder(schema: Schema): EncodeFn {
    let fixedFields: FieldDef[] = [],
        varFields: FieldDef[] = [];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            fixedFields.push(field);
        }
        else if (field.type === 'string' || field.type === 'bytes') {
            varFields.push(field);
        }
    }

    // Build a single function with all field writes inlined (no loops, no dispatch)
    // Capture field names as local variables to avoid repeated property lookups
    let fN = fixedFields.length,
        vN = varFields.length;

    // Generate specialized encoders for common field counts
    if (fN === 0 && vN === 1 && varFields[0]!.type === 'string') {
        let f0 = varFields[0]!.name;

        return (obj: Record<string, unknown>, buf: Uint8Array, pos: number): number => {
            let vp = pos,
                s0 = obj[f0] as string,
                l0 = byteLen(s0);

            writeU32.call(buf, l0, vp);
            vp += 4;
            writeUtf8.call(buf, s0, vp, l0);

            return vp + l0;
        };
    }

    if (fN <= 4 && vN <= 4) {
        // Pre-extract all field names and offsets
        let fixedNames: string[] = [],
            fixedOffsets: number[] = [],
            fixedTypes: FieldType[] = [],
            varNames: string[] = [],
            varFieldTypes: FieldType[] = [];

        for (let i = 0; i < fN; i++) {
            fixedNames.push(fixedFields[i]!.name);
            fixedOffsets.push(fixedFields[i]!.offset);
            fixedTypes.push(fixedFields[i]!.type);
        }

        for (let i = 0; i < vN; i++) {
            varNames.push(varFields[i]!.name);
            varFieldTypes.push(varFields[i]!.type);
        }

        let fixedSize = schema.fixedSize;

        return (obj: Record<string, unknown>, buf: Uint8Array, pos: number): number => {
            // Write fixed fields — unrolled
            for (let i = 0; i < fN; i++) {
                let off = pos + fixedOffsets[i]!,
                    val = obj[fixedNames[i]!];

                switch (fixedTypes[i]) {
                    case 'bigint': writeBI64.call(buf, val as bigint, off); break;
                    case 'boolean': buf[off] = (val as boolean) ? 1 : 0; break;
                    case 'date': writeF64.call(buf, (val as Date).getTime(), off); break;
                    case 'float64': writeF64.call(buf, val as number, off); break;
                    case 'int8': buf[off] = (val as number) & 0xFF; break;
                    case 'int16': writeU16.call(buf, (val as number) & 0xFFFF, off); break;
                    case 'int32': writeU32.call(buf, val as number, off); break;
                    case 'uint8': buf[off] = val as number; break;
                    case 'uint16': writeU16.call(buf, val as number, off); break;
                    case 'uint32': writeU32.call(buf, val as number, off); break;
                }
            }

            let vp = pos + fixedSize;

            // Write variable fields — unrolled
            for (let i = 0; i < vN; i++) {
                let val = obj[varNames[i]!];

                if (varFieldTypes[i] === 'string') {
                    let str = val as string,
                        len = byteLen(str);

                    writeU32.call(buf, len, vp);
                    vp += 4;
                    writeUtf8.call(buf, str, vp, len);
                    vp += len;
                }
                else {
                    let bytes = val as Uint8Array;

                    writeU32.call(buf, bytes.length, vp);
                    vp += 4;
                    buf.set(bytes, vp);
                    vp += bytes.length;
                }
            }

            return vp;
        };
    }

    // Fallback: closure chain for larger schemas
    return buildClosureEncoder(schema);
}


// ─── Schema + Encoder Builder ───────────────────────────────────────────────────


interface TestSchema {
    closureEncode: EncodeFn;
    codegenEncode: EncodeFn;
    computeSize: SizeFn;
    directEncode: EncodeFn;
    dispatchEncode: EncodeFn;
    flatArrayEncode: EncodeFn;
    hash: number;
    hybridEncode: EncodeFn;
    monomorphicEncode: EncodeFn;
    schema: Schema;
}

function buildTestSchema(data: Record<string, unknown>): TestSchema {
    let registry = createRegistry(),
        keysOut: string[][] = [],
        schema = inferSchema(data, registry, undefined);

    registerSchema(schema, registry);
    compileSchema(schema, registry);

    let closureEncode = buildClosureEncoder(schema),
        codegenEncode = schema.encodeFn!,
        directEncode = buildDirectEncoder(schema),
        dispatchEncode = buildDispatchEncoder(schema),
        flatArrayEncode = buildFlatArrayEncoder(schema),
        hybridEncode = buildHybridEncoder(schema),
        monomorphicEncode = buildMonomorphicEncoder(schema);

    // Build size calculator — mirrors codegen's buildComputeSize but without new Function()
    let fixedTotal = 9 + schema.fixedSize;

    let computeSize: SizeFn = (obj: Record<string, unknown>): number => {
        let s = fixedTotal;

        for (let i = 0, n = schema.fields.length; i < n; i++) {
            let field = schema.fields[i]!;

            if (field.fixedSize > 0) {
                continue;
            }

            if (field.type === 'string') {
                s += 4 + byteLen(obj[field.name] as string);
            }
            else if (field.type === 'bytes') {
                s += 4 + (obj[field.name] as Uint8Array).length;
            }
        }

        return s;
    };

    return {
        closureEncode,
        codegenEncode,
        computeSize,
        directEncode,
        dispatchEncode,
        flatArrayEncode,
        hash: schema.hash,
        hybridEncode,
        monomorphicEncode,
        schema,
    };
}


// ─── Full encode wrappers (tag + hash + len + fields) ───────────────────────────
// Mirrors encodeValue() from index.ts — allocates result, writes header, calls encodeFn

function wrapEncoder(encodeFn: EncodeFn, hash: number, computeSize: SizeFn): (data: Record<string, unknown>) => Uint8Array {
    return (data: Record<string, unknown>): Uint8Array => {
        let size = computeSize(data),
            result = allocUnsafe(size);

        result[0] = 246;
        writeU32.call(result, hash, 1);

        let end = encodeFn(data, result, 9);

        writeU32.call(result, end - 9, 5);

        return result;
    };
}


// ─── Test Data ──────────────────────────────────────────────────────────────────

let simpleData: Record<string, unknown> = { name: 'Alice' },
    multiData: Record<string, unknown> = { active: true, age: 30, name: 'John' },
    largeData: Record<string, unknown> = { active: true, age: 30, email: 'alice@test.com', name: 'Alice', role: 'admin', score: 99.5 };


// ─── Proto (compile-time codegen) codec setup ───────────────────────────────────

let safeCodec = createSafeCodec();

// Teach safe codec all schemas
safeCodec.encode(simpleData);
safeCodec.encode(multiData);
safeCodec.encode(largeData);

let safeCodecV2 = createSafeCodecV2();

// Teach safe codec v2 all schemas
safeCodecV2.encode(simpleData);
safeCodecV2.encode(multiData);
safeCodecV2.encode(largeData);


let protoSimple = createProtoCodec<{ name: string }>(`
    type T = { name: string };
    codec<T>();
`);

let protoMulti = createProtoCodec<{ active: boolean; age: number; name: string }>(`
    type T = { active: boolean; age: number; name: string };
    codec<T>();
`);

let protoLarge = createProtoCodec<{ active: boolean; age: number; email: string; name: string; role: string; score: number }>(`
    type T = { active: boolean; age: number; email: string; name: string; role: string; score: number };
    codec<T>();
`);


// ─── Build schemas for test data ────────────────────────────────────────────────

let simpleSchema = buildTestSchema(simpleData),
    multiSchema = buildTestSchema(multiData),
    largeSchema = buildTestSchema(largeData);


// ─── Wrapped encoders ───────────────────────────────────────────────────────────

let encoders = {
    large: {
        closure: wrapEncoder(largeSchema.closureEncode, largeSchema.hash, largeSchema.computeSize),
        codegen: wrapEncoder(largeSchema.codegenEncode, largeSchema.hash, largeSchema.computeSize),
        direct: wrapEncoder(largeSchema.directEncode, largeSchema.hash, largeSchema.computeSize),
        dispatch: wrapEncoder(largeSchema.dispatchEncode, largeSchema.hash, largeSchema.computeSize),
        flatArray: wrapEncoder(largeSchema.flatArrayEncode, largeSchema.hash, largeSchema.computeSize),
        hybrid: wrapEncoder(largeSchema.hybridEncode, largeSchema.hash, largeSchema.computeSize),
        monomorphic: wrapEncoder(largeSchema.monomorphicEncode, largeSchema.hash, largeSchema.computeSize),
    },
    multi: {
        closure: wrapEncoder(multiSchema.closureEncode, multiSchema.hash, multiSchema.computeSize),
        codegen: wrapEncoder(multiSchema.codegenEncode, multiSchema.hash, multiSchema.computeSize),
        direct: wrapEncoder(multiSchema.directEncode, multiSchema.hash, multiSchema.computeSize),
        dispatch: wrapEncoder(multiSchema.dispatchEncode, multiSchema.hash, multiSchema.computeSize),
        flatArray: wrapEncoder(multiSchema.flatArrayEncode, multiSchema.hash, multiSchema.computeSize),
        hybrid: wrapEncoder(multiSchema.hybridEncode, multiSchema.hash, multiSchema.computeSize),
        monomorphic: wrapEncoder(multiSchema.monomorphicEncode, multiSchema.hash, multiSchema.computeSize),
    },
    simple: {
        closure: wrapEncoder(simpleSchema.closureEncode, simpleSchema.hash, simpleSchema.computeSize),
        codegen: wrapEncoder(simpleSchema.codegenEncode, simpleSchema.hash, simpleSchema.computeSize),
        direct: wrapEncoder(simpleSchema.directEncode, simpleSchema.hash, simpleSchema.computeSize),
        dispatch: wrapEncoder(simpleSchema.dispatchEncode, simpleSchema.hash, simpleSchema.computeSize),
        flatArray: wrapEncoder(simpleSchema.flatArrayEncode, simpleSchema.hash, simpleSchema.computeSize),
        hybrid: wrapEncoder(simpleSchema.hybridEncode, simpleSchema.hash, simpleSchema.computeSize),
        monomorphic: wrapEncoder(simpleSchema.monomorphicEncode, simpleSchema.hash, simpleSchema.computeSize),
    },
};


// ─── Verify correctness ─────────────────────────────────────────────────────────
// All variants must produce identical wire output to codegen

function verifyOutput(name: string, data: Record<string, unknown>, group: typeof encoders.simple): void {
    let reference = group.codegen(data),
        variants: [string, (d: Record<string, unknown>) => Uint8Array][] = [
            ['dispatch', group.dispatch],
            ['closure', group.closure],
            ['direct', group.direct],
            ['hybrid', group.hybrid],
            ['flatArray', group.flatArray],
            ['monomorphic', group.monomorphic],
        ];

    for (let [vname, fn] of variants) {
        let result = fn(data);

        if (result.length !== reference.length) {
            throw new Error(`${name}/${vname}: length mismatch (${result.length} vs ${reference.length})`);
        }

        for (let i = 0, n = result.length; i < n; i++) {
            if (result[i] !== reference[i]) {
                throw new Error(`${name}/${vname}: byte mismatch at offset ${i} (${result[i]} vs ${reference[i]})`);
            }
        }
    }
}

verifyOutput('simple', simpleData, encoders.simple);
verifyOutput('multi', multiData, encoders.multi);
verifyOutput('large', largeData, encoders.large);

console.log('\n--- All encoder variants produce identical output ---\n');


// ─── Warmup ─────────────────────────────────────────────────────────────────────

for (let i = 0; i < 2000; i++) {
    encoders.simple.codegen(simpleData);
    encoders.simple.dispatch(simpleData);
    encoders.simple.closure(simpleData);
    encoders.simple.direct(simpleData);
    encoders.simple.hybrid(simpleData);
    encoders.simple.flatArray(simpleData);
    encoders.simple.monomorphic(simpleData);
    encoders.multi.codegen(multiData);
    encoders.multi.dispatch(multiData);
    encoders.multi.closure(multiData);
    encoders.multi.direct(multiData);
    encoders.multi.hybrid(multiData);
    encoders.multi.flatArray(multiData);
    encoders.multi.monomorphic(multiData);
    encoders.large.codegen(largeData);
    encoders.large.dispatch(largeData);
    encoders.large.closure(largeData);
    encoders.large.direct(largeData);
    encoders.large.hybrid(largeData);
    encoders.large.flatArray(largeData);
    encoders.large.monomorphic(largeData);
    protoSimple.encode(simpleData as { name: string });
    protoMulti.encode(multiData as { active: boolean; age: number; name: string });
    protoLarge.encode(largeData as { active: boolean; age: number; email: string; name: string; role: string; score: number });
    pack(simpleData);
    pack(multiData);
    pack(largeData);
    safeCodec.encode(simpleData);
    safeCodec.encode(multiData);
    safeCodec.encode(largeData);
}


// ─── Benchmark Options ──────────────────────────────────────────────────────────

let opts = { warmupIterations: 2000, warmupTime: 1000 };

function cooldown(): void {
    let end = Date.now() + 200,
        x = 0;

    while (Date.now() < end) {
        x += Math.sqrt(x + 1);
    }

    if (x < 0) {
        console.log(x);
    }
}


// ─── Benchmarks ─────────────────────────────────────────────────────────────────


// === SIMPLE: { name: string } ===

describe('Simple { name } — Encode', () => {
    afterAll(() => cooldown());
    bench('codegen (new Function)', () => { encoders.simple.codegen(simpleData); }, opts);
    bench('dispatch table', () => { encoders.simple.dispatch(simpleData); }, opts);
    bench('closure chain', () => { encoders.simple.closure(simpleData); }, opts);
    bench('direct DataView', () => { encoders.simple.direct(simpleData); }, opts);
    bench('hybrid (unrolled+var)', () => { encoders.simple.hybrid(simpleData); }, opts);
    bench('flat array', () => { encoders.simple.flatArray(simpleData); }, opts);
    bench('monomorphic closure', () => { encoders.simple.monomorphic(simpleData); }, opts);
    bench('proto (compile-time)', () => { protoSimple.encode(simpleData as { name: string }); }, opts);
    bench('msgpackr', () => { pack(simpleData); }, opts);
    bench('safe codec (CSP-safe)', () => { safeCodec.encode(simpleData); }, opts);
    bench('safe codec v2 (CSP-safe)', () => { safeCodecV2.encode(simpleData); }, opts);
});


// === MULTI: { active: boolean, age: number, name: string } ===

describe('Multi { active, age, name } — Encode', () => {
    afterAll(() => cooldown());
    bench('codegen (new Function)', () => { encoders.multi.codegen(multiData); }, opts);
    bench('dispatch table', () => { encoders.multi.dispatch(multiData); }, opts);
    bench('closure chain', () => { encoders.multi.closure(multiData); }, opts);
    bench('direct DataView', () => { encoders.multi.direct(multiData); }, opts);
    bench('hybrid (unrolled+var)', () => { encoders.multi.hybrid(multiData); }, opts);
    bench('flat array', () => { encoders.multi.flatArray(multiData); }, opts);
    bench('monomorphic closure', () => { encoders.multi.monomorphic(multiData); }, opts);
    bench('proto (compile-time)', () => { protoMulti.encode(multiData as { active: boolean; age: number; name: string }); }, opts);
    bench('msgpackr', () => { pack(multiData); }, opts);
    bench('safe codec (CSP-safe)', () => { safeCodec.encode(multiData); }, opts);
    bench('safe codec v2 (CSP-safe)', () => { safeCodecV2.encode(multiData); }, opts);
});


// === LARGE: { active, age, email, name, role, score } ===

describe('Large { 6 fields } — Encode', () => {
    afterAll(() => cooldown());
    bench('codegen (new Function)', () => { encoders.large.codegen(largeData); }, opts);
    bench('dispatch table', () => { encoders.large.dispatch(largeData); }, opts);
    bench('closure chain', () => { encoders.large.closure(largeData); }, opts);
    bench('direct DataView', () => { encoders.large.direct(largeData); }, opts);
    bench('hybrid (unrolled+var)', () => { encoders.large.hybrid(largeData); }, opts);
    bench('flat array', () => { encoders.large.flatArray(largeData); }, opts);
    bench('monomorphic closure', () => { encoders.large.monomorphic(largeData); }, opts);
    bench('proto (compile-time)', () => { protoLarge.encode(largeData as { active: boolean; age: number; email: string; name: string; role: string; score: number }); }, opts);
    bench('msgpackr', () => { pack(largeData); }, opts);
    bench('safe codec (CSP-safe)', () => { safeCodec.encode(largeData); }, opts);
    bench('safe codec v2 (CSP-safe)', () => { safeCodecV2.encode(largeData); }, opts);
});
