import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';
import { _vr, allocBuf, byteLen, copyBuf, readBI64, readF64, readStr, readVarint, readZigzag, writeBI64, writeF64, writeUtf8, writeVarint, writeZigzag } from '../../src/sbc/platform';


function readSource(rel: string): string {
    return readFileSync(new URL('../../src/sbc/' + rel, import.meta.url), 'utf8');
}


// === bigint-int64-parity ===
// int64 writes must have ONE range behavior across Node and browser: a named throw
// at the encode call site, never Node's silent ERR_OUT_OF_RANGE-into-grow-loop nor
// the browser's silent modulo-2^64 wrap. The schema vocabulary renames bigint -> int64.
describe('bigint-int64-parity — one int64 range behavior; int64 vocabulary', () => {
    it('rejects an out-of-int64 bigint with a named error instead of hanging', () => {
        // Pre-fix these HANG: writeBigInt64LE throws RangeError, which the encode
        // grow-loop mistakes for buffer-too-small and doubles until OOM. The call-site
        // range check stops the value at source with a named Codec2 error.
        let c = codec();

        expect(() => c.encode(2n ** 63n)).toThrow(/Codec2: bigint out of int64 range/);
        expect(() => c.encode(-(2n ** 63n) - 1n)).toThrow(/Codec2: bigint out of int64 range/);
    });

    it('round-trips the int64 boundary values exactly', () => {
        let c = codec();

        expect(c.decode(c.encode(2n ** 63n - 1n))).toBe(2n ** 63n - 1n);
        expect(c.decode(c.encode(-(2n ** 63n)))).toBe(-(2n ** 63n));
    });

    it('renames the schema vocabulary from bigint to int64', () => {
        // FIELD_SIZES + KNOWN_TYPES must carry int64, not the misnamed bigint.
        let src = readSource('constants.ts');

        expect(src).toMatch(/int64/);
        expect(src).not.toMatch(/\bbigint\b/);
    });

    it('refuses a field typed bigint and accepts one typed int64', () => {
        let c = codec();

        expect(() => c.defineSchema([{ name: 'x', type: 'bigint' }])).toThrow(/unknown field type/);
        expect(() => c.defineSchema([{ name: 'x', type: 'int64' }])).not.toThrow();
    });

    it('round-trips an int64 field through the compiled path with exact size', () => {
        let c = codec(),
            hash = c.defineSchema([{ name: 'x', type: 'int64' }]),
            value = { x: 123456789012345n },
            buf = c.encode(value, { schema: hash });

        expect((c.decode(buf) as { x: bigint }).x).toBe(123456789012345n);
        expect(c.computeSize(value)).toBe(buf.length);
    });
});


// === sbc-browser-platform-tests ===
// Executes every dual-path platform export through an absolute round-trip corpus. Under
// the default Node env these run the Buffer bindings; under the browser env the item
// installs (Buffer absent -> isNode false) the SAME assertions run the DataView/
// TextDecoder bindings, so any divergence between a browser impl and its Node twin
// fails the corpus. readF64/readBI64/writeF64/writeBI64 route through getDv+dvCache
// on the browser branch, exercising the cache reuse path.
describe('sbc-browser-platform-tests — dual-path platform primitives round-trip', () => {
    it('round-trips varints across the 1/2/3-byte length boundaries', () => {
        for (let value of [0, 1, 126, 127, 128, 200, 5000, 16383, 16384, 2097151, 0x7FFFFFFF]) {
            let buf = allocBuf(8),
                end = writeVarint(buf, 0, value);

            readVarint(buf, 0);

            expect(_vr.v).toBe(value);
            expect(_vr.p).toBe(end);
        }
    });

    it('round-trips zigzag-encoded signed integers including negatives', () => {
        for (let value of [0, -1, 1, -63, 64, -5000, 5000, -2147483648, 2147483647]) {
            let buf = allocBuf(8);

            writeZigzag(buf, 0, value);
            readZigzag(buf, 0);

            expect(_vr.v).toBe(value);
        }
    });

    it('round-trips float64 special values (NaN, +/-Infinity, -0)', () => {
        let buf = allocBuf(8);

        for (let value of [3.14, 0, 1e308, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Infinity, -Infinity]) {
            writeF64.call(buf, value, 0);
            expect(readF64.call(buf, 0)).toBe(value);
        }

        writeF64.call(buf, -0, 0);
        expect(Object.is(readF64.call(buf, 0), -0)).toBe(true);

        writeF64.call(buf, NaN, 0);
        expect(Number.isNaN(readF64.call(buf, 0))).toBe(true);
    });

    it('round-trips int64 bigints at the signed 64-bit edges', () => {
        let buf = allocBuf(8);

        for (let value of [0n, 1n, -1n, 123456789012345n, 2n ** 63n - 1n, -(2n ** 63n)]) {
            writeBI64.call(buf, value, 0);
            expect(readBI64.call(buf, 0)).toBe(value);
        }
    });

    it('measures utf8 byte length for ASCII, multi-byte, and surrogate-pair strings', () => {
        expect(byteLen('')).toBe(0);
        expect(byteLen('abc')).toBe(3);
        expect(byteLen('café')).toBe(5);
        expect(byteLen('日本')).toBe(6);
        expect(byteLen('😀')).toBe(4);
    });

    it('round-trips utf8 strings through writeUtf8/readStr including multi-byte and long input', () => {
        for (let str of ['hello', 'héllo wörld', '日本語テキスト', '😀🎉', 'x'.repeat(200)]) {
            let len = byteLen(str),
                buf = allocBuf(len + 8);

            writeUtf8.call(buf, str, 0, len);

            expect(readStr(buf, 0, len)).toBe(str);
        }
    });

    it('allocates zeroed buffers and copies byte ranges', () => {
        let zeroed = allocBuf(4);

        expect(zeroed.length).toBe(4);
        expect(Array.from(zeroed)).toEqual([0, 0, 0, 0]);

        let src = allocBuf(5);

        for (let i = 0; i < 5; i++) {
            src[i] = i + 1;
        }

        let dst = allocBuf(5);

        copyBuf(src, dst, 0, 1, 4);

        expect(Array.from(dst.subarray(0, 3))).toEqual([2, 3, 4]);
    });
});
