import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


describe('Codec2 encode/decode safety', () => {
    let c = codec();


    // === Clause 1 — bigint out of int64 range fails loud, does NOT grow to OOM ===
    // RED against current source: writeBI64 (Buffer.prototype.writeBigInt64LE) throws a
    // RangeError, the tryEncodeSbc grow-loop mistakes it for "buffer too small" and doubles
    // the buffer until "Array buffer allocation failed" (~1122ms). The throw assertion is the
    // contract; against current source this clause HANGS/OOMs — that is the intended red signal.
    describe('bigint int64 range', () => {
        it('encode(2n**64n) throws a Codec2 error instead of doubling to OOM', () => {
            expect(() => c.encode(2n ** 64n)).toThrow(/Codec2: bigint out of int64 range/);
        });

        // Clause 2 — invariance guard: int64 boundaries still round-trip (passes now and after).
        it('int64 boundary bigints round-trip exactly', () => {
            let max = 2n ** 63n - 1n,
                min = -(2n ** 63n);

            expect(c.decode(c.encode(min))).toBe(min);
            expect(c.decode(c.encode(max))).toBe(max);
        });
    });


    // === Clause 3 — hinted fixed-width path validates and names the field ===
    // RED against current source: encode({v:300}, uint8-hint) silently decodes {v:44},
    // encode({v:'not a number'}, uint8-hint) decodes {v:0}; neither throws today.
    describe('hinted-path validation', () => {
        let hint = c.defineSchema([{ name: 'v', type: 'uint8' }]);

        it("rejects an out-of-range numeric, naming field 'v'", () => {
            expect(() => c.encode({ v: 300 }, { schema: hint })).toThrow(/Codec2: field 'v'/);
        });

        it("rejects a non-numeric value, naming field 'v'", () => {
            expect(() => c.encode({ v: 'not a number' }, { schema: hint })).toThrow(/Codec2: field 'v'/);
        });

        it("rejects a missing non-nullable field, naming field 'v'", () => {
            expect(() => c.encode({}, { schema: hint })).toThrow(/Codec2: field 'v'/);
        });
    });


    // === Clause 4 — non-encodable values throw with a path ===
    // RED against current source: these silently become {} (RegExp/Error/DataView/ArrayBuffer)
    // or null (function) today; none throw.
    describe('non-encodable values', () => {
        it('rejects RegExp, Error, DataView, ArrayBuffer, and function values', () => {
            let cases: unknown[] = [
                /x/,
                new Error('boom'),
                new DataView(new ArrayBuffer(8)),
                new ArrayBuffer(8),
                () => {},
            ];

            for (let i = 0, n = cases.length; i < n; i++) {
                expect(() => c.encode(cases[i])).toThrow(/Codec2: unencodable value/);
            }
        });

        it('rejects a nested function with a path', () => {
            expect(() => c.encode({ a: { b: () => {} } })).toThrow(/Codec2: unencodable value/);
        });
    });


    // === Clause 5 — invariance guard: undefined property still maps to null ===
    // KEPT behavior (passes now and after); guards the fix against over-reaching D13.
    describe('kept behavior', () => {
        it('maps an undefined property to null', () => {
            expect(c.decode(c.encode({ a: undefined, b: 1 }))).toEqual({ a: null, b: 1 });
        });
    });


    // === Clause 6 — empty buffer decode fails loud ===
    // RED against current source: decode(new Uint8Array(0)) returns undefined today.
    describe('empty buffer decode', () => {
        it('throws Codec2: empty buffer', () => {
            expect(() => c.decode(new Uint8Array(0))).toThrow(/Codec2: empty buffer/);
        });
    });


    // === Clause 7 — bytes decode as a plain Uint8Array copy ===
    // RED against current source: under Node the encode buffer is a Buffer and the compiled
    // decoder's b.slice(...) yields a Buffer, so decoded.data.constructor === Buffer today.
    describe('bytes materialization', () => {
        it('decodes a Uint8Array field with constructor === Uint8Array', () => {
            let input = new Uint8Array([1, 2, 3]),
                decoded = c.decode<{ data: Uint8Array }>(c.encode({ data: input }));

            expect(decoded.data.constructor).toBe(Uint8Array);
            expect(Array.from(decoded.data)).toEqual([1, 2, 3]);
        });
    });
});
