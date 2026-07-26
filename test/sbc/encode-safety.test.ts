import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


// D3, D9, D12, D13, D14 — encode/decode fail loud instead of OOM/corrupt/silent.
describe('sbc encode/decode safety', () => {
    describe('D3 — bigint int64 range', () => {
        it('encode(2n**64n) throws a Codec2 error immediately, no unbounded growth', () => {
            let c = codec(),
                start = performance.now();

            expect(() => c.encode(2n ** 64n)).toThrow(/Codec2: bigint out of int64 range/);
            expect(performance.now() - start).toBeLessThan(100);
        });

        it('encode(2n**63n) (one past max) throws', () => {
            let c = codec();

            expect(() => c.encode(2n ** 63n)).toThrow('Codec2: bigint out of int64 range');
        });

        it('encode(-(2n**63n)-1n) (one below min) throws', () => {
            let c = codec();

            expect(() => c.encode(-(2n ** 63n) - 1n)).toThrow('Codec2: bigint out of int64 range');
        });

        it('int64 boundary bigints still round-trip', () => {
            let c = codec();

            for (let v of [-(2n ** 63n), 2n ** 63n - 1n, 0n, -1n, 1n, 123456789012345n]) {
                expect(c.decode(c.encode(v))).toBe(v);
            }
        });

        it('out-of-range bigint object field throws instead of doubling to OOM', () => {
            let c = codec(),
                start = performance.now();

            expect(() => c.encode({ big: 2n ** 100n })).toThrow('Codec2: bigint out of int64 range');
            expect(performance.now() - start).toBeLessThan(100);
        });
    });

    describe('D12 — hinted-path validation', () => {
        it('out-of-range numeric on a hinted uint8 field throws, naming the field', () => {
            let c = codec();

            expect(() => c.encode({ v: 300 }, { schema: [{ name: 'v', type: 'uint8' }] })).toThrow("Codec2: field 'v'");
        });

        it('non-numeric value on a hinted uint8 field throws, naming the field', () => {
            let c = codec();

            expect(() => c.encode({ v: 'not a number' } as never, { schema: [{ name: 'v', type: 'uint8' }] })).toThrow("Codec2: field 'v'");
        });

        it('missing non-nullable hinted field throws a named error', () => {
            let c = codec();

            expect(() => c.encode({} as never, { schema: [{ name: 'v', type: 'uint8' }] })).toThrow("Codec2: field 'v'");
        });

        it('in-range hinted values still round-trip', () => {
            let c = codec(),
                schema = [{ name: 'v', type: 'uint8' }];

            expect(c.decode(c.encode({ v: 200 }, { schema }))).toEqual({ v: 200 });
        });
    });

    describe('D13 — non-encodable values throw', () => {
        it('RegExp / Error / DataView / ArrayBuffer / function fields throw a Codec2 error', () => {
            let c = codec();

            expect(() => c.encode({ r: /x/ } as never)).toThrow('Codec2');
            expect(() => c.encode({ e: new Error('boom') } as never)).toThrow('Codec2');
            expect(() => c.encode({ d: new DataView(new ArrayBuffer(8)) } as never)).toThrow('Codec2');
            expect(() => c.encode({ a: new ArrayBuffer(8) } as never)).toThrow('Codec2');
            expect(() => c.encode({ f: () => 1 } as never)).toThrow('Codec2');
        });

        it('undefined field is kept as null', () => {
            let c = codec();

            expect(c.decode(c.encode({ a: undefined, b: 1 } as never))).toEqual({ a: null, b: 1 });
        });

        it('array holes are kept as null', () => {
            let c = codec(),
                arr = [1, , 3];

            expect(c.decode(c.encode({ arr }))).toEqual({ arr: [1, null, 3] });
        });
    });

    describe('D14 — empty buffer', () => {
        it('decode of a zero-length buffer throws Codec2: empty buffer', () => {
            let c = codec();

            expect(() => c.decode(new Uint8Array(0))).toThrow('Codec2: empty buffer');
        });
    });

    describe('D9 — bytes decode as Uint8Array', () => {
        it('top-level bytes decode with constructor === Uint8Array and deep-equal the input', () => {
            let c = codec(),
                input = new Uint8Array([1, 2, 3, 255, 0]),
                decoded = c.decode(c.encode(input)) as Uint8Array;

            expect(decoded.constructor).toBe(Uint8Array);
            expect(decoded).toEqual(input);
        });

        it('bytes field decodes as a Uint8Array copy (no pooled-buffer aliasing)', () => {
            let c = codec(),
                input = new Uint8Array([9, 8, 7]),
                decoded = c.decode(c.encode({ b: input })) as { b: Uint8Array };

            expect(decoded.b.constructor).toBe(Uint8Array);
            expect(decoded.b).toEqual(input);

            input[0] = 42;
            expect(decoded.b[0]).toBe(9);
        });
    });

    describe('malformed-input decode errors stay intact', () => {
        it('unknown tag and truncated headers still throw', () => {
            let c = codec();

            expect(() => c.decode(Uint8Array.from([15]))).toThrow('Codec2: unknown tag');
            expect(() => c.decode(Uint8Array.from([8, 1, 0, 0, 0]))).toThrow('Codec2: truncated');
        });
    });
});
