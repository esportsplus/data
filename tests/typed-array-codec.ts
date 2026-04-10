import { describe, expect, it } from 'vitest';
import { decodeTypedArray, encodeTypedArrayInto, getTypedArrayType, TYPED_ARRAY_MARKER } from '../src/typed-array-codec';


describe('typed-array-codec exports', () => {
    describe('TYPED_ARRAY_MARKER', () => {
        it('is 0x54', () => {
            expect(TYPED_ARRAY_MARKER).toBe(0x54);
        });
    });

    describe('getTypedArrayType', () => {
        it('identifies Uint8Array', () => {
            expect(getTypedArrayType(new Uint8Array(4))).not.toBe(-1);
        });

        it('identifies Float64Array', () => {
            expect(getTypedArrayType(new Float64Array(2))).not.toBe(-1);
        });

        it('identifies Float32Array', () => {
            expect(getTypedArrayType(new Float32Array(1))).not.toBe(-1);
        });

        it('identifies Int8Array', () => {
            expect(getTypedArrayType(new Int8Array(1))).not.toBe(-1);
        });

        it('identifies Int16Array', () => {
            expect(getTypedArrayType(new Int16Array(1))).not.toBe(-1);
        });

        it('identifies Int32Array', () => {
            expect(getTypedArrayType(new Int32Array(1))).not.toBe(-1);
        });

        it('identifies Uint8ClampedArray', () => {
            expect(getTypedArrayType(new Uint8ClampedArray(1))).not.toBe(-1);
        });

        it('identifies Uint16Array', () => {
            expect(getTypedArrayType(new Uint16Array(1))).not.toBe(-1);
        });

        it('identifies Uint32Array', () => {
            expect(getTypedArrayType(new Uint32Array(1))).not.toBe(-1);
        });

        it('identifies BigInt64Array', () => {
            expect(getTypedArrayType(new BigInt64Array(1))).not.toBe(-1);
        });

        it('identifies BigUint64Array', () => {
            expect(getTypedArrayType(new BigUint64Array(1))).not.toBe(-1);
        });

        it('returns -1 for plain array', () => {
            expect(getTypedArrayType([1, 2, 3])).toBe(-1);
        });

        it('returns -1 for null', () => {
            expect(getTypedArrayType(null)).toBe(-1);
        });

        it('returns -1 for undefined', () => {
            expect(getTypedArrayType(undefined)).toBe(-1);
        });

        it('returns -1 for plain object', () => {
            expect(getTypedArrayType({ length: 4 })).toBe(-1);
        });

        it('returns -1 for number', () => {
            expect(getTypedArrayType(42)).toBe(-1);
        });
    });

    describe('encodeTypedArrayInto', () => {
        it('encodes Uint8Array into buffer', () => {
            let src = new Uint8Array([10, 20, 30]),
                buf = new Uint8Array(64),
                end = encodeTypedArrayInto(src, buf, 0);

            expect(end).toBe(4 + 3);
            expect(buf[0]).toBe(TYPED_ARRAY_MARKER);
        });

        it('encodes Float64Array into buffer', () => {
            let src = new Float64Array([1.5, 2.5]),
                buf = new Uint8Array(64),
                end = encodeTypedArrayInto(src, buf, 0);

            expect(end).toBe(4 + 16);
            expect(buf[0]).toBe(TYPED_ARRAY_MARKER);
        });

        it('encodes at non-zero offset', () => {
            let src = new Uint8Array([1, 2]),
                buf = new Uint8Array(64),
                end = encodeTypedArrayInto(src, buf, 10);

            expect(end).toBe(10 + 4 + 2);
            expect(buf[10]).toBe(TYPED_ARRAY_MARKER);
        });

        it('returns -1 for plain array', () => {
            let buf = new Uint8Array(64),
                end = encodeTypedArrayInto([1, 2, 3] as unknown as ArrayBufferView, buf, 0);

            expect(end).toBe(-1);
        });

        it('returns -1 when buffer too small', () => {
            let src = new Uint8Array([1, 2, 3, 4, 5]),
                buf = new Uint8Array(6),
                end = encodeTypedArrayInto(src, buf, 0);

            expect(end).toBe(-1);
        });
    });

    describe('decodeTypedArray', () => {
        it('roundtrips Uint8Array', () => {
            let src = new Uint8Array([10, 20, 30]),
                buf = new Uint8Array(64),
                end = encodeTypedArrayInto(src, buf, 0),
                decoded = decodeTypedArray(buf.subarray(0, end));

            expect(decoded).toBeInstanceOf(Uint8Array);
            expect([...(decoded as Uint8Array)]).toEqual([10, 20, 30]);
        });

        it('roundtrips Float64Array', () => {
            let src = new Float64Array([1.5, 2.5]),
                buf = new Uint8Array(64),
                end = encodeTypedArrayInto(src, buf, 0),
                decoded = decodeTypedArray(buf.subarray(0, end));

            expect(decoded).toBeInstanceOf(Float64Array);
            expect([...(decoded as Float64Array)]).toEqual([1.5, 2.5]);
        });

        it('roundtrips Int32Array', () => {
            let src = new Int32Array([-100, 0, 100]),
                buf = new Uint8Array(64),
                end = encodeTypedArrayInto(src, buf, 0),
                decoded = decodeTypedArray(buf.subarray(0, end));

            expect(decoded).toBeInstanceOf(Int32Array);
            expect([...(decoded as Int32Array)]).toEqual([-100, 0, 100]);
        });

        it('roundtrips empty typed array', () => {
            let src = new Uint8Array(0),
                buf = new Uint8Array(64),
                end = encodeTypedArrayInto(src, buf, 0),
                decoded = decodeTypedArray(buf.subarray(0, end));

            expect(decoded).toBeInstanceOf(Uint8Array);
            expect((decoded as Uint8Array).length).toBe(0);
        });

        it('returns null for buffer too short', () => {
            expect(decodeTypedArray(new Uint8Array(3))).toBeNull();
        });

        it('returns null for wrong marker', () => {
            let buf = new Uint8Array([0x00, 0x05, 0x00, 0x00, 0x01]);

            expect(decodeTypedArray(buf)).toBeNull();
        });

        it('returns null for invalid type id', () => {
            let buf = new Uint8Array([TYPED_ARRAY_MARKER, 0xFF, 0x00, 0x00, 0x01]);

            expect(decodeTypedArray(buf)).toBeNull();
        });

        it('returns null for misaligned byte length', () => {
            // Float64 requires 8-byte alignment; 5 data bytes is invalid
            let buf = new Uint8Array([TYPED_ARRAY_MARKER, 1, 0, 0, 0x01, 0x02, 0x03, 0x04, 0x05]);

            expect(decodeTypedArray(buf)).toBeNull();
        });

        it('decoded array is isolated from source buffer', () => {
            let src = new Uint8Array([42]),
                buf = new Uint8Array(64),
                end = encodeTypedArrayInto(src, buf, 0),
                decoded = decodeTypedArray(buf.subarray(0, end)) as Uint8Array;

            // Mutate original buffer; decoded should be unaffected
            buf[4] = 99;

            expect(decoded[0]).toBe(42);
        });
    });
});
