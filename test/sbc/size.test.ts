import { describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';


const BOUNDARY_LENGTHS = [126, 127, 128, 200, 5000];


// Ground truth is always `instance.encode(value).length` on the SAME codec instance:
// this keeps every case self-checking and layout-agnostic — robust to the packed-tag
// unification and the schema-vocabulary rename, never a brittle hardcoded byte count.
function boolObject(count: number): Record<string, boolean> {
    let obj: Record<string, boolean> = {};

    for (let i = 0; i < count; i++) {
        obj['b' + i] = i % 2 === 0;
    }

    return obj;
}

// Values route through an `unknown` parameter so the static Encodable gate is laundered
// (unknown extends T ? T) — the runtime unrepresentable/unencodable backstops still fire,
// which is precisely the domain the throw cases assert.
function exactOn(instance: ReturnType<typeof codec>, value: unknown): void {
    expect(instance.computeSize(value)).toBe(instance.encode(value).length);
}

function expectExactSize(value: unknown): void {
    let compressed = codec({ compress: true }),
        plain = codec();

    expect(plain.computeSize(value)).toBe(plain.encode(value).length);
    expect(compressed.computeSize(value)).toBe(compressed.encode(value).length);
}

function expectExactSizeAll(values: unknown[]): void {
    for (let i = 0, n = values.length; i < n; i++) {
        expectExactSize(values[i]);
    }
}

function throwMessage(fn: () => unknown): string {
    try {
        fn();
    }
    catch (error) {
        return (error as Error).message;
    }

    throw new Error('Codec2Test: expected the call to throw, but it returned');
}

function expectSameThrow(value: unknown): void {
    let compressed = codec({ compress: true }),
        plain = codec(),
        encMessage = throwMessage(() => plain.encode(value));

    expect(encMessage).toMatch(/^Codec2:/);
    expect(throwMessage(() => plain.computeSize(value))).toBe(encMessage);
    expect(throwMessage(() => compressed.computeSize(value))).toBe(encMessage);
}


describe('Codec2 computeSize — exact encoded byte length', () => {

    // === CLAUSE A — the measured -1 / inexact divergences flip to exact equality ===

    describe('divergences that were the -1 / inexact defects now hold exact equality', () => {
        it('a plain numeric array sizes to its exact encoded length (was -1)', () => {
            expectExactSize([1, 2, 3]);
        });

        it('a non-Uint8Array typed array sizes to its exact encoded length (was -1)', () => {
            expectExactSize(new Uint16Array([1, 2, 65535]));
        });

        it('a nested object with a variable-width field sizes exactly (was -1)', () => {
            expectExactSize({ outer: { tags: ['x', 'y'] } });
        });

        it('a compressed bool+float object sizes exactly (was inexact)', () => {
            exactOn(codec({ compress: true }), { a: true, b: 1.5 });
        });
    });


    // === CLAUSE A — primitive corpus (Acceptance-defined pre-implementation invariants,
    //     kept as regression guards the total-walker rewrite must not break) ===

    describe('primitive corpus holds computeSize === encoded length', () => {
        it('integer width-boundary numbers', () => {
            expectExactSizeAll([0, 255, 256, 65535, 65536, -1, 2147483647, -2147483648]);
        });

        it('floats and -0/NaN/Infinity', () => {
            expectExactSizeAll([3.14, Infinity, -Infinity, NaN, -0]);
        });

        it('strings across the ASCII/multibyte and 16-17 length boundary', () => {
            expectExactSizeAll(['', 'hello world', 'café', '日本語', '😀🎉', 'a'.repeat(300)]);
        });

        it('bigint at the int64 edges (in range)', () => {
            expectExactSizeAll([0n, 1n, -1n, 2n ** 63n - 1n, -(2n ** 63n)]);
        });

        it('Date values', () => {
            expectExactSizeAll([new Date(0), new Date(1700000000000), new Date('2026-07-26T00:00:00Z')]);
        });

        it('booleans and null/undefined', () => {
            expectExactSizeAll([true, false, null, undefined]);
        });
    });


    // === CLAUSE A — container corpus ===

    describe('container corpus holds computeSize === encoded length', () => {
        it('Uint8Array at size boundaries', () => {
            expectExactSizeAll([new Uint8Array([]), new Uint8Array([1, 2, 3]), new Uint8Array(300)]);
        });

        it('every typed-array kind (tag 17: 6 + byteLength)', () => {
            expectExactSizeAll([
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

        it('packed numeric arrays at each classified width', () => {
            expectExactSizeAll([[0, 65535], [-5, 5], [1.5], [2 ** 40]]);
        });

        it('generic and nested arrays', () => {
            expectExactSizeAll([[], [1, 2, 3], [[1, 2], [3, 4]], [1, 'two', true]]);
        });

        it('plain and nested objects', () => {
            expectExactSizeAll([
                { a: 1, b: 2 },
                { outer: { inner: 5 } },
                { flag: true, ratio: 1.5 },
                { nested: { flag: true, ratio: 2.5 } },
            ]);
        });

        it('nullable object fields, null and non-null', () => {
            expectExactSizeAll([
                { a: 1, b: null },
                { x: null },
                { count: 3, name: 'hi', value: null },
            ]);
        });

        it('first-sample-null provisional shapes', () => {
            expectExactSizeAll([
                { data: null, id: 1 },
                { id: 2, tag: null },
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


    // === CLAUSE A — varint length-prefix boundaries ===

    describe('varint length-prefix boundaries hold exact equality', () => {
        it('string length-prefix boundaries (126,127,128,200,5000)', () => {
            for (let i = 0, n = BOUNDARY_LENGTHS.length; i < n; i++) {
                let s = 'a'.repeat(BOUNDARY_LENGTHS[i]!);

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

        it('nested-object payload prefix crossing the varint boundary', () => {
            for (let i = 0, n = BOUNDARY_LENGTHS.length; i < n; i++) {
                expectExactSize({ inner: { text: 'a'.repeat(BOUNDARY_LENGTHS[i]!) } });
            }
        });
    });


    // === CLAUSE A — compressed-mode shapes ===

    describe('compressed-mode shapes hold computeSize === compressed encoded length', () => {
        it('bool bitmaps at the 1/8/9/16-bool boundaries', () => {
            let counts = [1, 8, 9, 16];

            for (let i = 0, n = counts.length; i < n; i++) {
                exactOn(codec({ compress: true }), boolObject(counts[i]!));
            }
        });

        it('zigzag negative integers', () => {
            exactOn(codec({ compress: true }), { x: -5, y: -100000, z: -2147483648 });
        });

        it('adaptive float64: integer-valued vs real', () => {
            let cc = codec({ compress: true });

            // First non-integer sample fixes the field type to float64; both an integer
            // (adaptive 1 + varint) and a real (1 + 8) value must then size exactly.
            cc.encode({ m: 1.5 });
            exactOn(cc, { m: 5 });
            exactOn(cc, { m: 3.14 });
        });

        it('nullable interactions under compression', () => {
            exactOn(codec({ compress: true }), { flag: true, n: -3, note: null });
        });
    });


    // === CLAUSE B — domain agreement: computeSize throws exactly what encode throws ===

    describe('computeSize throws the same Codec2 error encode throws', () => {
        it('an out-of-int64 bigint throws the same Codec2 error', () => {
            expectSameThrow(2n ** 63n);
            expectSameThrow(-(2n ** 63n) - 1n);
        });

        it('a function throws the same Codec2 error', () => {
            expectSameThrow(() => {});
        });

        it('a symbol throws the same Codec2 error', () => {
            expectSameThrow(Symbol('x'));
        });

        it('a Map throws the same Codec2 error', () => {
            expectSameThrow(new Map([['a', 1]]));
        });

        it('a Set throws the same Codec2 error', () => {
            expectSameThrow(new Set([1, 2, 3]));
        });

        it('a RegExp throws the same Codec2 error', () => {
            expectSameThrow(/abc/);
        });

        it('a class instance throws the same Codec2 error', () => {
            class Point {
                x = 1;
                y = 2;
            }

            expectSameThrow(new Point());
        });

        it('a DataView throws the same Codec2 error', () => {
            expectSameThrow(new DataView(new ArrayBuffer(8)));
        });
    });
});
