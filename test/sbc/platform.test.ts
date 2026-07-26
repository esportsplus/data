import { describe, expect, it } from 'vitest';

import {
    _vr,
    allocBuf,
    browser,
    byteLen,
    copyBuf,
    readBI64,
    readF64,
    readStr,
    readVarint,
    readZigzag,
    writeBI64,
    writeF64,
    writeUtf8,
    writeVarint,
    writeZigzag,
} from '../../src/sbc/platform';


// The suite runs under vitest's pinned `environment: 'node'`, so the module-level exports resolve to
// the Node (Buffer) bindings. `browser.*` are the non-Buffer twins, exercised directly here so the
// DataView/TextDecoder/TextEncoder branch — otherwise dead under test — actually executes. Node-side
// buffers are allocated via the Node `allocBuf` (real Buffer) so Buffer.prototype `this` slots are valid;
// browser-side buffers via `browser.allocBuf` (plain Uint8Array).

const INT64_MAX = 9223372036854775807n;

const INT64_MIN = -9223372036854775808n;

const TAG_ARR = 5;

const TAG_BIG = 4;

const TAG_BOOL = 1;

const TAG_F64ARR = 7;

const TAG_NUM = 2;

const TAG_OBJ = 6;

const TAG_STR = 3;


interface Bind {
    byteLen: (str: string) => number;
    writeBI64: (this: Uint8Array, value: bigint, off: number) => number;
    writeF64: (this: Uint8Array, value: number, off: number) => number;
    writeUtf8: (this: Uint8Array, str: string, off: number, len: number) => number;
}


let browserBind: Bind = {
    byteLen: browser.byteLen,
    writeBI64: browser.writeBI64,
    writeF64: browser.writeF64,
    writeUtf8: browser.writeUtf8,
};

let nodeBind: Bind = {
    byteLen,
    writeBI64,
    writeF64,
    writeUtf8,
};


// Minimal tagged codec parameterized by a binding set — lets one encoder run on either the Node or the
// browser primitives so their byte output can be compared, then decoded back on the browser bindings.
function decodeVal(buf: Uint8Array, pos: number): { pos: number; value: unknown } {
    let tag = buf[pos++]!;

    if (tag === TAG_BOOL) {
        return { pos: pos + 1, value: buf[pos] === 1 };
    }

    if (tag === TAG_NUM) {
        return { pos: pos + 8, value: browser.readF64.call(buf, pos) };
    }

    if (tag === TAG_BIG) {
        return { pos: pos + 8, value: browser.readBI64.call(buf, pos) };
    }

    if (tag === TAG_STR) {
        readVarint(buf, pos);

        let len = _vr.v;

        pos = _vr.p;

        return { pos: pos + len, value: browser.readStr(buf, pos, len) };
    }

    if (tag === TAG_F64ARR) {
        readVarint(buf, pos);

        let n = _vr.v;

        pos = _vr.p;

        let arr = new Float64Array(n);

        for (let i = 0; i < n; i++) {
            arr[i] = browser.readF64.call(buf, pos);
            pos += 8;
        }

        return { pos, value: arr };
    }

    if (tag === TAG_ARR) {
        readVarint(buf, pos);

        let n = _vr.v;

        pos = _vr.p;

        let arr: unknown[] = [];

        for (let i = 0; i < n; i++) {
            let r = decodeVal(buf, pos);

            arr.push(r.value);
            pos = r.pos;
        }

        return { pos, value: arr };
    }

    if (tag === TAG_OBJ) {
        readVarint(buf, pos);

        let n = _vr.v;

        pos = _vr.p;

        let obj: Record<string, unknown> = {};

        for (let i = 0; i < n; i++) {
            readVarint(buf, pos);

            let kl = _vr.v;

            pos = _vr.p;

            let key = browser.readStr(buf, pos, kl);

            pos += kl;

            let r = decodeVal(buf, pos);

            obj[key] = r.value;
            pos = r.pos;
        }

        return { pos, value: obj };
    }

    throw new Error('platform.test: unknown tag ' + tag);
}


function encodeVal(bind: Bind, value: unknown, buf: Uint8Array, pos: number): number {
    if (typeof value === 'boolean') {
        buf[pos++] = TAG_BOOL;
        buf[pos++] = value ? 1 : 0;

        return pos;
    }

    if (typeof value === 'number') {
        buf[pos++] = TAG_NUM;

        return bind.writeF64.call(buf, value, pos);
    }

    if (typeof value === 'bigint') {
        buf[pos++] = TAG_BIG;

        return bind.writeBI64.call(buf, value, pos);
    }

    if (typeof value === 'string') {
        buf[pos++] = TAG_STR;

        let len = bind.byteLen(value);

        pos = writeVarint(buf, pos, len);
        bind.writeUtf8.call(buf, value, pos, len);

        return pos + len;
    }

    if (value instanceof Float64Array) {
        buf[pos++] = TAG_F64ARR;
        pos = writeVarint(buf, pos, value.length);

        for (let i = 0, n = value.length; i < n; i++) {
            pos = bind.writeF64.call(buf, value[i]!, pos);
        }

        return pos;
    }

    if (Array.isArray(value)) {
        buf[pos++] = TAG_ARR;
        pos = writeVarint(buf, pos, value.length);

        for (let i = 0, n = value.length; i < n; i++) {
            pos = encodeVal(bind, value[i], buf, pos);
        }

        return pos;
    }

    if (typeof value === 'object' && value !== null) {
        let keys = Object.keys(value);

        buf[pos++] = TAG_OBJ;
        pos = writeVarint(buf, pos, keys.length);

        for (let i = 0, n = keys.length; i < n; i++) {
            let key = keys[i]!,
                kl = bind.byteLen(key);

            pos = writeVarint(buf, pos, kl);
            bind.writeUtf8.call(buf, key, pos, kl);
            pos += kl;
            pos = encodeVal(bind, (value as Record<string, unknown>)[key], buf, pos);
        }

        return pos;
    }

    throw new Error('platform.test: unsupported corpus value');
}


function varintByteLen(v: number): number {
    let u = v >>> 0;

    if (u < 0x80) {
        return 1;
    }

    if (u < 0x4000) {
        return 2;
    }

    if (u < 0x200000) {
        return 3;
    }

    if (u < 0x10000000) {
        return 4;
    }

    return 5;
}


describe('sbc/platform browser varint (single impl, platform-independent)', () => {
    it('round-trips unsigned values at every byte-width boundary', () => {
        let cases = [0, 1, 126, 127, 128, 129, 16383, 16384, 2097151, 2097152, 268435455, 268435456, 0xFFFFFFFF];

        for (let v of cases) {
            let buf = browser.allocBuf(8),
                end = writeVarint(buf, 0, v);

            readVarint(buf, 0);

            expect(_vr.v).toBe(v >>> 0);
            expect(_vr.p).toBe(end);
            expect(_vr.p).toBe(varintByteLen(v));
        }
    });

    it('throws past end of buffer and beyond 5 bytes', () => {
        expect(() => readVarint(new Uint8Array([0x80]), 0)).toThrow('past end');
        expect(() => readVarint(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80]), 0)).toThrow('exceeds 5 bytes');
    });
});


describe('sbc/platform browser zigzag (single impl, platform-independent)', () => {
    it('round-trips signed values including negatives and int32 edges', () => {
        let cases = [0, -1, 1, -2, 2, 63, -64, 12345, -12345, 2147483647, -2147483648];

        for (let v of cases) {
            let buf = browser.allocBuf(8);

            writeZigzag(buf, 0, v);
            readZigzag(buf, 0);

            expect(_vr.v).toBe(v);
        }
    });
});


describe('sbc/platform browser float64 (DataView bindings)', () => {
    it('round-trips finite values, ±Infinity, NaN and -0', () => {
        let cases = [0, 1.5, -1.5, Math.PI, Number.MAX_VALUE, Number.MIN_VALUE, 1e308, -1e308, Infinity, -Infinity];

        for (let v of cases) {
            let buf = browser.allocBuf(8),
                end = browser.writeF64.call(buf, v, 0);

            expect(end).toBe(8);
            expect(browser.readF64.call(buf, 0)).toBe(v);
        }

        let nanBuf = browser.allocBuf(8);

        browser.writeF64.call(nanBuf, NaN, 0);
        expect(Number.isNaN(browser.readF64.call(nanBuf, 0))).toBe(true);

        let negZeroBuf = browser.allocBuf(8);

        browser.writeF64.call(negZeroBuf, -0, 0);
        expect(Object.is(browser.readF64.call(negZeroBuf, 0), -0)).toBe(true);
    });

    it('is byte-identical to the Node binding', () => {
        let cases = [0, -0, 1.5, -1.5, Math.PI, Number.MAX_VALUE, Number.MIN_VALUE, Infinity, -Infinity, NaN];

        for (let v of cases) {
            let bufB = browser.allocBuf(8),
                bufN = allocBuf(8);

            browser.writeF64.call(bufB, v, 0);
            writeF64.call(bufN, v, 0);

            expect(Array.from(bufB)).toEqual(Array.from(bufN));
            expect(Object.is(browser.readF64.call(bufB, 0), readF64.call(bufN, 0))).toBe(true);
        }
    });
});


describe('sbc/platform browser bigint64 (DataView bindings)', () => {
    it('round-trips values at the ±2^63 int64 edges', () => {
        let cases = [0n, 1n, -1n, 255n, -256n, 2n ** 62n, -(2n ** 62n), INT64_MAX, INT64_MIN];

        for (let v of cases) {
            let buf = browser.allocBuf(8),
                end = browser.writeBI64.call(buf, v, 0);

            expect(end).toBe(8);
            expect(browser.readBI64.call(buf, 0)).toBe(v);
        }
    });

    it('is byte-identical to the Node binding', () => {
        let cases = [0n, 1n, -1n, INT64_MAX, INT64_MIN, 2n ** 62n];

        for (let v of cases) {
            let bufB = browser.allocBuf(8),
                bufN = allocBuf(8);

            browser.writeBI64.call(bufB, v, 0);
            writeBI64.call(bufN, v, 0);

            expect(Array.from(bufB)).toEqual(Array.from(bufN));
            expect(browser.readBI64.call(bufB, 0)).toBe(readBI64.call(bufN, 0));
        }
    });
});


describe('sbc/platform browser utf8 (TextEncoder/TextDecoder bindings)', () => {
    let cases = ['', 'a', 'hello', 'sixteen-char-str', 'seventeen-chars!!', 'héllo wörld', '日本語テキスト', '👍🎉🚀 mixed 日本'];

    it('round-trips byteLen → writeUtf8 → readStr for ascii, unicode and multi-byte', () => {
        for (let s of cases) {
            let len = browser.byteLen(s),
                buf = browser.allocBuf(len || 1),
                written = browser.writeUtf8.call(buf, s, 0, len);

            expect(written).toBe(len);
            expect(browser.readStr(buf, 0, len)).toBe(s);
        }
    });

    it('round-trips a 100KB+ mixed string', () => {
        let s = 'a'.repeat(50_000) + 'あ'.repeat(20_000),
            len = browser.byteLen(s);

        expect(len).toBeGreaterThan(100_000);

        let buf = browser.allocBuf(len),
            written = browser.writeUtf8.call(buf, s, 0, len);

        expect(written).toBe(len);
        expect(browser.readStr(buf, 0, len)).toBe(s);
    });

    it('byteLen, encoded bytes and decoded string all match the Node binding', () => {
        for (let s of cases) {
            expect(browser.byteLen(s)).toBe(byteLen(s));

            let len = browser.byteLen(s),
                bufB = browser.allocBuf(len || 1),
                bufN = allocBuf(len || 1);

            browser.writeUtf8.call(bufB, s, 0, len);
            writeUtf8.call(bufN, s, 0, len);

            expect(Array.from(bufB.subarray(0, len))).toEqual(Array.from(bufN.subarray(0, len)));
            expect(browser.readStr(bufB, 0, len)).toBe(readStr(bufN, 0, len));
        }
    });
});


describe('sbc/platform browser alloc/copy (twin equality)', () => {
    it('allocBuf yields a zeroed buffer matching the Node binding', () => {
        let bufB = browser.allocBuf(16),
            bufN = allocBuf(16);

        expect(bufB.length).toBe(16);
        expect(Array.from(bufB)).toEqual(Array.from(bufN));
    });

    it('allocUnsafe yields a buffer of the requested length', () => {
        expect(browser.allocUnsafe(24).length).toBe(24);
    });

    it('copyBuf copies the same slice as the Node binding', () => {
        let src = allocBuf(8),
            dstB = browser.allocBuf(8),
            dstN = allocBuf(8);

        src.set([10, 11, 12, 13, 14, 15, 16, 17]);

        browser.copyBuf(src, dstB, 2, 1, 5);
        copyBuf(src, dstN, 2, 1, 5);

        expect(Array.from(dstB)).toEqual(Array.from(dstN));
        expect(Array.from(dstB)).toEqual([0, 0, 11, 12, 13, 14, 0, 0]);
    });
});


describe('sbc/platform browser dvCache', () => {
    it('returns a reused DataView keyed by the backing ArrayBuffer', () => {
        let buf = new Uint8Array(16),
            dv1 = browser.getDv(buf),
            dv2 = browser.getDv(buf);

        expect(dv1).toBe(dv2);
        expect(browser.getDv(buf.subarray(4))).toBe(dv1);
        expect(browser.getDv(new Uint8Array(16))).not.toBe(dv1);
    });

    it('writes and reads through the cached DataView', () => {
        let buf = new Uint8Array(16);

        browser.writeF64.call(buf, 3.14159, 0);
        expect(browser.readF64.call(buf, 0)).toBe(3.14159);
    });
});


describe('sbc/platform browser end-to-end round-trip', () => {
    let corpus = {
        big: 9007199254740993n,
        flag: true,
        matrix: new Float64Array([1.5, -2.5, Infinity, NaN]),
        name: 'plaform-échô 日本語 👍',
        nested: { label: 'inner', x: 1.25, y: -2.5 },
        neg: -273.15,
        off: false,
        tags: ['a', 'bb', 'ccc-long-string-over-sixteen-bytes'],
    };

    it('encodes on the browser bindings and decodes back to the original corpus', () => {
        let buf = browser.allocBuf(8192),
            end = encodeVal(browserBind, corpus, buf, 0),
            decoded = decodeVal(buf, 0);

        expect(decoded.pos).toBe(end);
        expect(decoded.value).toEqual(corpus);
    });

    it('produces byte-identical output to the Node bindings', () => {
        let bufB = browser.allocBuf(8192),
            bufN = allocBuf(8192),
            endB = encodeVal(browserBind, corpus, bufB, 0),
            endN = encodeVal(nodeBind, corpus, bufN, 0);

        expect(endB).toBe(endN);
        expect(Array.from(bufB.subarray(0, endB))).toEqual(Array.from(bufN.subarray(0, endN)));
    });
});
