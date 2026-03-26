// Schema Binary Codec (SBC) — Zero-overhead value encoding
// Tag 246: hash-referenced objects stored with central schema DB
// Primitives: tags 248-254 (self-describing, no schema needed)

function getTypedArrayType(_value: unknown): number { return -1; }
function encodeTypedArray(_value: unknown): Uint8Array { return new Uint8Array(0); }


let isNode = typeof Buffer !== 'undefined',
    textDecoder = new TextDecoder(),
    textEncoder = new TextEncoder();


// Buffer/DataView abstraction — decided once at module load, no branching per call.

let allocBuf: (n: number) => Uint8Array = isNode
    ? Buffer.alloc.bind(Buffer) as (n: number) => Uint8Array
    : (n) => new Uint8Array(n);

let allocUnsafe: (n: number) => Uint8Array = isNode
    ? Buffer.allocUnsafe.bind(Buffer) as (n: number) => Uint8Array
    : (n) => new Uint8Array(n);

let byteLen: (str: string) => number = isNode
    ? Buffer.byteLength.bind(Buffer) as (str: string) => number
    : (str) => textEncoder.encode(str).length;

let copyBuf: (src: Uint8Array, dst: Uint8Array, dstOffset: number, srcStart: number, srcEnd: number) => void = isNode
    ? (src, dst, dstOffset, srcStart, srcEnd) => (src as Buffer).copy(dst as Buffer, dstOffset, srcStart, srcEnd)
    : (src, dst, dstOffset, srcStart, srcEnd) => dst.set(src.subarray(srcStart, srcEnd), dstOffset);

let fromUtf8: (str: string) => Uint8Array = isNode
    ? (str) => Buffer.from(str, 'utf8')
    : (str) => textEncoder.encode(str);

// Instance methods — use .call(buf, ...) at call sites. No wrappers.
// Reads: readF64.call(buf, off). Writes: writeF64.call(buf, val, off).
let readBI64: ((off: number) => bigint) = isNode
    ? Buffer.prototype.readBigInt64LE
    : function (this: Uint8Array, off: number) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getBigInt64(off, true); };

let readF64: ((off: number) => number) = isNode
    ? Buffer.prototype.readDoubleLE
    : function (this: Uint8Array, off: number) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat64(off, true); };

let readI16: ((off: number) => number) = isNode
    ? Buffer.prototype.readInt16LE
    : function (this: Uint8Array, off: number) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt16(off, true); };

let readI32: ((off: number) => number) = isNode
    ? Buffer.prototype.readInt32LE
    : function (this: Uint8Array, off: number) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt32(off, true); };

let readU16: ((off: number) => number) = isNode
    ? Buffer.prototype.readUInt16LE
    : function (this: Uint8Array, off: number) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(off, true); };

let readU32: ((off: number) => number) = isNode
    ? Buffer.prototype.readUInt32LE
    : function (this: Uint8Array, off: number) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(off, true); };

let readUtf8: ((start: number, end: number) => string) = isNode
    ? (Buffer.prototype as unknown as { utf8Slice: (start: number, end: number) => string }).utf8Slice
    : function (this: Uint8Array, start: number, end: number) { return textDecoder.decode(this.subarray(start, end)); };

let toUtf8: (buf: Uint8Array) => string = isNode
    ? (buf) => Buffer.from(buf).toString('utf8')
    : (buf) => textDecoder.decode(buf);

let writeBI64: ((val: bigint, off: number) => void) = isNode
    ? Buffer.prototype.writeBigInt64LE as unknown as (val: bigint, off: number) => void
    : function (this: Uint8Array, val: bigint, off: number) { new DataView(this.buffer, this.byteOffset, this.byteLength).setBigInt64(off, val, true); };

let writeF64: ((val: number, off: number) => void) = isNode
    ? Buffer.prototype.writeDoubleLE as unknown as (val: number, off: number) => void
    : function (this: Uint8Array, val: number, off: number) { new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat64(off, val, true); };

let writeI16: ((val: number, off: number) => void) = isNode
    ? Buffer.prototype.writeInt16LE as unknown as (val: number, off: number) => void
    : function (this: Uint8Array, val: number, off: number) { new DataView(this.buffer, this.byteOffset, this.byteLength).setInt16(off, val, true); };

let writeI32: ((val: number, off: number) => void) = isNode
    ? Buffer.prototype.writeInt32LE as unknown as (val: number, off: number) => void
    : function (this: Uint8Array, val: number, off: number) { new DataView(this.buffer, this.byteOffset, this.byteLength).setInt32(off, val, true); };

let writeU16: ((val: number, off: number) => void) = isNode
    ? Buffer.prototype.writeUInt16LE as unknown as (val: number, off: number) => void
    : function (this: Uint8Array, val: number, off: number) { new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(off, val, true); };

let writeU32: ((val: number, off: number) => void) = isNode
    ? Buffer.prototype.writeUInt32LE as unknown as (val: number, off: number) => void
    : function (this: Uint8Array, val: number, off: number) { new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(off, val, true); };

let writeUtf8: ((str: string, off: number, len: number) => number) = isNode
    ? (Buffer.prototype as unknown as { utf8Write: (str: string, off: number, len: number) => number }).utf8Write
    : function (this: Uint8Array, str: string, off: number, len: number) { return textEncoder.encodeInto(str, this.subarray(off, off + len)).written!; };


// Codegen driver — emits environment-specific code strings for compiled encode/decode functions.
// Node: direct Buffer method calls (zero overhead, V8 inlines them).
// Browser: DataView preamble with reused view (one alloc per function call instead of per field).

interface CodegenDriver {
    byteLen(str: string): string;
    decoderBindArgs(): unknown[];
    decoderParams(): string;
    encoderBindArgs(): unknown[];
    encoderParams(): string;
    preamble(bufVar: string): string;
    readBI64(off: string): string;
    readF64(off: string): string;
    readI16(off: string): string;
    readI32(off: string): string;
    readU16(off: string): string;
    readU32(off: string): string;
    readUtf8(start: string, end: string): string;
    writeBI64(off: string, val: string): string;
    writeF64(off: string, val: string): string;
    writeI16(off: string, val: string): string;
    writeI32(off: string, val: string): string;
    writeU16(off: string, val: string): string;
    writeU32(off: string, val: string): string;
    writeUtf8(str: string, off: string, len: string): string;
}

let nodeDriver: CodegenDriver = {
    byteLen: (str) => 'Buffer.byteLength(' + str + ')',
    decoderBindArgs: () => [],
    decoderParams: () => '',
    encoderBindArgs: () => [],
    encoderParams: () => '',
    preamble: () => '',
    readBI64: (off) => 'buf.readBigInt64LE(' + off + ')',
    readF64: (off) => 'buf.readDoubleLE(' + off + ')',
    readI16: (off) => 'buf.readInt16LE(' + off + ')',
    readI32: (off) => 'buf.readInt32LE(' + off + ')',
    readU16: (off) => 'buf.readUInt16LE(' + off + ')',
    readU32: (off) => 'buf.readUInt32LE(' + off + ')',
    readUtf8: (start, end) => 'buf.utf8Slice(' + start + ',' + end + ')',
    writeBI64: (off, val) => 'buf.writeBigInt64LE(' + val + ',' + off + ')',
    writeF64: (off, val) => 'buf.writeDoubleLE(' + val + ',' + off + ')',
    writeI16: (off, val) => 'buf.writeInt16LE(' + val + ',' + off + ')',
    writeI32: (off, val) => 'buf.writeInt32LE(' + val + ',' + off + ')',
    writeU16: (off, val) => 'buf.writeUInt16LE(' + val + ',' + off + ')',
    writeU32: (off, val) => 'buf.writeUInt32LE(' + val + ',' + off + ')',
    writeUtf8: (str, off, len) => 'buf.utf8Write(' + str + ',' + off + ',' + len + ')',
};

let browserUtf8Write = (buf: Uint8Array, str: string, off: number, len: number): number =>
    textEncoder.encodeInto(str, buf.subarray(off, off + len)).written!;

let browserDriver: CodegenDriver = {
    byteLen: (str) => '$byteLen(' + str + ')',
    decoderBindArgs: () => [],
    decoderParams: () => '',
    encoderBindArgs: () => [byteLen, browserUtf8Write],
    encoderParams: () => '$byteLen,$utf8w,',
    preamble: (buf) => 'let _v=new DataView(' + buf + '.buffer,' + buf + '.byteOffset,' + buf + '.byteLength)',
    readBI64: (off) => '_v.getBigInt64(' + off + ',true)',
    readF64: (off) => '_v.getFloat64(' + off + ',true)',
    readI16: (off) => '_v.getInt16(' + off + ',true)',
    readI32: (off) => '_v.getInt32(' + off + ',true)',
    readU16: (off) => '_v.getUint16(' + off + ',true)',
    readU32: (off) => '_v.getUint32(' + off + ',true)',
    readUtf8: (start, end) => 'new TextDecoder().decode(buf.subarray(' + start + ',' + end + '))',
    writeBI64: (off, val) => '_v.setBigInt64(' + off + ',' + val + ',true)',
    writeF64: (off, val) => '_v.setFloat64(' + off + ',' + val + ',true)',
    writeI16: (off, val) => '_v.setInt16(' + off + ',' + val + ',true)',
    writeI32: (off, val) => '_v.setInt32(' + off + ',' + val + ',true)',
    writeU16: (off, val) => '_v.setUint16(' + off + ',' + val + ',true)',
    writeU32: (off, val) => '_v.setUint32(' + off + ',' + val + ',true)',
    writeUtf8: (str, off, len) => '$utf8w(' + str + ',' + off + ',' + len + ')',
};

let driver: CodegenDriver = isNode ? nodeDriver : browserDriver;


interface SchemaStoreInterface {
    get(hash: number): Schema | null;
    has(hash: number): boolean;
    register(hash: number, schema: Schema): void;
}


type ArrayFieldType = { element: FieldType; kind: 'array' };

type FieldType =
    | 'bigint'
    | 'boolean'
    | 'bytes'
    | 'date'
    | 'float64'
    | 'int8'
    | 'int16'
    | 'int32'
    | 'mixed'
    | 'string'
    | 'uint8'
    | 'uint16'
    | 'uint32'
    | ArrayFieldType
    | NullableFieldType
    | ObjectFieldType;

interface FieldDef {
    _nullIndex?: number;
    fixedSize: number;
    name: string;
    offset: number;
    type: FieldType;
}

type NullableFieldType = { inner: FieldType; kind: 'nullable' };

type ObjectFieldType = { kind: 'object'; schemaId: number };

interface Schema {
    compressedDecodeFn: ((buf: Uint8Array, pos: number) => unknown) | null;
    compressedEncodeFn: ((obj: unknown, buf: Uint8Array, pos: number) => number) | null;
    compressible: boolean;
    computeSize: ((obj: unknown) => number) | null;
    decodeFn: ((buf: Uint8Array, pos: number) => unknown) | null;
    encodeFn: ((obj: unknown, buf: Uint8Array, pos: number) => number) | null;
    fields: FieldDef[];
    fixedSize: number;
    hash: number;
    id: number;
    nullableCount: number;
}

interface SchemaRegistry {
    constructorCache: WeakMap<Function, Schema>;
    lastSchema: Schema | null;
    nextId: number;
    schemas: Map<number, Schema>;
    schemasByCount: Map<number, Schema[]>;
    schemasByHash: Map<number, Schema>;
}


let FIELD_SIZES: Record<string, number> = {
    bigint: 8,
    boolean: 1,
    date: 8,
    float64: 8,
    int8: 1,
    int16: 2,
    int32: 4,
    uint8: 1,
    uint16: 2,
    uint32: 4,
};


let varintResult = { pos: 0, value: 0 };


function buildComputeSize(schema: Schema, registry?: SchemaRegistry): (obj: unknown) => number {
    let bitmapBytes = Math.ceil(schema.nullableCount / 8),
        fixedTotal = 9 + bitmapBytes + schema.fixedSize,
        hasObjectFields = false,
        lines: string[] = ['let s=' + fixedTotal];

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let f = schema.fields[i]!;

        if (f.fixedSize > 0) {
            continue;
        }

        let type = f.type,
            val = 'obj.' + f.name;

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
            lines.push('{let _i=$ls(' + val + ',$reg);if(!_i||!_i.computeSize)return -1;let _n=_i.computeSize(' + val + ');if(_n<0)return -1;s+=2+_n}');
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
        return new Function('$bl', '$ls', '$reg', 'obj', lines.join(';')).bind(null, byteLen, lookupSchema, registry) as (obj: unknown) => number;
    }

    return new Function('$bl', 'obj', lines.join(';')).bind(null, byteLen) as (obj: unknown) => number;
}

function buildSchemaFromDef(def: { fields: { fixedSize: number; name: string; type: string }[]; hash: number; id: number; nullableCount: number }): Schema {
    let fields: FieldDef[] = def.fields.map((f) => ({
        fixedSize: f.fixedSize,
        name: f.name,
        offset: 0,
        type: parseFieldType(f.type),
    }));
    let fixedSize = computeFieldOffsets(fields);

    return {
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible: isCompressible(fields),
        computeSize: null,
        decodeFn: null,
        encodeFn: null,
        fields,
        fixedSize,
        hash: def.hash,
        id: def.id,
        nullableCount: def.nullableCount,
    };
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

        if (field.type === 'float64' || isIntegerType(field.type)) {
            hasCompressible = true;
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && (isDeltaArrayType(field.type.element) || field.type.element === 'float64')) {
            hasCompressible = true;
        }
    }

    if (boolCount > 16) {
        return false;
    }

    return hasCompressible || boolCount > 0;
}

function isDeltaArrayType(type: FieldType): boolean {
    return type === 'int16' || type === 'int32' || type === 'uint16' || type === 'uint32';
}

function isIntegerType(type: FieldType): boolean {
    return type === 'int16' || type === 'int32' || type === 'uint16' || type === 'uint32';
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
    }

    return true;
}

function isSignedIntType(type: string): boolean {
    return type === 'int16' || type === 'int32';
}

function readVarint(buf: Uint8Array, pos: number): void {
    let byte = buf[pos]!,
        result = byte & 0x7F,
        shift = 7;

    while (byte & 0x80) {
        byte = buf[++pos]!;
        result |= (byte & 0x7F) << shift;
        shift += 7;
    }

    varintResult.pos = pos + 1;
    varintResult.value = result;
}

function readZigzag(buf: Uint8Array, pos: number): void {
    readVarint(buf, pos);
    let v = varintResult.value;

    varintResult.value = (v >>> 1) ^ -(v & 1);
}

function writeVarint(buf: Uint8Array, pos: number, value: number): number {
    value = value >>> 0;

    while (value > 0x7F) {
        buf[pos++] = (value & 0x7F) | 0x80;
        value >>>= 7;
    }

    buf[pos++] = value;

    return pos;
}

function writeZigzag(buf: Uint8Array, pos: number, value: number): number {
    return writeVarint(buf, pos, (value << 1) ^ (value >> 31));
}


function compileCompressedDecoder(schema: Schema, registry: SchemaRegistry, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, internFields?: Set<string>, internDecode?: (buf: Uint8Array, pos: number) => string): (buf: Uint8Array, pos: number) => unknown {
    let boolFields: FieldDef[] = [],
        float64Fields: FieldDef[] = [],
        intFields: FieldDef[] = [],
        lines: string[] = [],
        otherFixed: FieldDef[] = [],
        vp = 'vp';

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.type === 'boolean') {
            boolFields.push(field);
        }
        else if (field.type === 'float64') {
            float64Fields.push(field);
        }
        else if (isIntegerType(field.type)) {
            intFields.push(field);
        }
        else if (field.fixedSize > 0) {
            otherFixed.push(field);
        }
    }

    let hasNullable = schema.nullableCount > 0,
        nullIndex = 0;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            (field as FieldDef & { _nullIndex?: number })._nullIndex = nullIndex++;
        }
    }

    let bitmapBytes = hasNullable ? Math.ceil(schema.nullableCount / 8) : 0;

    if (hasNullable) {
        lines.push('let _bm=buf[pos]');

        if (bitmapBytes > 1) {
            lines.push('_bm|=buf[pos+1]<<8');
        }

        lines.push('pos+=' + bitmapBytes);
    }

    let boolBitmapBytes = Math.ceil(boolFields.length / 8);

    if (boolFields.length > 0) {
        lines.push('let _bb=buf[pos]');

        if (boolBitmapBytes > 1) {
            lines.push('_bb|=buf[pos+1]<<8');
        }

        lines.push('pos+=' + boolBitmapBytes);

        for (let i = 0, n = boolFields.length; i < n; i++) {
            lines.push('let ' + boolFields[i]!.name + '=!!(_bb&' + (1 << i) + ')');
        }
    }

    let compFixedOffset = 0;

    for (let i = 0, n = otherFixed.length; i < n; i++) {
        let field = otherFixed[i]!;

        lines.push('let ' + field.name + '=' + emitDecoderFixedExpr(field, 'pos+' + compFixedOffset));
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

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0 || field.type === 'boolean') {
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && isDeltaArrayType(field.type.element)) {
            emitDeltaArrayDecoder(lines, field, vp);
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && field.type.element === 'float64') {
            emitFloat64ArrayCompressedDecoder(lines, field, vp);
            continue;
        }

        if (!isIntegerType(field.type) && field.type !== 'float64') {
            emitDecoderVar(lines, field, vp, internFields);
        }
    }

    let allFields = schema.fields.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    lines.push('return{' + allFields.map((f) => f.name).join(',') + '}');

    let preamble = driver.preamble('buf');

    if (preamble) {
        lines.unshift(preamble);
    }

    let body = lines.join(';');
    let $d = helpers?.decodeSbc ?? ((_buf: Uint8Array, _offset: number, _len: number) => null);

    if (internFields && internFields.size > 0 && internDecode) {
        return new Function('$d', '$rv', '$rz', '$vr', '$sd', driver.decoderParams() + 'buf', 'pos', body).bind(null, $d, readVarint, readZigzag, varintResult, internDecode, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown;
    }

    return new Function('$d', '$rv', '$rz', '$vr', driver.decoderParams() + 'buf', 'pos', body).bind(null, $d, readVarint, readZigzag, varintResult, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown;
}

function compileCompressedEncoder(schema: Schema, registry: SchemaRegistry, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, internFields?: Set<string>, internEncode?: (field: string, value: string, buf: Uint8Array, pos: number) => number): (obj: unknown, buf: Uint8Array, pos: number) => number {
    let boolFields: FieldDef[] = [],
        float64Fields: FieldDef[] = [],
        intFields: FieldDef[] = [],
        lines: string[] = [],
        otherFixed: FieldDef[] = [],
        vp = 'vp';

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.type === 'boolean') {
            boolFields.push(field);
        }
        else if (field.type === 'float64') {
            float64Fields.push(field);
        }
        else if (isIntegerType(field.type)) {
            intFields.push(field);
        }
        else if (field.fixedSize > 0) {
            otherFixed.push(field);
        }
    }

    let hasNullable = schema.nullableCount > 0,
        nullIndex = 0;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            (field as FieldDef & { _nullIndex?: number })._nullIndex = nullIndex++;
        }
    }

    let bitmapBytes = hasNullable ? Math.ceil(schema.nullableCount / 8) : 0;

    if (hasNullable) {
        lines.push('let _bm=0');
        lines.push('let _bmPos=pos');
        lines.push('pos+=' + bitmapBytes);
    }

    let boolBitmapBytes = Math.ceil(boolFields.length / 8);

    if (boolFields.length > 0) {
        lines.push('let _bb=0');
        lines.push('let _bbPos=pos');
        lines.push('pos+=' + boolBitmapBytes);

        for (let i = 0, n = boolFields.length; i < n; i++) {
            lines.push('if(obj.' + boolFields[i]!.name + '){_bb|=' + (1 << i) + '}');
        }
    }

    let compFixedOffset = 0;

    for (let i = 0, n = otherFixed.length; i < n; i++) {
        let field = otherFixed[i]!;

        emitEncoderFixedAtOffset(lines, field, 'pos+' + compFixedOffset);
        compFixedOffset += field.fixedSize;
    }

    lines.push('let ' + vp + '=pos+' + compFixedOffset);

    for (let i = 0, n = intFields.length; i < n; i++) {
        let field = intFields[i]!;

        if (isSignedIntType(field.type as string)) {
            lines.push(vp + '=$wz(buf,' + vp + ',obj.' + field.name + ')');
        }
        else {
            lines.push(vp + '=$wv(buf,' + vp + ',obj.' + field.name + ')');
        }
    }

    for (let i = 0, n = float64Fields.length; i < n; i++) {
        let f = float64Fields[i]!.name;

        lines.push('let ' + f + 'I=obj.' + f + '===(obj.' + f + '|0)');
        lines.push('if(' + f + 'I){buf[' + vp + ']=0;' + vp + '++;' + vp + '=$wz(buf,' + vp + ',obj.' + f + ')}else{buf[' + vp + ']=1;' + vp + '++;' + driver.writeF64(vp, 'obj.' + f) + ';' + vp + '+=8}');
    }

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0 || field.type === 'boolean') {
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && isDeltaArrayType(field.type.element)) {
            emitDeltaArrayEncoder(lines, field, vp);
            continue;
        }

        if (typeof field.type === 'object' && field.type.kind === 'array' && field.type.element === 'float64') {
            emitFloat64ArrayCompressedEncoder(lines, field, vp);
            continue;
        }

        if (!isIntegerType(field.type) && field.type !== 'float64') {
            emitEncoderVar(lines, field, vp, internFields);
        }
    }

    if (boolFields.length > 0) {
        lines.push('buf[_bbPos]=_bb&0xFF');

        if (boolBitmapBytes > 1) {
            lines.push('buf[_bbPos+1]=(_bb>>8)&0xFF');
        }
    }

    if (hasNullable) {
        lines.push('buf[_bmPos]=_bm&0xFF');

        if (bitmapBytes > 1) {
            lines.push('buf[_bmPos+1]=(_bm>>8)&0xFF');
        }
    }

    lines.push('return ' + vp);

    let preamble = driver.preamble('buf');

    if (preamble) {
        lines.unshift(preamble);
    }

    let body = lines.join(';');
    let $e = helpers?.encodeSbc ?? ((_value: unknown, buf: Uint8Array, pos: number) => { buf[pos] = 0; return pos + 1; });

    if (internFields && internFields.size > 0 && internEncode) {
        return new Function('$e', '$wv', '$wz', '$si', driver.encoderParams() + 'obj', 'buf', 'pos', body).bind(null, $e, writeVarint, writeZigzag, internEncode, ...driver.encoderBindArgs()) as (obj: unknown, buf: Uint8Array, pos: number) => number;
    }

    return new Function('$e', '$wv', '$wz', driver.encoderParams() + 'obj', 'buf', 'pos', body).bind(null, $e, writeVarint, writeZigzag, ...driver.encoderBindArgs()) as (obj: unknown, buf: Uint8Array, pos: number) => number;
}

function emitDecoderFixedExpr(field: FieldDef, off: string): string {
    switch (field.type) {
        case 'bigint': return driver.readBI64(off);
        case 'date': return 'new Date(' + driver.readF64(off) + ')';
        case 'float64': return driver.readF64(off);
        case 'int8': return '(buf[' + off + ']<<24>>24)';
        case 'int16': return driver.readI16(off);
        case 'int32': return driver.readI32(off);
        case 'uint8': return 'buf[' + off + ']';
        case 'uint16': return driver.readU16(off);
        case 'uint32': return driver.readU32(off);
        default: return '0';
    }
}

function emitDeltaArrayDecoder(lines: string[], field: FieldDef, vp: string): void {
    let n = field.name;

    lines.push('let ' + n + 'C=' + driver.readU16(vp));
    lines.push(vp + '+=2');
    lines.push('let ' + n + '=new Array(' + n + 'C)');
    lines.push('if(' + n + 'C>0){$rv(buf,' + vp + ')');
    lines.push('let _base=$vr.value');
    lines.push(vp + '=$vr.pos');
    lines.push(n + '[0]=_base');
    lines.push('for(let j=1;j<' + n + 'C;j++){$rz(buf,' + vp + ');_base+=$vr.value;' + vp + '=$vr.pos;' + n + '[j]=_base}}');
}

function emitDeltaArrayEncoder(lines: string[], field: FieldDef, vp: string): void {
    let n = field.name,
        val = 'obj.' + n;

    lines.push('let ' + n + 'A=' + val);
    lines.push('let ' + n + 'C=' + n + 'A.length');
    lines.push(driver.writeU16(vp, n + 'C'));
    lines.push(vp + '+=2');
    lines.push('if(' + n + 'C>0){' + vp + '=$wv(buf,' + vp + ',' + n + 'A[0])');
    lines.push('for(let j=1;j<' + n + 'C;j++){' + vp + '=$wz(buf,' + vp + ',' + n + 'A[j]-' + n + 'A[j-1])}}');
}

function emitEncoderFixedAtOffset(lines: string[], field: FieldDef, off: string): void {
    let val = 'obj.' + field.name;

    switch (field.type) {
        case 'bigint':
            lines.push(driver.writeBI64(off, val));
            break;
        case 'date':
            lines.push(driver.writeF64(off, val + '.getTime()'));
            break;
        case 'float64':
            lines.push(driver.writeF64(off, val));
            break;
        case 'int8':
            lines.push('buf[' + off + ']=(' + val + ')&0xFF');
            break;
        case 'int16':
            lines.push(driver.writeI16(off, val));
            break;
        case 'int32':
            lines.push(driver.writeI32(off, val));
            break;
        case 'uint8':
            lines.push('buf[' + off + ']=' + val);
            break;
        case 'uint16':
            lines.push(driver.writeU16(off, val));
            break;
        case 'uint32':
            lines.push(driver.writeU32(off, val));
            break;
    }
}

function emitFloat64ArrayCompressedDecoder(lines: string[], field: FieldDef, vp: string): void {
    let n = field.name;

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

function emitFloat64ArrayCompressedEncoder(lines: string[], field: FieldDef, vp: string): void {
    let n = field.name,
        val = 'obj.' + n;

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

function emitDecoderFixed(lines: string[], field: FieldDef): void {
    let off = 'pos+' + field.offset;

    switch (field.type) {
        case 'bigint':
            lines.push('let ' + field.name + '=' + driver.readBI64(off));
            break;
        case 'boolean':
            lines.push('let ' + field.name + '=!!buf[' + off + ']');
            break;
        case 'date':
            lines.push('let ' + field.name + '=new Date(' + driver.readF64(off) + ')');
            break;
        case 'float64':
            lines.push('let ' + field.name + '=' + driver.readF64(off));
            break;
        case 'int8':
            lines.push('let ' + field.name + '=(buf[' + off + ']<<24>>24)');
            break;
        case 'int16':
            lines.push('let ' + field.name + '=' + driver.readI16(off));
            break;
        case 'int32':
            lines.push('let ' + field.name + '=' + driver.readI32(off));
            break;
        case 'uint8':
            lines.push('let ' + field.name + '=buf[' + off + ']');
            break;
        case 'uint16':
            lines.push('let ' + field.name + '=' + driver.readU16(off));
            break;
        case 'uint32':
            lines.push('let ' + field.name + '=' + driver.readU32(off));
            break;
    }
}

function emitDecoderVar(lines: string[], field: FieldDef, vp: string, internFields?: Set<string>): void {
    let type = field.type;

    if (typeof type === 'string') {
        switch (type) {
            case 'bytes':
                lines.push('let ' + field.name + 'L=' + driver.readU32(vp));
                lines.push(vp + '+=4');
                lines.push('let ' + field.name + '=buf.subarray(' + vp + ',' + vp + '+' + field.name + 'L)');
                lines.push(vp + '+=' + field.name + 'L');
                break;
            case 'string':
                if (internFields && internFields.has(field.name)) {
                    lines.push('let ' + field.name + 'L=' + driver.readU32(vp));
                    lines.push(vp + '+=4');
                    lines.push('let ' + field.name);
                    lines.push('if(' + field.name + 'L===0xFFFFFFFF){' + field.name + '=$sd(buf,' + vp + ');' + vp + '+=4}else{' + field.name + '=' + driver.readUtf8(vp, vp + '+' + field.name + 'L') + ';' + vp + '+=' + field.name + 'L}');
                }
                else {
                    lines.push('let ' + field.name + 'L=' + driver.readU32(vp));
                    lines.push(vp + '+=4');
                    lines.push('let ' + field.name + '=' + driver.readUtf8(vp, vp + '+' + field.name + 'L'));
                    lines.push(vp + '+=' + field.name + 'L');
                }
                break;
        }

        return;
    }

    if (type.kind === 'nullable') {
        // Presence bit is in bitmap — handled separately; decode inner type or null
        lines.push('let ' + field.name + '=null');
        lines.push('if(_bm&' + (1 << field._nullIndex!) + '){');
        emitDecoderVarInner(lines, field.name, type.inner, vp);
        lines.push('}');

        return;
    }

    if (type.kind === 'object') {
        // Nested object: read u16 length prefix, decode via decodeSbc
        lines.push('let ' + field.name + 'L=' + driver.readU16(vp));
        lines.push(vp + '+=2');
        lines.push('let ' + field.name + '=$d(buf,' + vp + ',' + field.name + 'L)');
        lines.push(vp + '+=' + field.name + 'L');

        return;
    }

    if (type.kind === 'array') {
        let elem = type.element;

        lines.push('let ' + field.name + 'C=' + driver.readU16(vp));
        lines.push(vp + '+=2');
        lines.push('let ' + field.name + '=new Array(' + field.name + 'C)');

        if (typeof elem === 'string' && elem === 'mixed') {
            // Mixed-type array: each element has u32 length + SBC-tagged data
            lines.push('for(let j=0;j<' + field.name + 'C;j++){let el=' + driver.readU32(vp) + ';' + vp + '+=4;' + field.name + '[j]=$d(buf,' + vp + ',el);' + vp + '+=el}');
        }
        else if (typeof elem === 'object' && elem.kind === 'object') {
            // Array of objects: each element has u16 length + schema_id + fields
            lines.push('for(let j=0;j<' + field.name + 'C;j++){let el=' + driver.readU16(vp) + ';' + vp + '+=2;' + field.name + '[j]=$d(buf,' + vp + ',el);' + vp + '+=el}');
        }
        else if (typeof elem === 'string') {
            switch (elem) {
                case 'float64':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=' + driver.readF64(vp) + ';' + vp + '+=8}');
                    break;
                case 'int32':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=' + driver.readI32(vp) + ';' + vp + '+=4}');
                    break;
                case 'string':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){let l=' + driver.readU32(vp) + ';' + vp + '+=4;' + field.name + '[j]=' + driver.readUtf8(vp, vp + '+l') + ';' + vp + '+=l}');
                    break;
                case 'uint16':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=' + driver.readU16(vp) + ';' + vp + '+=2}');
                    break;
                case 'uint32':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=' + driver.readU32(vp) + ';' + vp + '+=4}');
                    break;
                case 'uint8':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + field.name + '[j]=buf[' + vp + '++]}');
                    break;
            }
        }

        return;
    }
}

function emitDecoderVarInner(lines: string[], name: string, type: FieldType, vp: string): void {
    if (typeof type === 'string') {
        switch (type) {
            case 'string':
                lines.push('let ' + name + 'L=' + driver.readU32(vp));
                lines.push(vp + '+=4');
                lines.push(name + '=' + driver.readUtf8(vp, vp + '+' + name + 'L'));
                lines.push(vp + '+=' + name + 'L');
                break;
            case 'uint8':
                lines.push(name + '=buf[' + vp + '++]');
                break;
            case 'uint32':
                lines.push(name + '=' + driver.readU32(vp));
                lines.push(vp + '+=4');
                break;
            case 'float64':
                lines.push(name + '=' + driver.readF64(vp));
                lines.push(vp + '+=8');
                break;
            case 'boolean':
                lines.push(name + '=!!buf[' + vp + '++]');
                break;
        }
    }
}

function emitEncoderFixed(lines: string[], field: FieldDef): void {
    let off = 'pos+' + field.offset;
    let val = 'obj.' + field.name;

    switch (field.type) {
        case 'bigint':
            lines.push(driver.writeBI64(off, val));
            break;
        case 'boolean':
            lines.push('buf[' + off + ']=' + val + '?1:0');
            break;
        case 'date':
            lines.push(driver.writeF64(off, val + '.getTime()'));
            break;
        case 'float64':
            lines.push(driver.writeF64(off, val));
            break;
        case 'int8':
            lines.push('buf[' + off + ']=(' + val + ')&0xFF');
            break;
        case 'int16':
            lines.push(driver.writeI16(off, val));
            break;
        case 'int32':
            lines.push(driver.writeI32(off, val));
            break;
        case 'uint8':
            lines.push('buf[' + off + ']=' + val);
            break;
        case 'uint16':
            lines.push(driver.writeU16(off, val));
            break;
        case 'uint32':
            lines.push(driver.writeU32(off, val));
            break;
    }
}

function emitEncoderVar(lines: string[], field: FieldDef, vp: string, internFields?: Set<string>): void {
    let type = field.type;
    let val = 'obj.' + field.name;

    if (typeof type === 'string') {
        switch (type) {
            case 'bytes':
                lines.push('let ' + field.name + 'L=' + val + '.length');
                lines.push(driver.writeU32(vp, field.name + 'L'));
                lines.push(vp + '+=4');
                lines.push('buf.set(' + val + ',' + vp + ')');
                lines.push(vp + '+=' + field.name + 'L');
                break;
            case 'string':
                if (internFields && internFields.has(field.name)) {
                    lines.push(vp + '=$si(\'' + field.name + '\',' + val + ',buf,' + vp + ')');
                }
                else if (isNode) {
                    // Write string first at vp+4, then patch length prefix (single encode pass)
                    lines.push('let ' + field.name + 'L=buf.utf8Write(' + val + ',' + vp + '+4)');
                    lines.push(driver.writeU32(vp, field.name + 'L'));
                    lines.push(vp + '+=4+' + field.name + 'L');
                }
                else {
                    lines.push('let ' + field.name + 'L=' + driver.byteLen(val));
                    lines.push(driver.writeU32(vp, field.name + 'L'));
                    lines.push(vp + '+=4');
                    lines.push(vp + '+=' + driver.writeUtf8(val, vp, field.name + 'L'));
                }
                break;
        }

        return;
    }

    if (type.kind === 'nullable') {
        // Write presence bit + inner value if non-null
        lines.push('if(' + val + '!=null){_bm|=' + (1 << field._nullIndex!) + ';');
        emitEncoderVarInner(lines, val, type.inner, vp);
        lines.push('}');

        return;
    }

    if (type.kind === 'object') {
        // Nested object: encode with $e, write u16 length prefix
        lines.push('let ' + field.name + 'S=' + vp);
        lines.push(vp + '+=2');
        lines.push(vp + '=$e(' + val + ',buf,' + vp + ')');
        lines.push(driver.writeU16(field.name + 'S', vp + '-' + field.name + 'S-2'));

        return;
    }

    if (type.kind === 'array') {
        let elem = type.element;

        lines.push('let ' + field.name + 'A=' + val);
        lines.push('let ' + field.name + 'C=' + field.name + 'A.length');
        lines.push(driver.writeU16(vp, field.name + 'C'));
        lines.push(vp + '+=2');

        if (typeof elem === 'string' && elem === 'mixed') {
            // Mixed-type array: each element gets u32 length + SBC-tagged data
            lines.push('for(let j=0;j<' + field.name + 'C;j++){let es=' + vp + ';' + vp + '+=4;' + vp + '=$e(' + field.name + 'A[j],buf,' + vp + ');' + driver.writeU32('es', vp + '-es-4') + '}');
        }
        else if (typeof elem === 'object' && elem.kind === 'object') {
            // Array of objects: each element gets u16 length + $e(element)
            lines.push('for(let j=0;j<' + field.name + 'C;j++){let es=' + vp + ';' + vp + '+=2;' + vp + '=$e(' + field.name + 'A[j],buf,' + vp + ');' + driver.writeU16('es', vp + '-es-2') + '}');
        }
        else if (typeof elem === 'string') {
            switch (elem) {
                case 'float64':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + driver.writeF64(vp, field.name + 'A[j]') + ';' + vp + '+=8}');
                    break;
                case 'int32':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + driver.writeI32(vp, field.name + 'A[j]') + ';' + vp + '+=4}');
                    break;
                case 'string':
                    if (isNode) {
                        lines.push('for(let j=0;j<' + field.name + 'C;j++){let l=buf.utf8Write(' + field.name + 'A[j],' + vp + '+4);' + driver.writeU32(vp, 'l') + ';' + vp + '+=4+l}');
                    }
                    else {
                        lines.push('for(let j=0;j<' + field.name + 'C;j++){let l=' + driver.byteLen(field.name + 'A[j]') + ';' + driver.writeU32(vp, 'l') + ';' + vp + '+=4;' + vp + '+=' + driver.writeUtf8(field.name + 'A[j]', vp, 'l') + '}');
                    }
                    break;
                case 'uint16':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + driver.writeU16(vp, field.name + 'A[j]') + ';' + vp + '+=2}');
                    break;
                case 'uint32':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){' + driver.writeU32(vp, field.name + 'A[j]') + ';' + vp + '+=4}');
                    break;
                case 'uint8':
                    lines.push('for(let j=0;j<' + field.name + 'C;j++){buf[' + vp + '++]=' + field.name + 'A[j]}');
                    break;
            }
        }

        return;
    }
}

function emitEncoderVarInner(lines: string[], val: string, type: FieldType, vp: string): void {
    if (typeof type === 'string') {
        switch (type) {
            case 'string':
                if (isNode) {
                    lines.push('let _nl=buf.utf8Write(' + val + ',' + vp + '+4)');
                    lines.push(driver.writeU32(vp, '_nl'));
                    lines.push(vp + '+=4+_nl');
                }
                else {
                    lines.push('let _nl=' + driver.byteLen(val));
                    lines.push(driver.writeU32(vp, '_nl'));
                    lines.push(vp + '+=4');
                    lines.push(vp + '+=' + driver.writeUtf8(val, vp, '_nl'));
                }
                break;
            case 'uint8':
                lines.push('buf[' + vp + '++]=' + val);
                break;
            case 'uint32':
                lines.push(driver.writeU32(vp, val));
                lines.push(vp + '+=4');
                break;
            case 'float64':
                lines.push(driver.writeF64(vp, val));
                lines.push(vp + '+=8');
                break;
            case 'boolean':
                lines.push('buf[' + vp + '++]=' + val + '?1:0');
                break;
        }
    }
}

function compileDecoder(schema: Schema, registry: SchemaRegistry, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, internFields?: Set<string>, internDecode?: (buf: Uint8Array, pos: number) => string): (buf: Uint8Array, pos: number) => unknown {
    let lines: string[] = [];
    let vp = 'vp';
    let hasNullable = schema.nullableCount > 0;

    let nullIndex = 0;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            (field as FieldDef & { _nullIndex?: number })._nullIndex = nullIndex++;
        }
    }

    let bitmapBytes = hasNullable ? Math.ceil(schema.nullableCount / 8) : 0;

    if (hasNullable) {
        lines.push('let _bm=buf[pos]');

        if (bitmapBytes > 1) {
            lines.push('_bm|=buf[pos+1]<<8');
        }

        lines.push('pos+=' + bitmapBytes);
    }

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            emitDecoderFixed(lines, field);
        }
    }

    let hasVar = false;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            continue;
        }

        if (!hasVar) {
            lines.push('let ' + vp + '=pos+' + schema.fixedSize);
            hasVar = true;
        }

        emitDecoderVar(lines, field, vp, internFields);
    }

    let allFields = schema.fields.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

    lines.push('return{' + allFields.map((f) => f.name).join(',') + '}');

    let preamble = driver.preamble('buf');

    if (preamble) {
        lines.unshift(preamble);
    }

    let body = lines.join(';');
    let $d = helpers?.decodeSbc ?? ((_buf: Uint8Array, _offset: number, _len: number) => null);

    if (internFields && internFields.size > 0 && internDecode) {
        return new Function('$d', '$sd', driver.decoderParams() + 'buf', 'pos', body).bind(null, $d, internDecode, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown;
    }

    return new Function('$d', driver.decoderParams() + 'buf', 'pos', body).bind(null, $d, ...driver.decoderBindArgs()) as (buf: Uint8Array, pos: number) => unknown;
}

function compileEncoder(schema: Schema, registry: SchemaRegistry, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, internFields?: Set<string>, internEncode?: (field: string, value: string, buf: Uint8Array, pos: number) => number): (obj: unknown, buf: Uint8Array, pos: number) => number {
    let lines: string[] = [];
    let vp = 'vp';
    let hasNullable = schema.nullableCount > 0;
    let nullIndex = 0;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (typeof field.type === 'object' && field.type.kind === 'nullable') {
            (field as FieldDef & { _nullIndex?: number })._nullIndex = nullIndex++;
        }
    }

    let bitmapBytes = hasNullable ? Math.ceil(schema.nullableCount / 8) : 0;

    if (hasNullable) {
        lines.push('let _bm=0');
        lines.push('let _bmPos=pos');
        lines.push('pos+=' + bitmapBytes);
    }

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            emitEncoderFixed(lines, field);
        }
    }

    let hasVar = false;

    for (let i = 0, n = schema.fields.length; i < n; i++) {
        let field = schema.fields[i]!;

        if (field.fixedSize > 0) {
            continue;
        }

        if (!hasVar) {
            lines.push('let ' + vp + '=pos+' + schema.fixedSize);
            hasVar = true;
        }

        emitEncoderVar(lines, field, vp, internFields);
    }

    if (hasNullable) {
        lines.push('buf[_bmPos]=_bm&0xFF');

        if (bitmapBytes > 1) {
            lines.push('buf[_bmPos+1]=(_bm>>8)&0xFF');
        }
    }

    lines.push('return ' + (hasVar ? vp : 'pos+' + schema.fixedSize));

    let preamble = driver.preamble('buf');

    if (preamble) {
        lines.unshift(preamble);
    }

    let body = lines.join(';');
    let $e = helpers?.encodeSbc ?? ((_value: unknown, buf: Uint8Array, pos: number) => { buf[pos] = 0; return pos + 1; });

    if (internFields && internFields.size > 0 && internEncode) {
        return new Function('$e', '$si', driver.encoderParams() + 'obj', 'buf', 'pos', body).bind(null, $e, internEncode, ...driver.encoderBindArgs()) as (obj: unknown, buf: Uint8Array, pos: number) => number;
    }

    return new Function('$e', driver.encoderParams() + 'obj', 'buf', 'pos', body).bind(null, $e, ...driver.encoderBindArgs()) as (obj: unknown, buf: Uint8Array, pos: number) => number;
}

function compileSchema(schema: Schema, registry?: SchemaRegistry, helpers?: { decodeSbc?: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc?: (value: unknown, buf: Uint8Array, pos: number) => number }, compression?: boolean, internFields?: Set<string>, internEncode?: (field: string, value: string, buf: Uint8Array, pos: number) => number, internDecode?: (buf: Uint8Array, pos: number) => string): void {
    let reg = registry || createRegistry();

    schema.decodeFn = compileDecoder(schema, reg, helpers, internFields, internDecode);
    schema.encodeFn = compileEncoder(schema, reg, helpers, internFields, internEncode);

    if (!compression && isSizeComputable(schema)) {
        schema.computeSize = buildComputeSize(schema, reg);
    }

    if (compression && schema.compressible) {
        schema.compressedDecodeFn = compileCompressedDecoder(schema, reg, helpers, internFields, internDecode);
        schema.compressedEncodeFn = compileCompressedEncoder(schema, reg, helpers, internFields, internEncode);
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
    }

    let fixedSize = offset;

    for (let i = 0, n = fields.length; i < n; i++) {
        let field = fields[i]!;

        if (field.fixedSize === 0) {
            field.offset = -1;
        }
    }

    return fixedSize;
}

function createRegistry(): SchemaRegistry {
    return {
        constructorCache: new WeakMap(),
        lastSchema: null,
        nextId: 1,
        schemas: new Map(),
        schemasByCount: new Map(),
        schemasByHash: new Map(),
    };
}

function fieldTypeSize(type: FieldType): number {
    if (typeof type === 'string') {
        return FIELD_SIZES[type] ?? 0;
    }

    return 0;
}

function fnv1a(str: string): number {
    let hash = 0x811c9dc5;

    for (let i = 0, n = str.length; i < n; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }

    return hash;
}

// Continue FNV-1a from a running hash state — feeds str char-by-char, no alloc
function fnv1aFeed(hash: number, str: string): number {
    for (let i = 0, n = str.length; i < n; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }

    return hash;
}

// Feed a single char code into FNV-1a
function fnv1aFeedChar(hash: number, ch: number): number {
    hash ^= ch;

    return (hash * 0x01000193) >>> 0;
}

function deserializeRegistry(data: unknown[]): SchemaRegistry {
    let registry = createRegistry();
    let maxId = 0;

    for (let i = 0, n = data.length; i < n; i++) {
        let def = data[i] as { fields: { fixedSize: number; name: string; type: string }[]; hash: number; id: number; nullableCount: number };
        let schema = buildSchemaFromDef(def);

        registry.schemas.set(schema.id, schema);
        registry.schemasByHash.set(schema.hash, schema);

        // Maintain field-count bucket map
        let count = schema.fields.length,
            bucket = registry.schemasByCount.get(count);

        if (bucket) {
            bucket.push(schema);
        }
        else {
            registry.schemasByCount.set(count, [schema]);
        }

        if (schema.id > maxId) {
            maxId = schema.id;
        }
    }

    registry.nextId = maxId + 1;

    // Set monomorphic state if exactly 1 schema
    if (registry.schemas.size === 1) {
        registry.lastSchema = registry.schemas.values().next().value as Schema;
    }

    return registry;
}

function inferFieldType(value: unknown): FieldType {
    if (value === null || value === undefined) {
        return { inner: 'uint8', kind: 'nullable' };
    }

    switch (typeof value) {
        case 'bigint':
            return 'bigint';
        case 'boolean':
            return 'boolean';
        case 'number':
            return 'float64';
        case 'object': {
            if (value instanceof Date) {
                return 'date';
            }

            if (value instanceof Uint8Array) {
                return 'bytes';
            }

            if (Array.isArray(value)) {
                if (value.length === 0) {
                    return { element: 'float64', kind: 'array' };
                }

                let elementType = inferFieldType(value[0]);
                let elementSerialized = serializeFieldType(elementType);

                // Check up to 10 elements for type consistency
                for (let i = 1, n = Math.min(value.length, 10); i < n; i++) {
                    if (serializeFieldType(inferFieldType(value[i])) !== elementSerialized) {
                        return { element: 'mixed' as FieldType, kind: 'array' };
                    }
                }

                return { element: elementType, kind: 'array' };
            }

            return { kind: 'object', schemaId: 0 };
        }
        case 'string':
            return 'string';
        default:
            return 'string';
    }
}

function inferSchema(obj: Record<string, unknown>, registry: SchemaRegistry): Schema {
    let keys = Object.keys(obj).sort();
    let hashParts: string[] = [];
    let fields: FieldDef[] = [];
    let nullableCount = 0;

    for (let i = 0, n = keys.length; i < n; i++) {
        let key = keys[i]!;
        let value = obj[key];

        // Skip undefined fields — treat as absent, not as a distinct schema shape
        if (value === undefined) {
            continue;
        }

        let type = inferFieldType(value);
        let size = fieldTypeSize(type);

        if (typeof type === 'object' && type.kind === 'nullable') {
            nullableCount++;
        }

        hashParts.push(key + ':' + serializeFieldType(type));
        fields.push({
            fixedSize: size,
            name: key,
            offset: 0,
            type,
        });
    }

    // Sort: fixed-size fields first (by name), then variable-size (by name)
    fields.sort((a, b) => {
        if (a.fixedSize > 0 && b.fixedSize === 0) {
            return -1;
        }

        if (a.fixedSize === 0 && b.fixedSize > 0) {
            return 1;
        }

        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    let fixedSize = computeFieldOffsets(fields);
    let hash = fnv1a(hashParts.join(','));

    return {
        compressedDecodeFn: null,
        compressedEncodeFn: null,
        compressible: isCompressible(fields),
        computeSize: null,
        decodeFn: null,
        encodeFn: null,
        fields,
        fixedSize,
        hash,
        id: registry.nextId,
        nullableCount,
    };
}

function parseFieldType(str: string): FieldType {
    if (str.startsWith('array<') && str.endsWith('>')) {
        return { element: parseFieldType(str.slice(6, -1)), kind: 'array' };
    }

    if (str.startsWith('nullable<') && str.endsWith('>')) {
        return { inner: parseFieldType(str.slice(9, -1)), kind: 'nullable' };
    }

    if (str.startsWith('object(') && str.endsWith(')')) {
        return { kind: 'object', schemaId: parseInt(str.slice(7, -1), 10) };
    }

    return str as FieldType;
}

// Verify all schema field names are defined in obj — N property lookups, no alloc
function verifySchemaFields(obj: Record<string, unknown>, schema: Schema): boolean {
    let fields = schema.fields;

    for (let i = 0, n = fields.length; i < n; i++) {
        if (obj[fields[i]!.name] === undefined) {
            return false;
        }
    }

    return true;
}

function registerSchema(schema: Schema, registry: SchemaRegistry): void {
    schema.id = registry.nextId++;
    registry.schemas.set(schema.id, schema);
    registry.schemasByHash.set(schema.hash, schema);

    // Maintain field-count bucket map
    let count = schema.fields.length,
        bucket = registry.schemasByCount.get(count);

    if (bucket) {
        bucket.push(schema);
    }
    else {
        registry.schemasByCount.set(count, [schema]);
    }

    // Maintain monomorphic state
    if (registry.schemas.size === 1) {
        registry.lastSchema = schema;
    }
    else {
        registry.lastSchema = null;
    }
}

function serializeFieldType(type: FieldType): string {
    if (typeof type === 'string') {
        return type;
    }

    if (type.kind === 'array') {
        return 'array<' + serializeFieldType(type.element) + '>';
    }

    if (type.kind === 'nullable') {
        return 'nullable<' + serializeFieldType(type.inner) + '>';
    }

    return 'object(' + type.schemaId + ')';
}

function serializeRegistry(registry: SchemaRegistry): unknown[] {
    let result: unknown[] = [];

    registry.schemas.forEach((schema) => {
        result.push({
            fields: schema.fields.map((f) => ({
                fixedSize: f.fixedSize,
                name: f.name,
                type: serializeFieldType(f.type),
            })),
            hash: schema.hash,
            id: schema.id,
            nullableCount: schema.nullableCount,
        });
    });

    return result;
}


let objShapeCount = 0,
    objShapeKeys: string[] = [];

// Computes defined field count from obj, caching sorted keys for lazy hash — no string alloc
function computeObjShapeCount(obj: Record<string, unknown>): void {
    let count = 0,
        keys = Object.keys(obj).sort();

    for (let i = 0, n = keys.length; i < n; i++) {
        if (obj[keys[i]!] !== undefined) {
            count++;
        }
    }

    objShapeCount = count;
    objShapeKeys = keys;
}

// Computes schema hash using cached sorted keys — zero string alloc, feeds FNV-1a directly.
// Produces identical hash to fnv1a(keys.map(k => k+':'+serializeFieldType(inferFieldType(obj[k]))).join(','))
function computeObjShapeHash(obj: Record<string, unknown>): number {
    let first = true,
        hash = 0x811c9dc5,
        keys = objShapeKeys;

    for (let i = 0, n = keys.length; i < n; i++) {
        let key = keys[i]!;

        if (obj[key] === undefined) {
            continue;
        }

        // Separator between fields (comma between key:type pairs)
        if (!first) {
            hash = fnv1aFeedChar(hash, 44); // ','
        }

        first = false;

        // Feed key name
        hash = fnv1aFeed(hash, key);

        // Feed ':' separator
        hash = fnv1aFeedChar(hash, 58); // ':'

        // Feed serialized type — serializeFieldType returns a string, feed it directly
        hash = fnv1aFeed(hash, serializeFieldType(inferFieldType(obj[key])));
    }

    return hash;
}

const lookupSchema = (obj: Record<string, unknown>, registry: SchemaRegistry): Schema | null => {
    // Tier 1: Constructor-keyed cache (non-plain objects only)
    let ctor = obj.constructor;

    if (ctor !== Object && ctor !== undefined) {
        let cached = registry.constructorCache.get(ctor);

        if (cached) {
            return cached;
        }
    }

    // Tier 2: Monomorphic fast path — single schema, verify via property lookups (no sort/join)
    if (registry.lastSchema !== null) {
        let schema = registry.lastSchema,
            fields = schema.fields,
            n = fields.length;

        // Verify all schema fields are defined in obj — N property lookups, no alloc
        let match = true;

        for (let i = 0; i < n; i++) {
            if (obj[fields[i]!.name] === undefined) {
                match = false;
                break;
            }
        }

        if (match) {
            // Verify no extra defined fields
            let keyCount = Object.keys(obj).length;

            if (keyCount === n) {
                if (ctor !== Object && ctor !== undefined) {
                    registry.constructorCache.set(ctor, schema);
                }

                return schema;
            }

            // Rare: obj may have explicit undefined-valued keys — count defined ones
            if (keyCount > n) {
                let defined = 0,
                    keys = Object.keys(obj);

                for (let i = 0, kn = keys.length; i < kn; i++) {
                    if (obj[keys[i]!] !== undefined) {
                        defined++;
                    }
                }

                if (defined === n) {
                    if (ctor !== Object && ctor !== undefined) {
                        registry.constructorCache.set(ctor, schema);
                    }

                    return schema;
                }
            }
        }

        // lastSchema non-null iff exactly 1 schema registered; mismatch = no match possible
        return null;
    }

    // Tier 3: Field-count prefilter — narrow candidates by defined field count
    computeObjShapeCount(obj);

    let bucket = registry.schemasByCount.get(objShapeCount);

    if (!bucket) {
        return null;
    }

    if (bucket.length === 1) {
        // Single candidate — verify field names match via direct property lookups (no string alloc)
        let schema = bucket[0]!;

        if (verifySchemaFields(obj, schema)) {
            if (ctor !== Object && ctor !== undefined) {
                registry.constructorCache.set(ctor, schema);
            }

            return schema;
        }

        return null;
    }

    // Multiple schemas with same field count — hash lookup using cached keys (no re-sort, no string alloc)
    let hash = computeObjShapeHash(obj),
        schema = registry.schemasByHash.get(hash) ?? null;

    if (schema && !verifySchemaFields(obj, schema)) {
        // FNV-1a collision — different field names, same hash
        return null;
    }

    if (schema && ctor !== Object && ctor !== undefined) {
        registry.constructorCache.set(ctor, schema);
    }

    return schema;
};

const resolveSchema = (obj: Record<string, unknown>, registry: SchemaRegistry): Schema => {
    let existing = lookupSchema(obj, registry);

    if (existing) {
        return existing;
    }

    let schema = inferSchema(obj, registry);

    registerSchema(schema, registry);

    // Populate constructor cache for the newly registered schema
    let ctor = obj.constructor;

    if (ctor !== Object && ctor !== undefined) {
        registry.constructorCache.set(ctor, schema);
    }

    return schema;
};


// Binary format for persisting schema field definitions:
// [fieldCount: uint16] then per field: [nameLen: uint16][name: utf8][typeLen: uint16][type: utf8]
function decodeFieldDefs(bytes: Uint8Array): { name: string; type: string }[] {
    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        count = view.getUint16(0, true),
        offset = 2,
        result: { name: string; type: string }[] = [];

    for (let i = 0; i < count; i++) {
        let nameLen = view.getUint16(offset, true);

        offset += 2;

        let name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLen));

        offset += nameLen;

        let typeLen = view.getUint16(offset, true);

        offset += 2;

        let type = new TextDecoder().decode(bytes.subarray(offset, offset + typeLen));

        offset += typeLen;
        result.push({ name, type });
    }

    return result;
}

function encodeFieldDefs(defs: { name: string; type: string }[]): Uint8Array {
    let encoder = new TextEncoder(),
        parts: Uint8Array[] = [],
        totalSize = 2; // fieldCount header

    for (let i = 0, n = defs.length; i < n; i++) {
        let def = defs[i]!,
            nameBytes = encoder.encode(def.name),
            typeBytes = encoder.encode(def.type);

        parts.push(nameBytes, typeBytes);
        totalSize += 4 + nameBytes.length + typeBytes.length; // 2 x uint16 + data
    }

    let result = new Uint8Array(totalSize),
        view = new DataView(result.buffer),
        offset = 0;

    view.setUint16(offset, defs.length, true);
    offset += 2;

    for (let i = 0, n = parts.length; i < n; i += 2) {
        let nameBytes = parts[i]!,
            typeBytes = parts[i + 1]!;

        view.setUint16(offset, nameBytes.length, true);
        offset += 2;
        result.set(nameBytes, offset);
        offset += nameBytes.length;

        view.setUint16(offset, typeBytes.length, true);
        offset += 2;
        result.set(typeBytes, offset);
        offset += typeBytes.length;
    }

    return result;
}


const createSchemaStore = (db: { getBinary(key: unknown): Uint8Array | undefined; putSync(key: unknown, value: unknown): boolean; transactionSync<T>(fn: () => T): T }, prefix?: string): SchemaStoreInterface => {
    let cache = new Map<number, Schema>(),
        helpers = {
            decodeSbc: null as unknown as (buf: Uint8Array, offset: number, len: number) => unknown,
            encodeSbc: null as unknown as (value: unknown, buf: Uint8Array, pos: number) => number,
        },
        internDecode = undefined as ((buf: Uint8Array, pos: number) => string) | undefined,
        internEncode = undefined as ((field: string, value: string, buf: Uint8Array, pos: number) => number) | undefined,
        internFields = undefined as Set<string> | undefined,
        keyPrefix = prefix ? prefix + ':' : '',
        reg = createRegistry();

    return {
        has(hash: number): boolean {
            return cache.has(hash);
        },

        get(hash: number): Schema | null {
            let cached = cache.get(hash);

            if (cached) {
                return cached;
            }

            // Fetch from schema DB — uses getBinary (copies buffer, no clobbering)
            let bytes: Uint8Array | undefined;

            try {
                bytes = db.getBinary((keyPrefix + hash) as unknown as never);
            }
            catch {
                return null;
            }

            if (!bytes) {
                return null;
            }

            let defs: { name: string; type: string }[];

            try {
                defs = decodeFieldDefs(bytes);
            }
            catch {
                return null;
            }

            // Build schema from persisted field definitions
            let fields: FieldDef[] = defs.map((d) => {
                let type = parseFieldType(d.type);

                return { fixedSize: fieldTypeSize(type), name: d.name, offset: 0, type };
            });

            fields.sort((a, b) => {
                if (a.fixedSize > 0 && b.fixedSize === 0) {
                    return -1;
                }

                if (a.fixedSize === 0 && b.fixedSize > 0) {
                    return 1;
                }

                return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
            });

            let fixedSize = computeFieldOffsets(fields);

            let schema: Schema = {
                compressedDecodeFn: null,
                compressedEncodeFn: null,
                compressible: isCompressible(fields),
                computeSize: null,
                decodeFn: null,
                encodeFn: null,
                fields,
                fixedSize,
                hash,
                id: reg.nextId,
                nullableCount: fields.filter((f) => typeof f.type === 'object' && f.type.kind === 'nullable').length,
            };

            registerSchema(schema, reg);
            compileSchema(schema, reg, helpers, false, internFields, internEncode, internDecode);
            cache.set(hash, schema);

            return schema;
        },

        register(hash: number, schema: Schema): void {
            cache.set(hash, schema);

            let encoded = encodeFieldDefs(schema.fields.map((f) => ({
                name: f.name,
                type: serializeFieldType(f.type),
            })));

            // Persist to schema DB. Use try/catch — may fail if called during
            // nested transactionSync (encode within user's transactionSync).
            // Schema DB is a separate DBI so transactionSync is safe from the
            // main thread outside write transactions.
            try {
                db.transactionSync(() => {
                    db.putSync((keyPrefix + hash) as unknown as never, encoded as unknown as never);
                });
            }
            catch {
                // If sync fails (nested txn), defer via microtask
                queueMicrotask(() => {
                    try {
                        db.transactionSync(() => {
                            db.putSync((keyPrefix + hash) as unknown as never, encoded as unknown as never);
                        });
                    }
                    catch {
                        // Ignore — DB may be closing
                    }
                });
            }
        },

        // Called by createCodec to wire up the decode/encode helpers after creation
        _setHelpers(h: typeof helpers) {
            helpers.decodeSbc = h.decodeSbc;
            helpers.encodeSbc = h.encodeSbc;
        },

        _setIntern(pool: InternPool) {
            internDecode = pool.decode;
            internEncode = pool.encode;
            internFields = pool.fields;
        },
    } as SchemaStoreInterface & { _setHelpers(h: { decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number }): void; _setIntern(pool: InternPool): void };
};


interface InternPool {
    decode: (buf: Uint8Array, pos: number) => string;
    encode: (field: string, value: string, buf: Uint8Array, pos: number) => number;
    fields: Set<string>;
    load: () => void;
}

interface InternDb {
    getBinary(key: unknown): Uint8Array | undefined;
    getRange(options?: { start?: unknown }): Iterable<{ key: unknown; value: unknown }>;
    putSync(key: unknown, value: unknown): boolean;
    transactionSync<T>(fn: () => T): T;
}

const createInternPool = (db: InternDb, fieldNames: string[], prefix?: string): InternPool => {
    let fields = new Set(fieldNames),
        idToString = new Map<number, string>(),
        keyPrefix = prefix ? prefix + ':' : '',
        nextId = 1,
        stringToId = new Map<string, number>();

    function internString(value: string): number {
        let id = stringToId.get(value);

        if (id !== undefined) {
            return id;
        }

        id = nextId++;
        idToString.set(id, value);
        stringToId.set(value, id);

        let encoded = fromUtf8(value);

        try {
            db.transactionSync(() => {
                db.putSync((keyPrefix + id) as unknown as never, encoded as unknown as never);
            });
        }
        catch {
            queueMicrotask(() => {
                try {
                    db.transactionSync(() => {
                        db.putSync((keyPrefix + id) as unknown as never, encoded as unknown as never);
                    });
                }
                catch {
                    // Ignore — DB may be closing
                }
            });
        }

        return id;
    }

    return {
        fields,

        encode(_field: string, value: string, buf: Uint8Array, pos: number): number {
            let bLen = byteLen(value);

            if (bLen < 5) {
                writeU32.call(buf, bLen, pos);
                pos += 4;
                pos += writeUtf8.call(buf, value, pos, bLen);

                return pos;
            }

            let id = internString(value);

            writeU32.call(buf, 0xFFFFFFFF, pos);
            writeU32.call(buf, id, pos + 4);

            return pos + 8;
        },

        decode(buf: Uint8Array, pos: number): string {
            let id = readU32.call(buf, pos);
            let cached = idToString.get(id);

            if (cached !== undefined) {
                return cached;
            }

            // Fallback: read from DB
            let bytes: Uint8Array | undefined;

            try {
                bytes = db.getBinary((keyPrefix + id) as unknown as never);
            }
            catch {
                return '';
            }

            if (!bytes) {
                return '';
            }

            let str = toUtf8(bytes);

            idToString.set(id, str);
            stringToId.set(str, id);

            return str;
        },

        load(): void {
            let maxId = 0;

            try {
                for (let entry of db.getRange({ start: keyPrefix as unknown as never })) {
                    let k = String(entry.key);

                    if (!k.startsWith(keyPrefix)) {
                        break;
                    }

                    let idStr = k.slice(keyPrefix.length);
                    let id = parseInt(idStr, 10);

                    if (isNaN(id)) {
                        continue;
                    }

                    let str = toUtf8(entry.value as Uint8Array);

                    idToString.set(id, str);
                    stringToId.set(str, id);

                    if (id > maxId) {
                        maxId = id;
                    }
                }
            }
            catch {
                // DB may not have entries yet
            }

            nextId = maxId + 1;
        },
    };
};



const createCodec = (schemaStore?: SchemaStoreInterface, options?: { compression?: boolean }, internPool?: InternPool): { decode(buffer: Uint8Array, length?: number): unknown; decodeAt(buffer: Uint8Array, offset: number): unknown; encode(value: unknown): Uint8Array } => {
    let compression = options?.compression ?? false,
        encodeBuf = allocBuf(65536),
        registry = createRegistry(),
        sbcHelpers = {
            decodeSbc: (buf: Uint8Array, offset: number, len: number): unknown => decodeSbc(buf, offset, len),
            encodeSbc: (value: unknown, buf: Uint8Array, pos: number): number => encodeSbc(value, buf, pos),
        };

    let internDecode = internPool?.decode,
        internEncode = internPool?.encode,
        internFieldSet = internPool?.fields;

    // Wire helpers into schema store so compiled decoders can call decodeSbc/encodeSbc
    if (schemaStore && (schemaStore as unknown as { _setHelpers?: unknown })._setHelpers) {
        (schemaStore as unknown as { _setHelpers(h: typeof sbcHelpers): void })._setHelpers(sbcHelpers);
    }

    // Wire intern pool into schema store so schemas loaded from DB get intern-aware compile
    if (schemaStore && internPool && (schemaStore as unknown as { _setIntern?: unknown })._setIntern) {
        (schemaStore as unknown as { _setIntern(pool: InternPool): void })._setIntern(internPool);
    }

    // Tag table:
    // 0 = null, 246 = hash-referenced object, 248 = bigint,
    // 249 = array, 250 = date, 251 = boolean, 252 = number,
    // 253 = string, 254 = bytes (Uint8Array)

    function decodeSbc(buf: Uint8Array, offset: number, len: number): unknown {
        if (len === 0) {
            return undefined;
        }

        let tag = buf[offset]!;

        switch (tag) {
            case 0:
                return null;

            case 248:
                return readBI64.call(buf, offset + 1);

            case 249: {
                let count = readU16.call(buf, offset + 1);
                let arr = new Array(count);
                let p = offset + 3;

                for (let i = 0; i < count; i++) {
                    let elemTag = buf[p]!;
                    let elemEnd = decodeTagEnd(buf, p, elemTag);

                    arr[i] = decodeSbc(buf, p, elemEnd - p);
                    p = elemEnd;
                }

                return arr;
            }

            case 250:
                return new Date(readF64.call(buf, offset + 1));

            case 251:
                return !!buf[offset + 1];

            case 252:
                return readF64.call(buf, offset + 1);

            case 253: {
                let sLen = readU32.call(buf, offset + 1);

                return readUtf8.call(buf, offset + 5, offset + 5 + sLen);
            }

            case 254: {
                let bLen = readU32.call(buf, offset + 1);
                let slice = buf.subarray(offset + 5, offset + 5 + bLen);

                if (isNode) {
                    return Buffer.from(slice);
                }

                return new Uint8Array(slice);
            }

            case 245: {
                // Compressed hash-referenced object: [245][u32 hash][u32 len][compressed_field_values...]
                let hash = readU32.call(buf, offset + 1);
                let schema = schemaStore ? schemaStore.get(hash) : registry.schemasByHash.get(hash);

                if (!schema) {
                    return null;
                }

                if (schema.compressedDecodeFn) {
                    return schema.compressedDecodeFn(buf, offset + 9);
                }

                // Compressed data but no compressed decoder compiled — compile on demand
                if (schema.compressible && !schema.compressedDecodeFn) {
                    schema.compressedDecodeFn = compileCompressedDecoder(schema, registry, sbcHelpers, internFieldSet, internDecode);
                    schema.compressedEncodeFn = compileCompressedEncoder(schema, registry, sbcHelpers, internFieldSet, internEncode);

                    return schema.compressedDecodeFn(buf, offset + 9);
                }

                return null;
            }

            case 246: {
                // Hash-referenced object: [246][u32 hash][u32 len][field_values...]
                let hash = readU32.call(buf, offset + 1);
                let schema = schemaStore ? schemaStore.get(hash) : registry.schemasByHash.get(hash);

                if (!schema || !schema.decodeFn) {
                    return null;
                }

                return schema.decodeFn(buf, offset + 9);
            }

            default:
                return null;
        }
    }

    function decodeTagEnd(buf: Uint8Array, offset: number, tag: number): number {
        switch (tag) {
            case 0: return offset + 1;
            case 245: return offset + 9 + readU32.call(buf, offset + 5);
            case 248: return offset + 9;
            case 250: return offset + 9;
            case 251: return offset + 2;
            case 252: return offset + 9;
            case 253: return offset + 5 + readU32.call(buf, offset + 1);
            case 254: return offset + 5 + readU32.call(buf, offset + 1);
            case 246: return offset + 9 + readU32.call(buf, offset + 5);
            case 249: {
                let count = readU16.call(buf, offset + 1);
                let p = offset + 3;

                for (let i = 0; i < count; i++) {
                    p = decodeTagEnd(buf, p, buf[p]!);
                }

                return p;
            }
            default: {
                // Schema object with u32 length prefix: [tag(1)][u32 len(4)][fields...]
                return offset + 5 + readU32.call(buf, offset + 1);
            }
        }
    }

    function encodeSbc(value: unknown, buf: Uint8Array, pos: number): number {
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

            case 'number':
                buf[pos] = 252;
                writeF64.call(buf, value, pos + 1);

                return pos + 9;

            case 'string': {
                buf[pos] = 253;

                let sLen = byteLen(value);

                writeU32.call(buf, sLen, pos + 1);
                writeUtf8.call(buf, value, pos + 5, sLen);

                return pos + 5 + sLen;
            }

            case 'object': {
                if (value instanceof Date) {
                    buf[pos] = 250;
                    writeF64.call(buf, value.getTime(), pos + 1);

                    return pos + 9;
                }

                // Typed arrays (Float32Array, Int16Array, etc.) — encode with typed-array-codec header
                // The get() path checks for TYPED_ARRAY_MAGIC before calling SBC decode
                if (ArrayBuffer.isView(value) && !(value instanceof DataView) && getTypedArrayType(value as Parameters<typeof getTypedArrayType>[0]) !== -1) {
                    let encoded = encodeTypedArray(value as Parameters<typeof encodeTypedArray>[0]);

                    buf.set(encoded, pos);

                    return pos + encoded.length;
                }

                if (value instanceof Uint8Array) {
                    buf[pos] = 254;
                    writeU32.call(buf, value.length, pos + 1);
                    buf.set(value, pos + 5);

                    return pos + 5 + value.length;
                }

                if (Array.isArray(value)) {
                    buf[pos] = 249;
                    writeU16.call(buf, value.length, pos + 1);

                    let p = pos + 3;

                    for (let i = 0, n = value.length; i < n; i++) {
                        p = encodeSbc(value[i], buf, p);
                    }

                    return p;
                }

                // Map → encode as array of [key, value] pairs (preserves all key types)
                if (value instanceof Map) {
                    let entries = Array.from(value as Map<unknown, unknown>);

                    buf[pos] = 249;
                    writeU16.call(buf, entries.length, pos + 1);

                    let p = pos + 3;

                    for (let i = 0, n = entries.length; i < n; i++) {
                        // Each entry as a 2-element array [key, value]
                        buf[p] = 249;
                        writeU16.call(buf, 2, p + 1);
                        p += 3;
                        p = encodeSbc(entries[i]![0], buf, p);
                        p = encodeSbc(entries[i]![1], buf, p);
                    }

                    return p;
                }

                // Set → encode as array
                if (value instanceof Set) {
                    let arr = Array.from(value as Set<unknown>);

                    buf[pos] = 249;
                    writeU16.call(buf, arr.length, pos + 1);

                    let p = pos + 3;

                    for (let i = 0, n = arr.length; i < n; i++) {
                        p = encodeSbc(arr[i], buf, p);
                    }

                    return p;
                }

                // Plain object — hash-referenced (tag 246)
                // Wire: [246][u32 hash][u32 len][field_values...]
                let obj = value as Record<string, unknown>;
                let schema = lookupSchema(obj, registry);

                if (!schema) {
                    schema = inferSchema(obj, registry);
                    registerSchema(schema, registry);
                    compileSchema(schema, registry, sbcHelpers, compression, internFieldSet, internEncode, internDecode);

                    if (schemaStore) {
                        schemaStore.register(schema.hash, schema);
                    }
                }

                // Use compressed path if available
                if (compression && schema.compressedEncodeFn) {
                    buf[pos] = 245;
                    writeU32.call(buf, schema.hash, pos + 1);

                    let end = schema.compressedEncodeFn(obj, buf, pos + 9);

                    writeU32.call(buf, end - pos - 9, pos + 5);

                    return end;
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
        // Fast path: schema-compiled object with known size (non-compressed only)
        if (!compression && value !== null && value !== undefined && typeof value === 'object'
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

        // Slow path: primitives, nested objects, compressed, unknown schema
        let end: number;

        try {
            end = encodeSbc(value, encodeBuf, 0);
        }
        catch {
            encodeBuf = allocBuf(encodeBuf.length * 2);
            end = encodeSbc(value, encodeBuf, 0);

            while (end > encodeBuf.length) {
                encodeBuf = allocBuf(end * 2);
                end = encodeSbc(value, encodeBuf, 0);
            }
        }

        if (end > encodeBuf.length) {
            encodeBuf = allocBuf(end * 2);
            end = encodeSbc(value, encodeBuf, 0);
        }

        let result = allocUnsafe(end);

        copyBuf(encodeBuf, result, 0, 0, end);

        return result;
    }

    return {
        decode(buffer: Uint8Array, length?: number): unknown {
            let len = length ?? buffer.length;

            if (len >= 9 && (buffer[0] === 245 || buffer[0] === 246)) {
                let hash = (buffer[1]! | (buffer[2]! << 8) | (buffer[3]! << 16) | (buffer[4]! << 24)) >>> 0;

                if (schemaStore) {
                    if (schemaStore.has(hash)) {
                        let schema = schemaStore.get(hash);

                        if (schema) {
                            if (buffer[0] === 245 && schema.compressedDecodeFn) {
                                return schema.compressedDecodeFn(buffer, 9);
                            }

                            if (schema.decodeFn) {
                                return schema.decodeFn(buffer, 9);
                            }
                        }
                    }
                }
                else {
                    // Standalone codec — no buffer clobbering risk
                    let schema = registry.schemasByHash.get(hash);

                    if (schema) {
                        if (buffer[0] === 245 && schema.compressedDecodeFn) {
                            return schema.compressedDecodeFn(buffer, 9);
                        }

                        if (schema.decodeFn) {
                            return schema.decodeFn(buffer, 9);
                        }
                    }
                }
            }

            if (len > 0 && buffer[0] !== 245 && buffer[0] !== 246) {
                // Primitive — no schema involvement, no clobbering risk
                return decodeSbc(buffer, 0, len);
            }

            // Slow path: schema not in cache, need DB lookup (may clobber buffer)
            let buf = allocUnsafe(len);

            if (isNode) {
                (buffer instanceof Buffer ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, len)).copy(buf as Buffer, 0, 0, len);
            }
            else {
                buf.set(buffer.subarray(0, len));
            }

            return decodeSbc(buf, 0, len);
        },

        decodeAt(buffer: Uint8Array, offset: number): unknown {
            return decodeSbc(buffer, offset, buffer.length - offset);
        },

        encode: encodeValue,
    };
};


export { compileSchema, createCodec, createInternPool, createRegistry, createSchemaStore, deserializeRegistry, inferFieldType, inferSchema, lookupSchema, parseFieldType, registerSchema, resolveSchema, serializeFieldType, serializeRegistry };
export type { ArrayFieldType, FieldDef, FieldType, InternPool, NullableFieldType, ObjectFieldType, Schema, SchemaRegistry, SchemaStoreInterface };
