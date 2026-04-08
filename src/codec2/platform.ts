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
        default: {
            let codes = new Array(len);

            for (let i = 0; i < len; i++) {
                codes[i] = buf[s + i]!;
            }

            return String.fromCharCode.apply(null, codes);
        }
    }
}


let readStr: (buf: Uint8Array, start: number, len: number) => string = isNode
    ? (buf, start, len) => readShortStrAscii(buf, start, len) ?? (buf as BufferInternal).utf8Slice(start, start + len)
    : (buf, start, len) => readShortStrAscii(buf, start, len) ?? textDecoder.decode(buf.subarray(start, start + len));


let allocBuf: (n: number) => Uint8Array = isNode
    ? Buffer.alloc.bind(Buffer) as (n: number) => Uint8Array
    : (n) => new Uint8Array(n);


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


let copyBuf: (src: Uint8Array, dst: Uint8Array, dstOff: number, srcStart: number, srcEnd: number) => void = isNode
    ? (src, dst, dstOff, srcStart, srcEnd) => (src as Buffer).copy(dst as Buffer, dstOff, srcStart, srcEnd)
    : (src, dst, dstOff, srcStart, srcEnd) => dst.set(src.subarray(srcStart, srcEnd), dstOff);


// Instance methods — use .call(buf, ...) on hot path
let dvCache: WeakMap<ArrayBuffer, DataView>;

function getDv(buf: Uint8Array): DataView {
    let ab = buf.buffer as ArrayBuffer,
        dv = dvCache.get(ab);

    if (!dv) {
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

let writeBI64: ((value: bigint, off: number) => number) = isNode
    ? Buffer.prototype.writeBigInt64LE
    : function (this: Uint8Array, value: bigint, off: number) { getDv(this).setBigInt64(this.byteOffset + off, value, true); return off + 8; };

let writeF64: ((value: number, off: number) => number) = isNode
    ? Buffer.prototype.writeDoubleLE
    : function (this: Uint8Array, value: number, off: number) { getDv(this).setFloat64(this.byteOffset + off, value, true); return off + 8; };

let writeUtf8: ((str: string, off: number, len: number) => number) = isNode
    ? (Buffer.prototype as unknown as BufferInternal).utf8Write
    : function (this: Uint8Array, str: string, off: number, _len: number) {
        let result = textEncoder.encodeInto(str, this.subarray(off));

        return result.written!;
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
    readU32(off: string): string;
    writeF64(off: string, val: string): string;
    writeStr(str: string, off: string, len: string): string;
    writeU32(off: string, val: string): string;
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
        readU32: (off) => `b[${off}]|(b[${off}+1]<<8)|(b[${off}+2]<<16)|(b[${off}+3]<<24)>>>0`,
        writeF64: (off, val) => `_wF64.call(b,${val},${off})`,
        writeStr: (str, off, len) => `_wUtf8.call(b,${str},${off},${len})`,
        writeU32: (off, val) => `b[${off}]=${val}&0xFF;b[${off}+1]=(${val}>>>8)&0xFF;b[${off}+2]=(${val}>>>16)&0xFF;b[${off}+3]=(${val}>>>24)&0xFF`,
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
        readU32: (off) => `(b[${off}]|(b[${off}+1]<<8)|(b[${off}+2]<<16)|(b[${off}+3]<<24))>>>0`,
        writeF64: (off, val) => `_wF64(b,${val},${off})`,
        writeStr: (str, off, len) => `_wUtf8(b,${str},${off})`,
        writeU32: (off, val) => `b[${off}]=${val}&0xFF;b[${off}+1]=(${val}>>>8)&0xFF;b[${off}+2]=(${val}>>>16)&0xFF;b[${off}+3]=(${val}>>>24)&0xFF`,
    };


export {
    allocBuf,
    allocUnsafe,
    byteLen,
    codegenDriver,
    copyBuf,
    isNode,
    readBI64,
    readF64,
    readStr,
    writeBI64,
    writeF64,
    writeUtf8,
};

export type { CodegenDriver };
