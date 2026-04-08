// Schema Binary Codec — Codegen
// Compiler functions for encode/decode/extractors/computeSize

import { byteLen, driver, FIELD_SIZES, isNode, readVarint, readZigzag, varintResult, writeVarint, writeZigzag } from './platform';
import type { FieldDef, FieldType, Schema, SchemaRegistry } from './platform';


// Names used as new Function() parameters in generated code.
// Field names matching these would shadow parameters and break codegen.
const CODEGEN_RESERVED_NAMES = new Set([
    '$bl', '$byteLen', '$d', '$e', '$ls', '$reg', '$rs', '$rv', '$rz', '$sd', '$si', '$utf8w', '$vr', '$wv', '$wz',
    'buf', 'pos',
]);

const JS_RESERVED_WORDS = new Set([
    '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', '__proto__',
    'abstract', 'arguments', 'async', 'await', 'boolean', 'break', 'byte', 'case',
    'catch', 'char', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
    'do', 'double', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'final',
    'finally', 'float', 'for', 'function', 'goto', 'if', 'implements', 'import', 'in',
    'instanceof', 'int', 'interface', 'let', 'long', 'native', 'new', 'null',
    'package', 'private', 'protected', 'public', 'return', 'short', 'static',
    'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
    'true', 'try', 'typeof', 'undefined', 'var', 'void', 'volatile', 'while',
    'with', 'yield',
]);

const UNSUPPORTED_ARRAY_ELEMENT_TYPES = new Set([
    'bigint', 'boolean', 'bytes', 'date', 'int8', 'int16',
]);

const VALID_BASE_TYPES = new Set([
    'bigint', 'boolean', 'bytes', 'date', 'float64',
    'int8', 'int16', 'int32', 'mixed', 'string',
    'uint8', 'uint16', 'uint32',
]);

const VALID_FIELD_NAME = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;


function validateFieldName(name: string): void {
    if (!VALID_FIELD_NAME.test(name)) {
        throw new Error('SBC: invalid field name: ' + name);
    }

    if (name.length > 128) {
        throw new Error('SBC: field name too long (max 128): ' + name);
    }

    if (JS_RESERVED_WORDS.has(name)) {
        throw new Error('SBC: reserved word used as field name: ' + name);
    }

    if (CODEGEN_RESERVED_NAMES.has(name)) {
        throw new Error('SBC: field name conflicts with codegen internal: ' + name);
    }
}


// Validate a serialized field type string recursively (e.g. "string", "array<float64>", "nullable<object(1)>")
function validateFieldTypeString(type: string, depth: number = 0): void {
    if (depth > 32) {
        throw new Error('SBC: field type nesting exceeds maximum depth (32): ' + type);
    }

    if (VALID_BASE_TYPES.has(type)) {
        return;
    }

    if (type.startsWith('array<') && type.endsWith('>')) {
        let inner = type.slice(6, -1);

        validateFieldTypeString(inner, depth + 1);

        if (UNSUPPORTED_ARRAY_ELEMENT_TYPES.has(inner)) {
            throw new Error('SBC: unsupported array element type: ' + inner);
        }

        return;
    }

    if (type.startsWith('nullable<') && type.endsWith('>')) {
        validateFieldTypeString(type.slice(9, -1), depth + 1);

        return;
    }

    if (type.startsWith('object(') && type.endsWith(')')) {
        let id = parseInt(type.slice(7, -1), 10);

        if (isNaN(id) || id < 0) {
            throw new Error('SBC: invalid object schema id in type: ' + type);
        }

        return;
    }

    throw new Error('SBC: unknown field type: ' + type);
}


function validateAllFieldNames(fields: FieldDef[]): void {
    for (let i = 0, n = fields.length; i < n; i++) {
        validateFieldName(fields[i]!.name);
    }
}


function assignNullIndices(fields: FieldDef[]): void {
    let nullIndex = 0;

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            field._nullIndex = nullIndex++;
        }
    }
}

function bitmapBytes(count: number): number {
    return (count + 7) >> 3;
}

function buildComputeSize(schema: Schema, registry?: SchemaRegistry, lookupFn?: (obj: Record<string, unknown>, registry: SchemaRegistry) => Schema | null): (obj: unknown) => number {
    validateAllFieldNames(schema.fields);

    let bmBytes = bitmapBytes(schema.nullableCount),
        fixedTotal = 9 + bmBytes + schema.fixedSize,
        hasObjectFields = false,
        lines: string[] = ['let s=' + fixedTotal];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let f = schema.fields[i]!;

        if (f.fixedSize > 0) {
            continue;
        }

        let type = f.type,
            val = 'obj["' + f.name + '"]';

        if (typeof type === 'string') {
            if (type === 'string') {
                lines.push('s+=4+$bl(' + val + ')');
            }
            else if (type === 'bytes') {
                lines.push('s+=4+' + val + '.length');
            }
        }
        else if (type.kind === 'object') {
            hasObjectFields = true;
            lines.push('{let _i=$ls(' + val + ',$reg);if(!_i||!_i.computeSize)return -1;let _n=_i.computeSize(' + val + ');if(_n<0)return -1;s+=4+_n}');
        }
        else if (type.kind === 'array') {
            let elem = type.element;

            if (typeof elem === 'string') {
                let elemSize = FIELD_SIZES[elem];

                if (elemSize && elemSize > 0) {
                    lines.push('s+=2+' + val + '.length*' + elemSize);
                }
                else if (elem === 'string') {
                    lines.push('{let a=' + val + ';s+=2;for(let j=0,n=a.length;j<n;j++)s+=4+$bl(a[j])}');
                }
            }
        }
        else if (type.kind === 'nullable') {
            let inner = type.inner;

            if (typeof inner === 'string') {
                if (inner === 'string') {
                    lines.push('if(' + val + '!=null)s+=4+$bl(' + val + ')');
                }
                else if (inner === 'bytes') {
                    lines.push('if(' + val + '!=null)s+=4+' + val + '.length');
                }
                else {
                    let innerSize = FIELD_SIZES[inner];

                    if (innerSize && innerSize > 0) {
                        lines.push('if(' + val + '!=null)s+=' + innerSize);
                    }
                }
            }
            else if (typeof inner === 'object' && inner.kind === 'array') {
                let elem = inner.element;

                if (typeof elem === 'string') {
                    let elemSize = FIELD_SIZES[elem];

                    if (elemSize && elemSize > 0) {
                        lines.push('if(' + val + '!=null)s+=2+' + val + '.length*' + elemSize);
                    }
                    else if (elem === 'string') {
                        lines.push('if(' + val + '!=null){let a=' + val + ';s+=2;for(let j=0,n=a.length;j<n;j++)s+=4+$bl(a[j])}');
                    }
                }
            }
        }
    }

    lines.push('return s');

    if (hasObjectFields) {
        return new Function('$bl', '$ls', '$reg', 'obj', lines.join(';')).bind(null, byteLen, lookupFn, registry) as (obj: unknown) => number;
    }

    return new Function('$bl', 'obj', lines.join(';')).bind(null, byteLen) as (obj: unknown) => number;
}

function buildSchema(fields: FieldDef[], hash: number, id: number): Schema {
    for (let i = 0, n = fields.length; i < n; i++) {
        validateFieldName(fields[i]!.name);
    }

    fields.sort(sortFields);

    let fixedSize = computeFieldOffsets(fields),
        nullableCount = 0;

    for (let i = 0, n = fields.length; i < n; i++) {
        if (typeof fields[i]!.type === 'object' && (fields[i]!.type as { kind: string }).kind === 'nullable') {
            nullableCount++;
        }
    }

    if (nullableCount > 16) {
        throw new Error('SBC: maximum 16 nullable fields supported (got ' + nullableCount + ')');
    }

    return {
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible: isCompressible(fields),
        computeSize: null,
        decodeFn: null,
        encodeFn: null,
        fieldExtractors: null,
        fields,
        fieldsSorted: null,
        fixedSize,
        hash,
        id,
        nullableCount,
    };
}

function buildSchemaFromDef(def: { fields: { fixedSize: number; name: string; type: string }[]; hash: number; id: number; nullableCount: number }, parseFieldType: (str: string) => FieldType): Schema {
    let fields: FieldDef[] = def.fields.map((f) => {
        validateFieldName(f.name);
        validateFieldTypeString(f.type);

        return {
            fixedSize: f.fixedSize,
            name: f.name,
            offset: 0,
            type: parseFieldType(f.type),
        };
    });

    assignNullIndices(fields);

    let fixedSize = computeFieldOffsets(fields);

    return {
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible: isCompressible(fields),
        computeSize: null,
        decodeFn: null,
        encodeFn: null,
        fieldExtractors: null,
        fields,
        fieldsSorted: null,
        fixedSize,
        hash: def.hash,
        id: def.id,
        nullableCount: def.nullableCount,
    };
}

function classifyFields(schema: Schema): { boolFields: FieldDef[]; float64Fields: FieldDef[]; intFields: FieldDef[]; otherFixed: FieldDef[] } {
    let boolFields: FieldDef[] = [],
        float64Fields: FieldDef[] = [],
        intFields: FieldDef[] = [],
        otherFixed: FieldDef[] = [];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.type === 'boolean') {
            boolFields.push(field);
        }
        else if (field.type === 'float64') {
            float64Fields.push(field);
        }
        else if (isVarintIntType(field.type)) {
            intFields.push(field);
        }
        else if (field.fixedSize > 0) {
            otherFixed.push(field);
        }
    }

    return { boolFields, float64Fields, intFields, otherFixed };
}

function compileCompressedDecoder(schema: Schema, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, internFields?: Set<string>, internDecode?: (buf: Uint8Array, pos: number) => string): (buf: Uint8Array, pos: number) => unknown {
    validateAllFieldNames(schema.fields);

    if (schema.nullableCount > 16) {
        throw new Error('SBC: nullable field limit exceeded in compressed codec (got ' + schema.nullableCount + ')');
    }

    let { boolFields, float64Fields, intFields, otherFixed } = classifyFields(schema),
        compFixedOffset = 0,
        hasNullable = schema.nullableCount > 0,
        lines: string[] = [],
        nullBmBytes = hasNullable ? bitmapBytes(schema.nullableCount) : 0,
        vp = 'vp';

    if (hasNullable) {
        emitNullBitmapRead(lines, nullBmBytes);
    }

    let boolBmBytes = bitmapBytes(boolFields.length);

    if (boolFields.length > 0) {
        lines.push('let _bb=buf[pos]');

        if (boolBmBytes > 1) {
            lines.push('_bb|=buf[pos+1]<<8');
        }

        lines.push('pos+=' + boolBmBytes);

        for (let i = 0, n = boolFields.length; i < n; i++) {
            lines.push('let ' + boolFields[i]!.name + '=!!(_bb&' + (1 << i) + ')');
        }
    }

    for (let i = 0, n = otherFixed.length; i < n; i++) {
        let field = otherFixed[i]!;

        emitFixed(lines, field, 'pos+' + compFixedOffset, 'decode');
        compFixedOffset += field.fixedSize;
    }

    lines.push('let ' + vp + '=pos+' + compFixedOffset);

    for (let i = 0, n = intFields.length; i < n; i++) {
        let field = intFields[i]!;

        if (isSignedIntType(field.type as string)) {
            lines.push('$rz(buf,' + vp + ')');
        }
        else {
            lines.push('$rv(buf,' + vp + ')');
        }

        lines.push('let ' + field.name + '=$vr.value');
        lines.push(vp + '=$vr.pos');
    }

    for (let i = 0, n = float64Fields.length; i < n; i++) {
        let f = float64Fields[i]!.name;

        lines.push('let ' + f + 'F=buf[' + vp + '++]');
        lines.push('let ' + f);
        lines.push('if(' + f + 'F===0){$rz(buf,' + vp + ');' + f + '=$vr.value;' + vp + '=$vr.pos}else{' + f + '=' + driver.readF64(vp) + ';' + vp + '+=8}');
    }

    emitVarFields(lines, schema, vp, 'decode', true, internFields);

    let allFields = sortFieldsByName(schema);

    lines.push('return{' + allFields.map((f) => f.name).join(',') + '}');

    let $d = helpers?.decodeSbc ?? ((_buf: Uint8Array, _offset: number, _len: number) => null),
        body = finalizeBody(lines);

    if (internFields && internFields.size > 0 && internDecode) {
        return new Function('$d', '$rv', '$rz', '$vr', '$sd', driver.decoderParams() + 'buf', 'pos', body).bind(null, $d, readVarint, readZigzag, varintResult, internDecode, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown;
    }

    return new Function('$d', '$rv', '$rz', '$vr', driver.decoderParams() + 'buf', 'pos', body).bind(null, $d, readVarint, readZigzag, varintResult, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown;
}

function compileCompressedEncoder(schema: Schema, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, internFields?: Set<string>, internEncode?: (field: string, value: string, buf: Uint8Array, pos: number) => number): (obj: unknown, buf: Uint8Array, pos: number) => number {
    validateAllFieldNames(schema.fields);

    if (schema.nullableCount > 16) {
        throw new Error('SBC: nullable field limit exceeded in compressed codec (got ' + schema.nullableCount + ')');
    }

    let { boolFields, float64Fields, intFields, otherFixed } = classifyFields(schema),
        compFixedOffset = 0,
        hasNullable = schema.nullableCount > 0,
        lines: string[] = [],
        nullBmBytes = hasNullable ? bitmapBytes(schema.nullableCount) : 0,
        vp = 'vp';

    if (hasNullable) {
        emitNullBitmapInit(lines, nullBmBytes);
    }

    let boolBmBytes = bitmapBytes(boolFields.length);

    if (boolFields.length > 0) {
        lines.push('let _bb=0');
        lines.push('let _bbPos=pos');
        lines.push('pos+=' + boolBmBytes);

        for (let i = 0, n = boolFields.length; i < n; i++) {
            lines.push('if(obj["' + boolFields[i]!.name + '"]){_bb|=' + (1 << i) + '}');
        }
    }

    for (let i = 0, n = otherFixed.length; i < n; i++) {
        let field = otherFixed[i]!;

        emitFixed(lines, field, 'pos+' + compFixedOffset, 'encode');
        compFixedOffset += field.fixedSize;
    }

    lines.push('let ' + vp + '=pos+' + compFixedOffset);

    for (let i = 0, n = intFields.length; i < n; i++) {
        let field = intFields[i]!;

        if (isSignedIntType(field.type as string)) {
            lines.push(vp + '=$wz(buf,' + vp + ',obj["' + field.name + '"])');
        }
        else {
            lines.push(vp + '=$wv(buf,' + vp + ',obj["' + field.name + '"])');
        }
    }

    for (let i = 0, n = float64Fields.length; i < n; i++) {
        let f = float64Fields[i]!.name;

        lines.push('let ' + f + 'I=obj["' + f + '"]===(' + 'obj["' + f + '"]|0)');
        lines.push('if(' + f + 'I){buf[' + vp + ']=0;' + vp + '++;' + vp + '=$wz(buf,' + vp + ',obj["' + f + '"])}else{buf[' + vp + ']=1;' + vp + '++;' + driver.writeF64(vp, 'obj["' + f + '"]') + ';' + vp + '+=8}');
    }

    emitVarFields(lines, schema, vp, 'encode', true, internFields);

    if (boolFields.length > 0) {
        lines.push('buf[_bbPos]=_bb&0xFF');

        if (boolBmBytes > 1) {
            lines.push('buf[_bbPos+1]=(_bb>>8)&0xFF');
        }
    }

    if (hasNullable) {
        emitNullBitmapWrite(lines, nullBmBytes);
    }

    lines.push('return ' + vp);

    let $e = helpers?.encodeSbc ?? ((_value: unknown, buf: Uint8Array, pos: number) => { buf[pos] = 0; return pos + 1; }),
        body = finalizeBody(lines);

    if (internFields && internFields.size > 0 && internEncode) {
        return new Function('$e', '$wv', '$wz', '$si', driver.encoderParams() + 'obj', 'buf', 'pos', body).bind(null, $e, writeVarint, writeZigzag, internEncode, ...driver.encoderBindArgs()) as (obj: unknown, buf: Uint8Array, pos: number) => number;
    }

    return new Function('$e', '$wv', '$wz', driver.encoderParams() + 'obj', 'buf', 'pos', body).bind(null, $e, writeVarint, writeZigzag, ...driver.encoderBindArgs()) as (obj: unknown, buf: Uint8Array, pos: number) => number;
}

function compileDecoder(schema: Schema, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, internFields?: Set<string>, internDecode?: (buf: Uint8Array, pos: number) => string): (buf: Uint8Array, pos: number) => unknown {
    validateAllFieldNames(schema.fields);

    let hasNullable = schema.nullableCount > 0,
        lines: string[] = [],
        nullBmBytes = hasNullable ? bitmapBytes(schema.nullableCount) : 0,
        vp = 'vp';

    if (hasNullable) {
        emitNullBitmapRead(lines, nullBmBytes);
    }

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            emitFixed(lines, field, 'pos+' + field.offset, 'decode');
        }
    }

    emitVarFields(lines, schema, vp, 'decode', false, internFields);

    let allFields = sortFieldsByName(schema);

    lines.push('return{' + allFields.map((f) => f.name).join(',') + '}');

    let $d = helpers?.decodeSbc ?? ((_buf: Uint8Array, _offset: number, _len: number) => null),
        body = finalizeBody(lines);

    if (internFields && internFields.size > 0 && internDecode) {
        return new Function('$d', '$sd', driver.decoderParams() + 'buf', 'pos', body).bind(null, $d, internDecode, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown;
    }

    return new Function('$d', driver.decoderParams() + 'buf', 'pos', body).bind(null, $d, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown;
}

function compileEncoder(schema: Schema, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, internFields?: Set<string>, internEncode?: (field: string, value: string, buf: Uint8Array, pos: number) => number): (obj: unknown, buf: Uint8Array, pos: number) => number {
    validateAllFieldNames(schema.fields);

    let hasNullable = schema.nullableCount > 0,
        lines: string[] = [],
        nullBmBytes = hasNullable ? bitmapBytes(schema.nullableCount) : 0,
        vp = 'vp';

    if (hasNullable) {
        emitNullBitmapInit(lines, nullBmBytes);
    }

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            emitFixed(lines, field, 'pos+' + field.offset, 'encode');
        }
    }

    let hasVar = emitVarFields(lines, schema, vp, 'encode', false, internFields);

    if (hasNullable) {
        emitNullBitmapWrite(lines, nullBmBytes);
    }

    lines.push('return ' + (hasVar ? vp : 'pos+' + schema.fixedSize));

    let $e = helpers?.encodeSbc ?? ((_value: unknown, buf: Uint8Array, pos: number) => { buf[pos] = 0; return pos + 1; }),
        body = finalizeBody(lines);

    if (internFields && internFields.size > 0 && internEncode) {
        return new Function('$e', '$si', driver.encoderParams() + 'obj', 'buf', 'pos', body).bind(null, $e, internEncode, ...driver.encoderBindArgs()) as (obj: unknown, buf: Uint8Array, pos: number) => number;
    }

    return new Function('$e', driver.encoderParams() + 'obj', 'buf', 'pos', body).bind(null, $e, ...driver.encoderBindArgs()) as (obj: unknown, buf: Uint8Array, pos: number) => number;
}

function compileFieldExtractors(schema: Schema): void {
    validateAllFieldNames(schema.fields);

    let extractors = new Map<string, (buf: Uint8Array, pos: number) => unknown>();

    // Fixed-size fields: direct offset read (O(1), no scanning)
    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize <= 0) {
            continue;
        }

        let lines: string[] = [],
            off = 'pos+' + field.offset;

        switch (field.type) {
            case 'bigint': lines.push('return ' + driver.readBI64(off)); break;
            case 'boolean': lines.push('return !!buf[' + off + ']'); break;
            case 'date': lines.push('return new Date(' + driver.readF64(off) + ')'); break;
            case 'float64': lines.push('return ' + driver.readF64(off)); break;
            case 'int8': lines.push('return (buf[' + off + ']<<24>>24)'); break;
            case 'int16': lines.push('return ' + driver.readI16(off)); break;
            case 'int32': lines.push('return ' + driver.readI32(off)); break;
            case 'uint8': lines.push('return buf[' + off + ']'); break;
            case 'uint16': lines.push('return ' + driver.readU16(off)); break;
            case 'uint32': lines.push('return ' + driver.readU32(off)); break;
            default: continue;
        }

        let body = finalizeBody(lines);

        extractors.set(field.name, new Function(driver.decoderParams() + 'buf', 'pos', body).bind(null, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown);
    }

    // Variable-size fields: scan from fixedSize offset
    // Each extractor scans through preceding variable fields to find its own offset
    let varFields: FieldDef[] = [];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        if (schema.fields[i]!.fixedSize <= 0) {
            varFields.push(schema.fields[i]!);
        }
    }

    outer: for (let vi = 0, vn = varFields.length; vi < vn; vi++) {
        let target = varFields[vi]!;

        // Only support simple string/bytes extraction for now (most common filter fields)
        if (typeof target.type !== 'string' || (target.type !== 'string' && target.type !== 'bytes')) {
            continue;
        }

        let lines: string[] = [];

        lines.push('let bl=buf.length,vp=pos+' + schema.fixedSize);

        // Skip preceding variable fields with bounds checks
        for (let j = 0; j < vi; j++) {
            let prev = varFields[j]!;

            if (typeof prev.type === 'string' && (prev.type === 'string' || prev.type === 'bytes')) {
                lines.push('if(vp+4>bl)return undefined');
                lines.push('{let s=' + driver.readU32('vp') + ';if(vp+4+s>bl)return undefined;vp+=4+s}');
            }
            else if (typeof prev.type === 'object') {
                // Nested object/array: read u32 length prefix and skip
                if (prev.type.kind === 'object') {
                    lines.push('if(vp+4>bl)return undefined');
                    lines.push('{let s=' + driver.readU32('vp') + ';if(vp+4+s>bl)return undefined;vp+=4+s}');
                }
                else if (prev.type.kind === 'array' || prev.type.kind === 'nullable') {
                    continue outer; // Can't cheaply skip arrays/nullables without full parse
                }
            }
            else {
                continue outer; // Unknown type, bail
            }
        }

        if (target.type === 'string') {
            lines.push('if(vp+4>bl)return undefined');
            lines.push('let l=' + driver.readU32('vp'));
            lines.push('vp+=4');
            lines.push('if(vp+l>bl)return undefined');
            lines.push('return $rs(buf,vp,vp+l)');
        }
        else {
            lines.push('if(vp+4>bl)return undefined');
            lines.push('let l=' + driver.readU32('vp'));
            lines.push('vp+=4');
            lines.push('if(vp+l>bl)return undefined');
            lines.push('return buf.subarray(vp,vp+l)');
        }

        let body = finalizeBody(lines);

        extractors.set(target.name, new Function(driver.decoderParams() + 'buf', 'pos', body).bind(null, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown);
    }

    schema.fieldExtractors = extractors;
}

function compileSchema(schema: Schema, registry?: SchemaRegistry, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, compression?: boolean, internFields?: Set<string>, internEncode?: (field: string, value: string, buf: Uint8Array, pos: number) => number, internDecode?: (buf: Uint8Array, pos: number) => string, lookupFn?: (obj: Record<string, unknown>, registry: SchemaRegistry) => Schema | null): void {
    let reg = registry || createRegistryInternal();

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        validateFieldName(schema.fields[i]!.name);
    }

    assignNullIndices(schema.fields);

    schema.decodeFn = compileDecoder(schema, helpers, internFields, internDecode);
    schema.encodeFn = compileEncoder(schema, helpers, internFields, internEncode);
    compileFieldExtractors(schema);

    if (!compression && isSizeComputable(schema)) {
        schema.computeSize = buildComputeSize(schema, reg, lookupFn);
    }

    if (compression && schema.compressible) {
        schema.compressedDecodeFn = compileCompressedDecoder(schema, helpers, internFields, internDecode);
        schema.compressedEncodeFn = compileCompressedEncoder(schema, helpers, internFields, internEncode);
    }
}

function computeFieldOffsets(fields: FieldDef[]): number {
    let offset = 0;

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.fixedSize > 0) {
            field.offset = offset;
            offset += field.fixedSize;
        }
        else {
            field.offset = -1;
        }
    }

    return offset;
}

// Minimal registry creation for internal use (avoids circular dependency)
function createRegistryInternal(): SchemaRegistry {
    return {
        constructorCache: new WeakMap(),
        lastSchema: null,
        nextId: 1,
        schemas: new Map(),
        schemasByCount: new Map(),
        schemasByHash: new Map(),
    };
}

function emitDeltaArray(lines: string[], field: FieldDef, vp: string, dir: 'decode' | 'encode'): void {
    let n = field.name;

    if (dir === 'decode') {
        lines.push('let ' + n + 'C=' + driver.readU16(vp));
        lines.push(vp + '+=2');
        lines.push('let ' + n + '=new Array(' + n + 'C)');
        lines.push('if(' + n + 'C>0){$rv(buf,' + vp + ')');
        lines.push('let _base=$vr.value');
        lines.push(vp + '=$vr.pos');
        lines.push(n + '[0]=_base');
        lines.push('for(let j=1;j<' + n + 'C;j++){$rz(buf,' + vp + ');_base+=$vr.value;' + vp + '=$vr.pos;' + n + '[j]=_base}}');
    }
    else {
        let val = 'obj["' + n + '"]';

        lines.push('let ' + n + 'A=' + val);
        lines.push('let ' + n + 'C=' + n + 'A.length');
        lines.push(driver.writeU16(vp, n + 'C'));
        lines.push(vp + '+=2');
        lines.push('if(' + n + 'C>0){' + vp + '=$wv(buf,' + vp + ',' + n + 'A[0])');
        lines.push('for(let j=1;j<' + n + 'C;j++){' + vp + '=$wz(buf,' + vp + ',' + n + 'A[j]-' + n + 'A[j-1])}}');
    }
}

function emitArrayElements(lines: string[], n: string, elem: FieldType, vp: string, dir: 'decode' | 'encode'): void {
    if (typeof elem === 'string' && elem === 'mixed') {
        if (dir === 'decode') {
            lines.push('for(let j=0;j<' + n + 'C;j++){let el=' + driver.readU32(vp) + ';' + vp + '+=4;' + n + '[j]=$d(buf,' + vp + ',el);' + vp + '+=el}');
        }
        else {
            lines.push('for(let j=0;j<' + n + 'C;j++){let es=' + vp + ';' + vp + '+=4;' + vp + '=$e(' + n + 'A[j],buf,' + vp + ');' + driver.writeU32('es', vp + '-es-4') + '}');
        }

        return;
    }

    if (typeof elem === 'object' && elem.kind === 'object') {
        if (dir === 'decode') {
            lines.push('for(let j=0;j<' + n + 'C;j++){let el=' + driver.readU32(vp) + ';' + vp + '+=4;' + n + '[j]=$d(buf,' + vp + ',el);' + vp + '+=el}');
        }
        else {
            lines.push('for(let j=0;j<' + n + 'C;j++){let es=' + vp + ';' + vp + '+=4;' + vp + '=$e(' + n + 'A[j],buf,' + vp + ');' + driver.writeU32('es', vp + '-es-4') + '}');
        }

        return;
    }

    if (typeof elem !== 'string') {
        return;
    }

    let src = dir === 'decode' ? n + '[j]' : n + 'A[j]';

    switch (elem) {
        case 'float64':
            if (dir === 'decode') {
                lines.push('for(let j=0;j<' + n + 'C;j++){' + n + '[j]=' + driver.readF64(vp) + ';' + vp + '+=8}');
            }
            else {
                lines.push('for(let j=0;j<' + n + 'C;j++){' + driver.writeF64(vp, src) + ';' + vp + '+=8}');
            }
            break;
        case 'int32':
            if (dir === 'decode') {
                lines.push('for(let j=0;j<' + n + 'C;j++){' + n + '[j]=' + driver.readI32(vp) + ';' + vp + '+=4}');
            }
            else {
                lines.push('for(let j=0;j<' + n + 'C;j++){' + driver.writeI32(vp, src) + ';' + vp + '+=4}');
            }
            break;
        case 'string':
            if (dir === 'decode') {
                lines.push('for(let j=0;j<' + n + 'C;j++){let l=' + driver.readU32(vp) + ';' + vp + '+=4;' + n + '[j]=' + driver.readUtf8(vp, vp + '+l') + ';' + vp + '+=l}');
            }
            else if (isNode) {
                lines.push('for(let j=0;j<' + n + 'C;j++){let l=buf.utf8Write(' + src + ',' + vp + '+4);' + driver.writeU32(vp, 'l') + ';' + vp + '+=4+l}');
            }
            else {
                lines.push('for(let j=0;j<' + n + 'C;j++){let l=' + driver.byteLen(src) + ';' + driver.writeU32(vp, 'l') + ';' + vp + '+=4;' + vp + '+=' + driver.writeUtf8(src, vp, 'l') + '}');
            }
            break;
        case 'uint16':
            if (dir === 'decode') {
                lines.push('for(let j=0;j<' + n + 'C;j++){' + n + '[j]=' + driver.readU16(vp) + ';' + vp + '+=2}');
            }
            else {
                lines.push('for(let j=0;j<' + n + 'C;j++){' + driver.writeU16(vp, src) + ';' + vp + '+=2}');
            }
            break;
        case 'uint32':
            if (dir === 'decode') {
                lines.push('for(let j=0;j<' + n + 'C;j++){' + n + '[j]=' + driver.readU32(vp) + ';' + vp + '+=4}');
            }
            else {
                lines.push('for(let j=0;j<' + n + 'C;j++){' + driver.writeU32(vp, src) + ';' + vp + '+=4}');
            }
            break;
        case 'uint8':
            if (dir === 'decode') {
                lines.push('for(let j=0;j<' + n + 'C;j++){' + n + '[j]=buf[' + vp + '++]}');
            }
            else {
                lines.push('for(let j=0;j<' + n + 'C;j++){buf[' + vp + '++]=' + src + '}');
            }
            break;
    }
}

function emitFixed(lines: string[], field: FieldDef, off: string, dir: 'decode' | 'encode'): void {
    let n = field.name;

    if (dir === 'decode') {
        switch (field.type) {
            case 'bigint': lines.push('let ' + n + '=' + driver.readBI64(off)); break;
            case 'boolean': lines.push('let ' + n + '=!!buf[' + off + ']'); break;
            case 'date': lines.push('let ' + n + '=new Date(' + driver.readF64(off) + ')'); break;
            case 'float64': lines.push('let ' + n + '=' + driver.readF64(off)); break;
            case 'int8': lines.push('let ' + n + '=(buf[' + off + ']<<24>>24)'); break;
            case 'int16': lines.push('let ' + n + '=' + driver.readI16(off)); break;
            case 'int32': lines.push('let ' + n + '=' + driver.readI32(off)); break;
            case 'uint8': lines.push('let ' + n + '=buf[' + off + ']'); break;
            case 'uint16': lines.push('let ' + n + '=' + driver.readU16(off)); break;
            case 'uint32': lines.push('let ' + n + '=' + driver.readU32(off)); break;
        }
    }
    else {
        let val = 'obj["' + n + '"]';

        switch (field.type) {
            case 'bigint': lines.push(driver.writeBI64(off, val)); break;
            case 'boolean': lines.push('buf[' + off + ']=' + val + '?1:0'); break;
            case 'date': lines.push(driver.writeF64(off, val + '.getTime()')); break;
            case 'float64': lines.push(driver.writeF64(off, val)); break;
            case 'int8': lines.push('buf[' + off + ']=(' + val + ')&0xFF'); break;
            case 'int16': lines.push(driver.writeI16(off, val)); break;
            case 'int32': lines.push(driver.writeI32(off, val)); break;
            case 'uint8': lines.push('buf[' + off + ']=' + val); break;
            case 'uint16': lines.push(driver.writeU16(off, val)); break;
            case 'uint32': lines.push(driver.writeU32(off, val)); break;
        }
    }
}

function emitFloat64ArrayCompressed(lines: string[], field: FieldDef, vp: string, dir: 'decode' | 'encode'): void {
    let n = field.name;

    if (dir === 'decode') {
        lines.push('let ' + n + 'C=' + driver.readU16(vp));
        lines.push(vp + '+=2');
        lines.push('let ' + n + '=new Array(' + n + 'C)');
        lines.push('if(' + n + 'C>0){let _flg=buf[' + vp + '++]');
        lines.push('if(_flg===0){$rv(buf,' + vp + ')');
        lines.push('let _base=$vr.value');
        lines.push(vp + '=$vr.pos');
        lines.push(n + '[0]=_base');
        lines.push('for(let j=1;j<' + n + 'C;j++){$rz(buf,' + vp + ');_base+=$vr.value;' + vp + '=$vr.pos;' + n + '[j]=_base}');
        lines.push('}else{for(let j=0;j<' + n + 'C;j++){' + n + '[j]=' + driver.readF64(vp) + ';' + vp + '+=8}}}');
    }
    else {
        let val = 'obj["' + n + '"]';

        lines.push('let ' + n + 'A=' + val);
        lines.push('let ' + n + 'C=' + n + 'A.length');
        lines.push(driver.writeU16(vp, n + 'C'));
        lines.push(vp + '+=2');
        lines.push('if(' + n + 'C>0){let _allInt=true');
        lines.push('for(let j=0;j<' + n + 'C;j++){if(' + n + 'A[j]!==(' + n + 'A[j]|0)){_allInt=false;break}}');
        lines.push('if(_allInt){buf[' + vp + '++]=0');
        lines.push(vp + '=$wv(buf,' + vp + ',' + n + 'A[0])');
        lines.push('for(let j=1;j<' + n + 'C;j++){' + vp + '=$wz(buf,' + vp + ',' + n + 'A[j]-' + n + 'A[j-1])}');
        lines.push('}else{buf[' + vp + '++]=1');
        lines.push('for(let j=0;j<' + n + 'C;j++){' + driver.writeF64(vp, n + 'A[j]') + ';' + vp + '+=8}}}');
    }
}

function emitNullBitmapInit(lines: string[], bitmapBytes: number): void {
    lines.push('let _bm=0');
    lines.push('let _bmPos=pos');
    lines.push('pos+=' + bitmapBytes);
}

function emitNullBitmapRead(lines: string[], bitmapBytes: number): void {
    lines.push('let _bm=buf[pos]');

    if (bitmapBytes > 1) {
        lines.push('_bm|=buf[pos+1]<<8');
    }

    lines.push('pos+=' + bitmapBytes);
}

function emitNullBitmapWrite(lines: string[], nullBmBytes: number): void {
    lines.push('buf[_bmPos]=_bm&0xFF');

    if (nullBmBytes > 1) {
        lines.push('buf[_bmPos+1]=(_bm>>8)&0xFF');
    }
}

function emitVar(lines: string[], field: FieldDef, vp: string, dir: 'decode' | 'encode', internFields?: Set<string>): void {
    let n = field.name,
        type = field.type;

    if (typeof type === 'string') {
        if (dir === 'decode') {
            switch (type) {
                case 'bytes':
                    lines.push('let ' + n + 'L=' + driver.readU32(vp));
                    lines.push(vp + '+=4');
                    lines.push('let ' + n + '=buf.subarray(' + vp + ',' + vp + '+' + n + 'L)');
                    lines.push(vp + '+=' + n + 'L');
                    break;
                case 'string':
                    if (internFields && internFields.has(n)) {
                        lines.push('let ' + n + 'L=' + driver.readU32(vp));
                        lines.push(vp + '+=4');
                        lines.push('let ' + n);
                        lines.push('if(' + n + 'L===0xFFFFFFFF){' + n + '=$sd(buf,' + vp + ');' + vp + '+=4}else{' + n + '=' + driver.readUtf8(vp, vp + '+' + n + 'L') + ';' + vp + '+=' + n + 'L}');
                    }
                    else {
                        lines.push('let ' + n + 'L=' + driver.readU32(vp));
                        lines.push(vp + '+=4');
                        lines.push('let ' + n + '=' + driver.readUtf8(vp, vp + '+' + n + 'L'));
                        lines.push(vp + '+=' + n + 'L');
                    }
                    break;
            }
        }
        else {
            let val = 'obj["' + n + '"]';

            switch (type) {
                case 'bytes':
                    lines.push('let ' + n + 'L=' + val + '.length');
                    lines.push(driver.writeU32(vp, n + 'L'));
                    lines.push(vp + '+=4');
                    lines.push('buf.set(' + val + ',' + vp + ')');
                    lines.push(vp + '+=' + n + 'L');
                    break;
                case 'string':
                    if (internFields && internFields.has(n)) {
                        lines.push(vp + '=$si(\'' + n + '\',' + val + ',buf,' + vp + ')');
                    }
                    else if (isNode) {
                        lines.push('let ' + n + 'L=buf.utf8Write(' + val + ',' + vp + '+4)');
                        lines.push(driver.writeU32(vp, n + 'L'));
                        lines.push(vp + '+=4+' + n + 'L');
                    }
                    else {
                        lines.push('let ' + n + 'L=' + driver.byteLen(val));
                        lines.push(driver.writeU32(vp, n + 'L'));
                        lines.push(vp + '+=4');
                        lines.push(vp + '+=' + driver.writeUtf8(val, vp, n + 'L'));
                    }
                    break;
            }
        }

        return;
    }

    if (type.kind === 'nullable') {
        if (dir === 'decode') {
            lines.push('let ' + n + '=null');
            lines.push('if(_bm&' + (1 << field._nullIndex!) + '){');
            emitVarInner(lines, n, type.inner, vp, 'decode');
            lines.push('}');
        }
        else {
            let val = 'obj["' + n + '"]';

            lines.push('if(' + val + '!=null){_bm|=' + (1 << field._nullIndex!) + ';');
            emitVarInner(lines, val, type.inner, vp, 'encode');
            lines.push('}');
        }

        return;
    }

    if (type.kind === 'object') {
        if (dir === 'decode') {
            lines.push('let ' + n + 'L=' + driver.readU32(vp));
            lines.push(vp + '+=4');
            lines.push('let ' + n + '=$d(buf,' + vp + ',' + n + 'L)');
            lines.push(vp + '+=' + n + 'L');
        }
        else {
            let val = 'obj["' + n + '"]';

            lines.push('let ' + n + 'S=' + vp);
            lines.push(vp + '+=4');
            lines.push(vp + '=$e(' + val + ',buf,' + vp + ')');
            lines.push(driver.writeU32(n + 'S', vp + '-' + n + 'S-4'));
        }

        return;
    }

    if (type.kind === 'array') {
        let elem = type.element;

        if (dir === 'decode') {
            lines.push('let ' + n + 'C=' + driver.readU16(vp));
            lines.push(vp + '+=2');
            lines.push('let ' + n + '=new Array(' + n + 'C)');
        }
        else {
            lines.push('let ' + n + 'A=obj["' + n + '"]');
            lines.push('let ' + n + 'C=' + n + 'A.length');
            lines.push(driver.writeU16(vp, n + 'C'));
            lines.push(vp + '+=2');
        }

        emitArrayElements(lines, n, elem, vp, dir);

        return;
    }
}

function emitVarInner(lines: string[], nameOrVal: string, type: FieldType, vp: string, dir: 'decode' | 'encode'): void {
    if (typeof type !== 'string') {
        throw new Error('SBC: compound inner types (array, object, nullable) are not supported in nullable fields');
    }

    if (dir === 'decode') {
        switch (type) {
            case 'bigint':
                lines.push(nameOrVal + '=' + driver.readBI64(vp));
                lines.push(vp + '+=8');
                break;
            case 'boolean':
                lines.push(nameOrVal + '=!!buf[' + vp + '++]');
                break;
            case 'bytes':
                lines.push('let ' + nameOrVal + 'L=' + driver.readU32(vp));
                lines.push(vp + '+=4');
                lines.push(nameOrVal + '=buf.subarray(' + vp + ',' + vp + '+' + nameOrVal + 'L)');
                lines.push(vp + '+=' + nameOrVal + 'L');
                break;
            case 'date':
                lines.push(nameOrVal + '=new Date(' + driver.readF64(vp) + ')');
                lines.push(vp + '+=8');
                break;
            case 'float64':
                lines.push(nameOrVal + '=' + driver.readF64(vp));
                lines.push(vp + '+=8');
                break;
            case 'int8':
                lines.push(nameOrVal + '=(buf[' + vp + '++]<<24>>24)');
                break;
            case 'int16':
                lines.push(nameOrVal + '=' + driver.readI16(vp));
                lines.push(vp + '+=2');
                break;
            case 'int32':
                lines.push(nameOrVal + '=' + driver.readI32(vp));
                lines.push(vp + '+=4');
                break;
            case 'string':
                lines.push('let ' + nameOrVal + 'L=' + driver.readU32(vp));
                lines.push(vp + '+=4');
                lines.push(nameOrVal + '=' + driver.readUtf8(vp, vp + '+' + nameOrVal + 'L'));
                lines.push(vp + '+=' + nameOrVal + 'L');
                break;
            case 'uint8':
                lines.push(nameOrVal + '=buf[' + vp + '++]');
                break;
            case 'uint16':
                lines.push(nameOrVal + '=' + driver.readU16(vp));
                lines.push(vp + '+=2');
                break;
            case 'uint32':
                lines.push(nameOrVal + '=' + driver.readU32(vp));
                lines.push(vp + '+=4');
                break;
            default:
                throw new Error('SBC: unsupported nullable inner type: ' + type);
        }
    }
    else {
        switch (type) {
            case 'bigint':
                lines.push(driver.writeBI64(vp, nameOrVal));
                lines.push(vp + '+=8');
                break;
            case 'boolean':
                lines.push('buf[' + vp + '++]=' + nameOrVal + '?1:0');
                break;
            case 'bytes':
                lines.push('let _bl=' + nameOrVal + '.length');
                lines.push(driver.writeU32(vp, '_bl'));
                lines.push(vp + '+=4');
                lines.push('buf.set(' + nameOrVal + ',' + vp + ')');
                lines.push(vp + '+=_bl');
                break;
            case 'date':
                lines.push(driver.writeF64(vp, nameOrVal + '.getTime()'));
                lines.push(vp + '+=8');
                break;
            case 'float64':
                lines.push(driver.writeF64(vp, nameOrVal));
                lines.push(vp + '+=8');
                break;
            case 'int8':
                lines.push('buf[' + vp + '++]=(' + nameOrVal + ')&0xFF');
                break;
            case 'int16':
                lines.push(driver.writeI16(vp, nameOrVal));
                lines.push(vp + '+=2');
                break;
            case 'int32':
                lines.push(driver.writeI32(vp, nameOrVal));
                lines.push(vp + '+=4');
                break;
            case 'string':
                if (isNode) {
                    lines.push('let _nl=buf.utf8Write(' + nameOrVal + ',' + vp + '+4)');
                    lines.push(driver.writeU32(vp, '_nl'));
                    lines.push(vp + '+=4+_nl');
                }
                else {
                    lines.push('let _nl=' + driver.byteLen(nameOrVal));
                    lines.push(driver.writeU32(vp, '_nl'));
                    lines.push(vp + '+=4');
                    lines.push(vp + '+=' + driver.writeUtf8(nameOrVal, vp, '_nl'));
                }
                break;
            case 'uint8':
                lines.push('buf[' + vp + '++]=' + nameOrVal);
                break;
            case 'uint16':
                lines.push(driver.writeU16(vp, nameOrVal));
                lines.push(vp + '+=2');
                break;
            case 'uint32':
                lines.push(driver.writeU32(vp, nameOrVal));
                lines.push(vp + '+=4');
                break;
            default:
                throw new Error('SBC: unsupported nullable inner type: ' + type);
        }
    }
}

function emitVarFields(lines: string[], schema: Schema, vp: string, dir: 'decode' | 'encode', isCompressed: boolean, internFields?: Set<string>): boolean {
    let hasVar = false;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (isCompressed) {
            if (field.fixedSize > 0 || field.type === 'boolean') {
                continue;
            }

            if (typeof field.type === 'object' && field.type.kind === 'array' && isVarintIntType(field.type.element)) {
                emitDeltaArray(lines, field, vp, dir);
                continue;
            }

            if (typeof field.type === 'object' && field.type.kind === 'array' && field.type.element === 'float64') {
                emitFloat64ArrayCompressed(lines, field, vp, dir);
                continue;
            }

            if (!isVarintIntType(field.type) && field.type !== 'float64') {
                emitVar(lines, field, vp, dir, internFields);
            }
        }
        else {
            if (field.fixedSize > 0) {
                continue;
            }

            if (!hasVar) {
                lines.push('let ' + vp + '=pos+' + schema.fixedSize);
                hasVar = true;
            }

            emitVar(lines, field, vp, dir, internFields);
        }
    }

    return hasVar;
}

function finalizeBody(lines: string[]): string {
    let preamble = driver.preamble('buf');

    if (preamble) {
        lines.unshift(preamble);
    }

    return lines.join(';');
}

function isCompressible(fields: FieldDef[]): boolean {
    let boolCount = 0,
        hasCompressible = false;

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.type === 'boolean') {
            boolCount++;
            continue;
        }

        if (field.type === 'float64' || isVarintIntType(field.type)) {
            hasCompressible = true;
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && (isVarintIntType(field.type.element) || field.type.element === 'float64')) {
            hasCompressible = true;
        }
    }

    if (boolCount > 16) {
        return false;
    }

    return hasCompressible || boolCount > 0;
}

function isSignedIntType(type: string): boolean {
    return type === 'int8' || type === 'int16' || type === 'int32';
}

function isSizeComputable(schema: Schema): boolean {
    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let type = schema.fields[i]!.type;

        if (typeof type === 'string') {
            if (FIELD_SIZES[type] || type === 'bytes' || type === 'string') {
                continue;
            }

            return false;
        }

        if (type.kind === 'object') {
            continue;
        }

        if (type.kind === 'array') {
            let elem = type.element;

            if (typeof elem === 'string' && (FIELD_SIZES[elem] || elem === 'string')) {
                continue;
            }

            return false;
        }

        if (type.kind === 'nullable') {
            let inner = type.inner;

            if (typeof inner === 'string') {
                if (FIELD_SIZES[inner] || inner === 'bytes' || inner === 'string') {
                    continue;
                }

                return false;
            }

            if (typeof inner === 'object' && inner.kind === 'array') {
                let elem = inner.element;

                if (typeof elem === 'string' && (FIELD_SIZES[elem] || elem === 'string')) {
                    continue;
                }

                return false;
            }

            return false;
        }

        // mixed and other complex types are not size-computable
        return false;
    }

    return true;
}

function isVarintIntType(type: FieldType): boolean {
    return type === 'int16' || type === 'int32' || type === 'uint16' || type === 'uint32';
}

function sortFields(a: FieldDef, b: FieldDef): number {
    if (a.fixedSize > 0 && b.fixedSize === 0) {
        return -1;
    }

    if (a.fixedSize === 0 && b.fixedSize > 0) {
        return 1;
    }

    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function sortFieldsByName(schema: Schema): FieldDef[] {
    return schema.fieldsSorted ??= schema.fields.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}


export { buildSchema, buildSchemaFromDef, CODEGEN_RESERVED_NAMES, compileCompressedDecoder, compileCompressedEncoder, compileSchema, validateFieldName, validateFieldTypeString };
