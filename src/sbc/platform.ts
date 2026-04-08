// Schema Binary Codec — Platform abstraction
// Buffer/DataView decided once at module load, no branching per call.


// Node.js Buffer internal methods not on public TS typings
interface BufferInternal extends Uint8Array {
    utf8Slice(start: number, end: number): string;
    utf8Write(str: string, off: number, len: number): number;
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
    fieldExtractors: Map<string, (buf: Uint8Array, pos: number) => unknown> | null;
    fields: FieldDef[];
    fieldsSorted: FieldDef[] | null;
    fixedSize: number;
    hash: number;
    id: number;
    nullIndexMap: Map<string, number> | null;
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

interface SchemaStoreInterface {
    _setHelpers?(h: { decodeSbc: (buf: Uint8Array, offset: number, len: number) => unknown; encodeSbc: (value: unknown, buf: Uint8Array, pos: number) => number }): void;
    _setIntern?(pool: InternPool): void;
    get(hash: number): Schema | null;
    getCached(hash: number): Schema | null;
    has(hash: number): boolean;
    register(hash: number, schema: Schema): void;
}

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

let isNode = typeof Buffer !== 'undefined',
    textDecoder = new TextDecoder(),
    textEncoder = new TextEncoder(),
    varintResult = { pos: 0, value: 0 };

// Short-string ASCII fast path — avoids C++/JS boundary for pure ASCII strings <= 8 bytes.
// String.fromCharCode is 3-4x faster than utf8Slice/TextDecoder for short ASCII (msgpackr technique).
function readShortStrAscii(buf: Uint8Array, start: number, end: number): string | null {
    let len = end - start;

    if (len <= 8) {
        let ascii = true;

        for (let i = start; i < end; i++) {
            if (buf[i]! > 127) {
                ascii = false;
                break;
            }
        }

        if (ascii) {
            switch (len) {
                case 0: return '';
                case 1: return String.fromCharCode(buf[start]!);
                case 2: return String.fromCharCode(buf[start]!, buf[start + 1]!);
                case 3: return String.fromCharCode(buf[start]!, buf[start + 1]!, buf[start + 2]!);
                case 4: return String.fromCharCode(buf[start]!, buf[start + 1]!, buf[start + 2]!, buf[start + 3]!);
                default: {
                    let s = '';

                    for (let i = start; i < end; i++) {
                        s += String.fromCharCode(buf[i]!);
                    }

                    return s;
                }
            }
        }
    }

    return null;
}

let readShortStr: (buf: Uint8Array, start: number, end: number) => string = isNode
    ? (buf, start, end) => readShortStrAscii(buf, start, end) ?? (buf as BufferInternal).utf8Slice(start, end)
    : (buf, start, end) => readShortStrAscii(buf, start, end) ?? textDecoder.decode(buf.subarray(start, end));


let allocBuf: (n: number) => Uint8Array = isNode
    ? Buffer.alloc.bind(Buffer) as (n: number) => Uint8Array
    : (n) => new Uint8Array(n);

// WARNING: Returns uninitialized memory on Node.js (Buffer.allocUnsafe).
// Browser path zero-fills (new Uint8Array). Callers MUST write all bytes before reading.
let allocUnsafe: (n: number) => Uint8Array = isNode
    ? Buffer.allocUnsafe.bind(Buffer) as (n: number) => Uint8Array
    : (n) => new Uint8Array(n);

let byteLen: (str: string) => number = isNode
    ? Buffer.byteLength.bind(Buffer) as (str: string) => number
    : (str) => {
        let len = 0;

        for (let i = 0, n = str.length; i < n; i++) {
            let c = str.charCodeAt(i);

            if (c < 0x80) {
                len++;
            }
            else if (c < 0x800) {
                len += 2;
            }
            else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < n) {
                len += 4;
                i++;
            }
            else {
                len += 3;
            }
        }

        return len;
    };

let copyBuf: (src: Uint8Array, dst: Uint8Array, dstOffset: number, srcStart: number, srcEnd: number) => void = isNode
    ? (src, dst, dstOffset, srcStart, srcEnd) => (src as Buffer).copy(dst as Buffer, dstOffset, srcStart, srcEnd)
    : (src, dst, dstOffset, srcStart, srcEnd) => dst.set(src.subarray(srcStart, srcEnd), dstOffset);

let fromUtf8: (str: string) => Uint8Array = isNode
    ? (str) => Buffer.from(str, 'utf8')
    : (str) => textEncoder.encode(str);

// Instance methods — use .call(buf, ...) at call sites. No wrappers.
// Reads: readF64.call(buf, off). Writes: writeF64.call(buf, val, off).
// Browser path caches DataView per ArrayBuffer to avoid per-field allocation.
let dvCache: WeakMap<ArrayBuffer, DataView>;

function getDv(buf: Uint8Array): DataView {
    let ab = buf.buffer as ArrayBuffer,
        dv = dvCache.get(ab);

    if (!dv || dv.byteLength !== ab.byteLength) {
        dv = new DataView(ab);
        dvCache.set(ab, dv);
    }

    return dv;
}

if (!isNode) {
    dvCache = new WeakMap();
}

let readBI64: ((off: number) => bigint) = isNode
    ? Buffer.prototype.readBigInt64LE
    : function (this: Uint8Array, off: number) { return getDv(this).getBigInt64(this.byteOffset + off, true); };

let readF64: ((off: number) => number) = isNode
    ? Buffer.prototype.readDoubleLE
    : function (this: Uint8Array, off: number) { return getDv(this).getFloat64(this.byteOffset + off, true); };

let readU16: ((off: number) => number) = isNode
    ? Buffer.prototype.readUInt16LE
    : function (this: Uint8Array, off: number) { return getDv(this).getUint16(this.byteOffset + off, true); };

let readU32: ((off: number) => number) = isNode
    ? Buffer.prototype.readUInt32LE
    : function (this: Uint8Array, off: number) { return getDv(this).getUint32(this.byteOffset + off, true); };

let readUtf8: ((start: number, end: number) => string) = isNode
    ? (Buffer.prototype as BufferInternal).utf8Slice
    : function (this: Uint8Array, start: number, end: number) { return textDecoder.decode(this.subarray(start, end)); };

let toUtf8: (buf: Uint8Array) => string = isNode
    ? (buf) => Buffer.from(buf).toString('utf8')
    : (buf) => textDecoder.decode(buf);

let writeBI64: ((val: bigint, off: number) => void) = isNode
    ? Buffer.prototype.writeBigInt64LE as unknown as (val: bigint, off: number) => void
    : function (this: Uint8Array, val: bigint, off: number) { getDv(this).setBigInt64(this.byteOffset + off, val, true); };

let writeF64: ((val: number, off: number) => void) = isNode
    ? Buffer.prototype.writeDoubleLE as unknown as (val: number, off: number) => void
    : function (this: Uint8Array, val: number, off: number) { getDv(this).setFloat64(this.byteOffset + off, val, true); };

let writeU16: ((val: number, off: number) => void) = isNode
    ? Buffer.prototype.writeUInt16LE as unknown as (val: number, off: number) => void
    : function (this: Uint8Array, val: number, off: number) { getDv(this).setUint16(this.byteOffset + off, val, true); };

let writeU32: ((val: number, off: number) => void) = isNode
    ? Buffer.prototype.writeUInt32LE as unknown as (val: number, off: number) => void
    : function (this: Uint8Array, val: number, off: number) { getDv(this).setUint32(this.byteOffset + off, val, true); };

let writeUtf8: ((str: string, off: number, len: number) => number) = isNode
    ? (Buffer.prototype as BufferInternal).utf8Write
    : function (this: Uint8Array, str: string, off: number, len: number) { return textEncoder.encodeInto(str, this.subarray(off, off + len)).written!; };


// Codegen string factories — Node emits buf.XXX(), browser emits _v.XXX(,true)
function mkRead(node: string, browser: string): (off: string) => string {
    if (isNode) {
        return (off) => 'buf.' + node + '(' + off + ')';
    }

    return (off) => '_v.' + browser + '(' + off + ',true)';
}

function mkWrite(node: string, browser: string): (off: string, val: string) => string {
    if (isNode) {
        return (off, val) => 'buf.' + node + '(' + val + ',' + off + ')';
    }

    return (off, val) => '_v.' + browser + '(' + off + ',' + val + ',true)';
}

let browserUtf8Write = (buf: Uint8Array, str: string, off: number, len: number): number =>
    textEncoder.encodeInto(str, buf.subarray(off, off + len)).written!;

let driver: CodegenDriver = {
    byteLen: isNode ? (str) => 'Buffer.byteLength(' + str + ')' : (str) => '$byteLen(' + str + ')',
    decoderBindArgs: () => [readShortStr],
    decoderParams: isNode ? () => '$rs,' : () => '$rs,',
    encoderBindArgs: isNode ? () => [] : () => [byteLen, browserUtf8Write],
    encoderParams: isNode ? () => '' : () => '$byteLen,$utf8w,',
    preamble: isNode ? () => '' : (buf) => 'let _v=new DataView(' + buf + '.buffer,' + buf + '.byteOffset,' + buf + '.byteLength)',
    readBI64: mkRead('readBigInt64LE', 'getBigInt64'),
    readF64: mkRead('readDoubleLE', 'getFloat64'),
    readI16: mkRead('readInt16LE', 'getInt16'),
    readI32: mkRead('readInt32LE', 'getInt32'),
    readU16: mkRead('readUInt16LE', 'getUint16'),
    readU32: mkRead('readUInt32LE', 'getUint32'),
    readUtf8: (start, end) => '$rs(buf,' + start + ',' + end + ')',
    writeBI64: mkWrite('writeBigInt64LE', 'setBigInt64'),
    writeF64: mkWrite('writeDoubleLE', 'setFloat64'),
    writeI16: mkWrite('writeInt16LE', 'setInt16'),
    writeI32: mkWrite('writeInt32LE', 'setInt32'),
    writeU16: mkWrite('writeUInt16LE', 'setUint16'),
    writeU32: mkWrite('writeUInt32LE', 'setUint32'),
    writeUtf8: isNode ? (str, off, len) => 'buf.utf8Write(' + str + ',' + off + ',' + len + ')' : (str, off, len) => '$utf8w(' + str + ',' + off + ',' + len + ')',
};


function readVarint(buf: Uint8Array, pos: number, end?: number): void {
    let bufEnd = end ?? buf.length;

    if (pos >= bufEnd) {
        throw new RangeError('SBC: varint extends beyond buffer');
    }

    let byte = buf[pos]!,
        result = byte & 0x7F,
        shift = 7;

    while (byte & 0x80) {
        if (++pos >= bufEnd) {
            throw new RangeError('SBC: varint extends beyond buffer');
        }

        if (shift >= 35) {
            throw new RangeError('SBC: varint exceeds 32-bit range');
        }

        byte = buf[pos]!;
        result |= (byte & 0x7F) << shift;
        shift += 7;
    }

    varintResult.pos = pos + 1;
    varintResult.value = result >>> 0;
}

function readZigzag(buf: Uint8Array, pos: number): void {
    readVarint(buf, pos);
    let v = varintResult.value;

    varintResult.value = (v >>> 1) ^ -(v & 1);
}

function writeVarint(buf: Uint8Array, pos: number, value: number): number {
    value = value >>> 0;

    while (value > 0x7F) {
        if (pos >= buf.length) {
            throw new RangeError('SBC: writeVarint exceeded buffer bounds');
        }

        buf[pos++] = (value & 0x7F) | 0x80;
        value >>>= 7;
    }

    if (pos >= buf.length) {
        throw new RangeError('SBC: writeVarint exceeded buffer bounds');
    }

    buf[pos++] = value;

    return pos;
}

function writeZigzag(buf: Uint8Array, pos: number, value: number): number {
    if (value < -2147483648 || value > 2147483647) {
        throw new RangeError('SBC: int32 out of range');
    }

    return writeVarint(buf, pos, (value << 1) ^ (value >> 31));
}


// Public API: shared I/O primitives used by index.ts, registry.ts, and codegen.ts
export { allocBuf, allocUnsafe, byteLen, copyBuf, FIELD_SIZES, fromUtf8, isNode, readBI64, readF64, readU16, readU32, readUtf8, readVarint, readZigzag, toUtf8, varintResult, writeBI64, writeF64, writeU16, writeU32, writeUtf8, writeVarint, writeZigzag };
// Internal: only consumed by codegen.ts and registry.ts — not part of the public sbc API
export { driver, readShortStr, textDecoder, textEncoder };
export type { ArrayFieldType, CodegenDriver, FieldDef, FieldType, InternDb, InternPool, NullableFieldType, ObjectFieldType, Schema, SchemaRegistry, SchemaStoreInterface };
