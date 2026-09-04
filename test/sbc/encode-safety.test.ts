import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


// D3, D9, D12, D13, D14 — encode/decode fail loud instead of OOM/corrupt/silent.
describe('sbc encode/decode safety', () => {
    describe('D3 — bigint int64 range', () => {
        it('encode(2n**64n) throws a Codec2 error immediately, no unbounded growth', () => {
            let c = codec(),
                start = performance.now();

            expect(() => c.encode(2n ** 64n)).toThrow(/@esportsplus\/data: codec bigint out of int64 range/);
            expect(performance.now() - start).toBeLessThan(100);
        });

        it('encode(2n**63n) (one past max) throws', () => {
            let c = codec();

            expect(() => c.encode(2n ** 63n)).toThrow('@esportsplus/data: codec bigint out of int64 range');
        });

        it('encode(-(2n**63n)-1n) (one below min) throws', () => {
            let c = codec();

            expect(() => c.encode(-(2n ** 63n) - 1n)).toThrow('@esportsplus/data: codec bigint out of int64 range');
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

            expect(() => c.encode({ big: 2n ** 100n })).toThrow('@esportsplus/data: codec bigint out of int64 range');
            expect(performance.now() - start).toBeLessThan(100);
        });
    });

    describe('D12 — hinted-path validation', () => {
        it('out-of-range numeric on a hinted uint8 field throws, naming the field', () => {
            let c = codec();

            expect(() => c.encode({ v: 300 }, { schema: [{ name: 'v', type: 'uint8' }] })).toThrow("@esportsplus/data: codec field 'v'");
        });

        it('non-numeric value on a hinted uint8 field throws, naming the field', () => {
            let c = codec();

            expect(() => c.encode({ v: 'not a number' } as never, { schema: [{ name: 'v', type: 'uint8' }] })).toThrow("@esportsplus/data: codec field 'v'");
        });

        it('missing non-nullable hinted field throws a named error', () => {
            let c = codec();

            expect(() => c.encode({} as never, { schema: [{ name: 'v', type: 'uint8' }] })).toThrow("@esportsplus/data: codec field 'v'");
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

            expect(() => c.encode({ r: /x/ } as never)).toThrow('@esportsplus/data: codec');
            expect(() => c.encode({ e: new Error('boom') } as never)).toThrow('@esportsplus/data: codec');
            expect(() => c.encode({ d: new DataView(new ArrayBuffer(8)) } as never)).toThrow('@esportsplus/data: codec');
            expect(() => c.encode({ a: new ArrayBuffer(8) } as never)).toThrow('@esportsplus/data: codec');
            expect(() => c.encode({ f: () => 1 } as never)).toThrow('@esportsplus/data: codec');
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
        it('decode of a zero-length buffer throws @esportsplus/data: codec empty buffer', () => {
            let c = codec();

            expect(() => c.decode(new Uint8Array(0))).toThrow('@esportsplus/data: codec empty buffer');
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

            expect(() => c.decode(Uint8Array.from([15]))).toThrow('@esportsplus/data: codec unknown tag');
            expect(() => c.decode(Uint8Array.from([8, 1, 0, 0, 0]))).toThrow('@esportsplus/data: codec truncated');
        });
    });

    // encode-growth-signal — overflow no longer rides the RangeError channel: a user RangeError
    // propagates instead of being swallowed by a grow-and-retry catch, and growth still survives.
    describe('encode-growth-signal — user RangeError propagates, growth stays bounded', () => {
        it('a getter that throws RangeError once then returns a number throws the user error, not swallowed by retry', () => {
            let c = codec(),
                obj = {},
                reads = 0;

            Object.defineProperty(obj, 'v', {
                enumerable: true,
                get() {
                    reads++;

                    if (reads === 1) {
                        throw new RangeError('user range error');
                    }

                    return 42;
                },
            });

            expect(() => c.encode(obj)).toThrow('user range error');
        });

        it('a getter that always throws RangeError propagates it unchanged, no multi-second growth stall', () => {
            let c = codec(),
                obj = {},
                start = performance.now();

            Object.defineProperty(obj, 'v', {
                enumerable: true,
                get() {
                    throw new RangeError('always boom');
                },
            });

            expect(() => c.encode(obj)).toThrow('always boom');
            expect(performance.now() - start).toBeLessThan(500);
        });

        it('a bytes field larger than the initial 64KB buffer round-trips', () => {
            let bytes = new Uint8Array(200000),
                c = codec();

            for (let i = 0, n = bytes.length; i < n; i++) {
                bytes[i] = i & 0xFF;
            }

            let decoded = c.decode(c.encode({ bytes })) as { bytes: Uint8Array };

            expect(decoded.bytes.length).toBe(bytes.length);
            expect(decoded.bytes[0]).toBe(0);
            expect(decoded.bytes[255]).toBe(255);
            expect(decoded.bytes[123456]).toBe(bytes[123456]);
        });

        it('a >1MB mixed payload (string + packed float64 array + nested objects) round-trips on the compiled path', () => {
            let c = codec(),
                data = {
                    floats: Array.from({ length: 50000 }, (_, i) => i * 0.5),
                    nested: { items: [1, 2, 3], label: 'z'.repeat(600000) },
                    text: 'q'.repeat(600000),
                };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('a >1MB packed float64 payload round-trips on the tagged (generic top-level) path', () => {
            let c = codec(),
                data = Float64Array.from({ length: 200000 }, (_, i) => i * 1.5),
                decoded = c.decode(c.encode(data)) as Float64Array;

            expect(decoded.constructor).toBe(Float64Array);
            expect(decoded.length).toBe(data.length);
            expect(decoded[199999]).toBe(data[199999]);
        });
    });
});
