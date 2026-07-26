// Codec2 Platform — Buffer/DataView decided once at module load
// Node.js: direct Buffer methods; Browser: cached DataView


interface BufferInternal extends Uint8Array {
    utf8Slice(start: number, end: number): string;
    utf8Write(str: string, off: number, len: number): number;
}


let isNode = typeof Buffer !== 'undefined',
    textDecoder = new TextDecoder(),
    textEncoder = new TextEncoder();


// Short-string ASCII fast path — 3-4x faster than utf8Slice/TextDecoder for pure ASCII ≤ 16 bytes
function readShortStrAscii(buf: Uint8Array, start: number, len: number): string | null {
    if (len > 16) {
        return null;
    }

    for (let i = start, e = start + len; i < e; i++) {
        if (buf[i]! > 127) {
            return null;
        }
    }

    let s = start;

    switch (len) {
        case 0: return '';
        case 1: return String.fromCharCode(buf[s]!);
        case 2: return String.fromCharCode(buf[s]!, buf[s + 1]!);
        case 3: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!);
        case 4: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!);
        case 5: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!);
        case 6: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!);
        case 7: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!);
        case 8: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!, buf[s + 7]!);
        case 9: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!, buf[s + 7]!, buf[s + 8]!);
        case 10: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!, buf[s + 7]!, buf[s + 8]!, buf[s + 9]!);
        case 11: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!, buf[s + 7]!, buf[s + 8]!, buf[s + 9]!, buf[s + 10]!);
        case 12: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!, buf[s + 7]!, buf[s + 8]!, buf[s + 9]!, buf[s + 10]!, buf[s + 11]!);
        case 13: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!, buf[s + 7]!, buf[s + 8]!, buf[s + 9]!, buf[s + 10]!, buf[s + 11]!, buf[s + 12]!);
        case 14: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!, buf[s + 7]!, buf[s + 8]!, buf[s + 9]!, buf[s + 10]!, buf[s + 11]!, buf[s + 12]!, buf[s + 13]!);
        case 15: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!, buf[s + 7]!, buf[s + 8]!, buf[s + 9]!, buf[s + 10]!, buf[s + 11]!, buf[s + 12]!, buf[s + 13]!, buf[s + 14]!);
        default: return String.fromCharCode(buf[s]!, buf[s + 1]!, buf[s + 2]!, buf[s + 3]!, buf[s + 4]!, buf[s + 5]!, buf[s + 6]!, buf[s + 7]!, buf[s + 8]!, buf[s + 9]!, buf[s + 10]!, buf[s + 11]!, buf[s + 12]!, buf[s + 13]!, buf[s + 14]!, buf[s + 15]!);
    }
}


// Browser dual-path implementations — named module-level so they stay directly
// importable (via `browser` below) and testable under the Node test environment,
// while the isNode ternaries pick the hot-path binding once at module load.
function browserAllocBuf(n: number): Uint8Array {
    return new Uint8Array(n);
}

function browserByteLen(str: string): number {
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
}

function browserCopyBuf(src: Uint8Array, dst: Uint8Array, dstOff: number, srcStart: number, srcEnd: number): void {
    dst.set(src.subarray(srcStart, srcEnd), dstOff);
}

function browserReadStr(buf: Uint8Array, start: number, len: number): string {
    return readShortStrAscii(buf, start, len) ?? textDecoder.decode(buf.subarray(start, start + len));
}


let readStr: (buf: Uint8Array, start: number, len: number) => string = isNode
    ? (buf, start, len) => readShortStrAscii(buf, start, len) ?? (buf as BufferInternal).utf8Slice(start, start + len)
    : browserReadStr;


let allocBuf: (n: number) => Uint8Array = isNode
    ? Buffer.alloc.bind(Buffer) as (n: number) => Uint8Array
    : browserAllocBuf;


let allocUnsafe: (n: number) => Uint8Array = isNode
    ? Buffer.allocUnsafe.bind(Buffer) as (n: number) => Uint8Array
    : browserAllocBuf;


let byteLen: (str: string) => number = isNode
    ? Buffer.byteLength.bind(Buffer) as (str: string) => number
    : browserByteLen;


let copyBuf: (src: Uint8Array, dst: Uint8Array, dstOff: number, srcStart: number, srcEnd: number) => void = isNode
    ? (src, dst, dstOff, srcStart, srcEnd) => (src as Buffer).copy(dst as Buffer, dstOff, srcStart, srcEnd)
    : browserCopyBuf;


// Constructed unconditionally so the browser DataView bindings stay exercisable under the Node
// test environment; getDv is browser-only on the hot path, so Node pays no per-call cost.
let dvCache = new WeakMap<ArrayBuffer, DataView>();

function getDv(buf: Uint8Array): DataView {
    let ab = buf.buffer as ArrayBuffer,
        dv = dvCache.get(ab);

    if (!dv) {
        dv = new DataView(ab);
        dvCache.set(ab, dv);
    }

    return dv;
}

function browserReadBI64(this: Uint8Array, off: number): bigint {
    return getDv(this).getBigInt64(this.byteOffset + off, true);
}

function browserReadF64(this: Uint8Array, off: number): number {
    return getDv(this).getFloat64(this.byteOffset + off, true);
}

function browserWriteBI64(this: Uint8Array, value: bigint, off: number): number {
    getDv(this).setBigInt64(this.byteOffset + off, value, true);

    return off + 8;
}

function browserWriteF64(this: Uint8Array, value: number, off: number): number {
    getDv(this).setFloat64(this.byteOffset + off, value, true);

    return off + 8;
}

function browserWriteUtf8(this: Uint8Array, str: string, off: number, _len: number): number {
    let result = textEncoder.encodeInto(str, this.subarray(off));

    return result.written!;
}


let readBI64: ((off: number) => bigint) = isNode
    ? Buffer.prototype.readBigInt64LE
    : browserReadBI64;

let readF64: ((off: number) => number) = isNode
    ? Buffer.prototype.readDoubleLE
    : browserReadF64;

let writeBI64: ((value: bigint, off: number) => number) = isNode
    ? Buffer.prototype.writeBigInt64LE
    : browserWriteBI64;

let writeF64: ((value: number, off: number) => number) = isNode
    ? Buffer.prototype.writeDoubleLE
    : browserWriteF64;

let writeUtf8: ((str: string, off: number, len: number) => number) = isNode
    ? (Buffer.prototype as unknown as BufferInternal).utf8Write
    : browserWriteUtf8;


// Browser binding set — direct handle on the non-Buffer implementations for tests,
// independent of which branch isNode selected for the module-level exports above.
let browser = {
    allocBuf: browserAllocBuf,
    allocUnsafe: browserAllocBuf,
    byteLen: browserByteLen,
    copyBuf: browserCopyBuf,
    getDv,
    readBI64: browserReadBI64,
    readF64: browserReadF64,
    readStr: browserReadStr,
    writeBI64: browserWriteBI64,
    writeF64: browserWriteF64,
    writeUtf8: browserWriteUtf8,
};


// Codegen driver — emits environment-specific code strings
interface CodegenDriver {
    byteLen(str: string): string;
    decoderBindArgs(): unknown[];
    decoderParams(): string;
    encoderBindArgs(): unknown[];
    encoderParams(): string;
    preamble(bufVar: string): string;
    readF64(off: string): string;
    readStr(start: string, len: string): string;
    writeF64(off: string, val: string): string;
    writeStr(str: string, off: string, len: string): string;
}


let codegenDriver: CodegenDriver = isNode
    ? {
        byteLen: (str) => `_bl(${str})`,
        decoderBindArgs: () => [
            Buffer.prototype.readDoubleLE,
            (Buffer.prototype as unknown as BufferInternal).utf8Slice,
            readStr,
            readBI64,
        ],
        decoderParams: () => '_rF64,_rUtf8,_rStr,_rBI64',
        encoderBindArgs: () => [
            Buffer.prototype.writeDoubleLE,
            (Buffer.prototype as unknown as BufferInternal).utf8Write,
            Buffer.byteLength,
            writeBI64,
        ],
        encoderParams: () => '_wF64,_wUtf8,_bl,_wBI64',
        preamble: () => '',
        readF64: (off) => `_rF64.call(b,${off})`,
        readStr: (start, len) => `_rStr(b,${start},${len})`,
        writeF64: (off, val) => `_wF64.call(b,${val},${off})`,
        writeStr: (str, off, len) => `_wUtf8.call(b,${str},${off},${len})`,
    }
    : {
        byteLen: (str) => `_bl(${str})`,
        decoderBindArgs: () => {
            let td = new TextDecoder();

            return [
                (buf: Uint8Array, off: number) => getDv(buf).getFloat64(buf.byteOffset + off, true),
                (buf: Uint8Array, start: number, end: number) => td.decode(buf.subarray(start, end)),
                readStr,
                readBI64,
            ];
        },
        decoderParams: () => '_rF64,_rUtf8,_rStr,_rBI64',
        encoderBindArgs: () => {
            let te = new TextEncoder();

            return [
                (buf: Uint8Array, val: number, off: number) => { getDv(buf).setFloat64(buf.byteOffset + off, val, true); },
                (buf: Uint8Array, str: string, off: number) => { let enc = te.encode(str); buf.set(enc, off); return enc.length; },
                byteLen,
                writeBI64,
            ];
        },
        encoderParams: () => '_wF64,_wUtf8,_bl,_wBI64',
        preamble: () => '',
        readF64: (off) => `_rF64(b,${off})`,
        readStr: (start, len) => `_rStr(b,${start},${len})`,
        writeF64: (off, val) => `_wF64(b,${val},${off})`,
        writeStr: (str, off, _len) => `_wUtf8(b,${str},${off})`,
    };


// Shared mutable return slot — eliminates tuple allocation on every varint read.
// Safe because the codec is single-threaded.
let _vr = { p: 0, v: 0 };


function readVarint(buf: Uint8Array, pos: number): void {
    let len = buf.length;

    if (pos >= len) {
        throw new Error('Codec2: varint read past end of buffer');
    }

    let b = buf[pos++]!,
        value = b & 0x7F;

    if (b < 128) { _vr.p = pos; _vr.v = value >>> 0; return; }

    if (pos >= len) {
        throw new Error('Codec2: varint read past end of buffer');
    }

    b = buf[pos++]!;
    value |= (b & 0x7F) << 7;

    if (b < 128) { _vr.p = pos; _vr.v = value >>> 0; return; }

    if (pos >= len) {
        throw new Error('Codec2: varint read past end of buffer');
    }

    b = buf[pos++]!;
    value |= (b & 0x7F) << 14;

    if (b < 128) { _vr.p = pos; _vr.v = value >>> 0; return; }

    if (pos >= len) {
        throw new Error('Codec2: varint read past end of buffer');
    }

    b = buf[pos++]!;
    value |= (b & 0x7F) << 21;

    if (b < 128) { _vr.p = pos; _vr.v = value >>> 0; return; }

    if (pos >= len) {
        throw new Error('Codec2: varint read past end of buffer');
    }

    b = buf[pos++]!;
    value |= (b & 0x0F) << 28;

    if (b & 0x80) {
        throw new Error('Codec2: varint exceeds 5 bytes');
    }

    _vr.p = pos;
    _vr.v = value >>> 0;
}


function readZigzag(buf: Uint8Array, pos: number): void {
    readVarint(buf, pos);
    _vr.v = zigzagDecode(_vr.v);
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
    return writeVarint(buf, pos, zigzagEncode(value));
}


function zigzagDecode(n: number): number {
    return (n >>> 1) ^ -(n & 1);
}


function zigzagEncode(n: number): number {
    return ((n << 1) ^ (n >> 31)) >>> 0;
}


let TYPED_ARRAY_BPE = [4, 8, 1, 2, 4, 1, 1, 2, 4, 8, 8];

let TYPED_ARRAY_CTORS: (new (buf: ArrayBuffer, off: number, len: number) => ArrayBufferView)[] = [
    Float32Array, Float64Array, Int8Array, Int16Array, Int32Array,
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
    BigInt64Array, BigUint64Array,
];

let TYPED_ARRAY_IDS = new Map<Function, number>();

for (let i = 0, n = TYPED_ARRAY_CTORS.length; i < n; i++) {
    TYPED_ARRAY_IDS.set(TYPED_ARRAY_CTORS[i]!, i);
}


export {
    _vr,
    allocBuf,
    allocUnsafe,
    browser,
    byteLen,
    codegenDriver,
    copyBuf,
    isNode,
    readBI64,
    readF64,
    readStr,
    readVarint,
    readZigzag,
    TYPED_ARRAY_BPE,
    TYPED_ARRAY_CTORS,
    TYPED_ARRAY_IDS,
    writeBI64,
    writeF64,
    writeUtf8,
    writeVarint,
    writeZigzag,
};

export type { CodegenDriver };
