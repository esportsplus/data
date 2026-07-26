import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


let c = codec(),
    cc = codec({ compress: true });


const BOUNDARY_LENGTHS = [126, 127, 128, 200, 5000];


// The universal invariant: computeSize must return exactly encode().byteLength,
// in BOTH the uncompressed (c) and compressed (cc) codec, for every encodable value.
// encode(v).length is the ground truth — this keeps every case self-checking, never
// a hardcoded brittle number.
function expectExactSize(value: unknown): void {
    expect(c.computeSize(value)).toBe(c.encode(value).length);
    expect(cc.computeSize(value)).toBe(cc.encode(value).length);
}

function expectExactSizeAll(values: unknown[]): void {
    for (let i = 0, n = values.length; i < n; i++) {
        expectExactSize(values[i]);
    }
}


describe('Codec2 computeSize — exact encoded byte length', () => {

    // === CLAUSE 1 — the three measured divergences flip to exact equality ===

    describe('clause 1 — measured divergences become exact', () => {
        it('compress {a:true,b:1.5}: computeSize equals encoded length (was 18 vs 19)', () => {
            let value = { a: true, b: 1.5 };

            expect(cc.encode(value).length).toBe(19);
            expect(cc.computeSize(value)).toBe(cc.encode(value).length);
        });

        it('a plain array: computeSize equals encoded length (was -1 vs 8)', () => {
            let value = [1, 2, 3];

            expect(c.encode(value).length).toBe(8);
            expect(c.computeSize(value)).toBe(c.encode(value).length);
        });

        it('a Map: computeSize equals encoded length (was -1 vs 13)', () => {
            let value = new Map<string, unknown>([['a', 1]]);

            expect(c.encode(value).length).toBe(13);
            expect(c.computeSize(value)).toBe(c.encode(value).length);
        });
    });


    // === CLAUSE 2 — property-style corpus: computeSize === encode().length everywhere ===

    describe('clause 2 — corpus holds computeSize === encoded length', () => {
        it('integer width-boundary primitives', () => {
            expectExactSizeAll([0, 255, 256, 65535, 65536, -1, 2147483647, -2147483648]);
        });

        it('floats (3.14, Infinity, -Infinity, NaN, -0)', () => {
            expectExactSizeAll([3.14, Infinity, -Infinity, NaN, -0]);
        });

        it('strings (empty, ASCII, unicode multi-byte)', () => {
            expectExactSizeAll(['', 'hello world', 'café', '日本語', '😀🎉', 'a'.repeat(300)]);
        });

        it('bigint at int64 edges', () => {
            expectExactSizeAll([0n, 1n, -1n, 2n ** 63n - 1n, -(2n ** 63n)]);
        });

        it('Date values', () => {
            expectExactSizeAll([new Date(0), new Date(1700000000000), new Date('2026-07-26T00:00:00Z')]);
        });

        it('booleans and null/undefined', () => {
            expectExactSizeAll([true, false, null, undefined]);
        });

        it('nested arrays', () => {
            expectExactSizeAll([[], [1, 2, 3], [0, 65535], [[1, 2], [3, 4]], [1, 'two', true]]);
        });

        it('nested objects', () => {
            expectExactSizeAll([
                { a: 1, b: 2 },
                { outer: { inner: 5 } },
                { flag: true, ratio: 1.5 },
                { nested: { flag: true, ratio: 2.5 } },
            ]);
        });

        it('Map values', () => {
            expectExactSizeAll([
                new Map(),
                new Map<string, unknown>([['a', 1]]),
                new Map<string, unknown>([['x', 1], ['y', 2]]),
                new Map<string, unknown>([['k', 'v'], ['n', 42]]),
            ]);
        });

        it('Set values', () => {
            expectExactSizeAll([
                new Set(),
                new Set([1, 2, 3]),
                new Set(['a', 'b']),
                new Set<unknown>([1, 'two', true]),
            ]);
        });

        it('typed arrays', () => {
            expectExactSizeAll([
                new Uint8Array([1, 2, 3]),
                new Uint8ClampedArray([1, 2, 3]),
                new Int8Array([-1, 2, -3]),
                new Uint16Array([1, 2, 65535]),
                new Int16Array([-1, 2, -30000]),
                new Uint32Array([1, 4000000000]),
                new Int32Array([-1, 2000000000]),
                new Float32Array([1.5, 2.5]),
                new Float64Array([1.5, -2.5]),
            ]);
        });

        it('nullable / null object fields', () => {
            expectExactSizeAll([
                { a: 1, b: null },
                { x: null },
                { count: 3, name: 'hi', value: null },
            ]);
        });

        it('mixed nested combinations', () => {
            expectExactSizeAll([
                { id: 1, meta: { active: true }, tags: ['a', 'b'] },
                { flag: false, labels: ['x', 'y'], values: [1, 2, 3] },
                { list: [1, 2, 3], name: 'x' },
            ]);
        });
    });


    // === CLAUSE 3 — varint length-prefix boundaries ===

    describe('clause 3 — length-prefix boundaries hold exact equality', () => {
        it('string length-prefix boundaries (126,127,128,200,5000)', () => {
            for (let i = 0, n = BOUNDARY_LENGTHS.length; i < n; i++) {
                let len = BOUNDARY_LENGTHS[i]!,
                    s = 'a'.repeat(len);

                expectExactSize(s);
                expectExactSize({ text: s });
            }
        });

        it('array length-prefix boundaries (126,127,128,200,5000)', () => {
            for (let i = 0, n = BOUNDARY_LENGTHS.length; i < n; i++) {
                let arr = new Array(BOUNDARY_LENGTHS[i]!).fill(1);

                expectExactSize(arr);
                expectExactSize({ items: arr });
            }
        });
    });


    // === CLAUSE 4 — non-encodable values throw the Codec2: class ===

    describe('clause 4 — computeSize throws on non-encodable values', () => {
        it('throws Codec2 on a non-encodable function', () => {
            expect(() => c.computeSize(() => {})).toThrow(/Codec2:/);
            expect(() => cc.computeSize(() => {})).toThrow(/Codec2:/);
        });

        it('throws Codec2 on a non-encodable symbol', () => {
            expect(() => c.computeSize(Symbol('x'))).toThrow(/Codec2:/);
            expect(() => cc.computeSize(Symbol('x'))).toThrow(/Codec2:/);
        });
    });
});
