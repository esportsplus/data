import { afterEach, describe, expect, it } from 'vitest';
import { codec } from '../../src/sbc';
import { FIELD_SIZES, KNOWN_TYPES } from '../../src/sbc/constants';
import { inferType } from '../../src/sbc/schema';

import type { PersistentStore } from '../../src/sbc';


type CountingStore = PersistentStore & {
    readonly sets: number;
    readonly size: number;
};

type Stored = Parameters<PersistentStore['set']>[1];


const POLLUTION_KEY = '__sbcInheritedEnumerableProbe';


function makeCountingStore(): CountingStore {
    let map = new Map<number, Stored>(),
        sets = 0;

    return {
        get: (hash: number) => map.get(hash) ?? null,
        set(hash: number, schema: Stored) {
            sets++;
            map.set(hash, schema);
        },
        get sets() {
            return sets;
        },
        get size() {
            return map.size;
        },
    };
}

function schemaHash(buf: Uint8Array): number {
    return (buf[1]! | (buf[2]! << 8) | (buf[3]! << 16) | (buf[4]! << 24)) >>> 0;
}


describe('Codec2', () => {
    let c = codec();


    // === PRIMITIVES ===

    describe('primitives', () => {
        it('null', () => {
            expect(c.decode(c.encode(null))).toBe(null);
        });

        it('undefined', () => {
            expect(c.decode(c.encode(undefined))).toBe(null);
        });

        it('boolean true', () => {
            expect(c.decode(c.encode(true))).toBe(true);
        });

        it('boolean false', () => {
            expect(c.decode(c.encode(false))).toBe(false);
        });

        it('uint8 (0)', () => {
            expect(c.decode(c.encode(0))).toBe(0);
        });

        it('uint8 (255)', () => {
            expect(c.decode(c.encode(255))).toBe(255);
        });

        it('uint8 (1)', () => {
            expect(c.decode(c.encode(1))).toBe(1);
        });

        it('int32 (256)', () => {
            expect(c.decode(c.encode(256))).toBe(256);
        });

        it('int32 (-1)', () => {
            expect(c.decode(c.encode(-1))).toBe(-1);
        });

        it('int32 (2147483647)', () => {
            expect(c.decode(c.encode(2147483647))).toBe(2147483647);
        });

        it('int32 (-2147483648)', () => {
            expect(c.decode(c.encode(-2147483648))).toBe(-2147483648);
        });

        it('float64 (3.14)', () => {
            expect(c.decode(c.encode(3.14))).toBe(3.14);
        });

        it('negative zero round-trips as -0 (top-level)', () => {
            expect(Object.is(c.decode(c.encode(-0)) as number, -0)).toBe(true);
        });

        it('negative zero round-trips inside an object field', () => {
            let decoded = c.decode(c.encode({ a: -0, b: 0 })) as { a: number; b: number };

            expect(Object.is(decoded.a, -0)).toBe(true);
            expect(Object.is(decoded.b, 0)).toBe(true);
        });

        it('negative zero round-trips inside a numeric array', () => {
            let decoded = c.decode(c.encode([-0, 0, -0])) as number[];

            expect(Object.is(decoded[0], -0)).toBe(true);
            expect(Object.is(decoded[1], 0)).toBe(true);
            expect(Object.is(decoded[2], -0)).toBe(true);
        });

        it('negative zero mixed with large ints in array preserves sign', () => {
            let decoded = c.decode(c.encode([-0, 100000, 0])) as number[];

            expect(Object.is(decoded[0], -0)).toBe(true);
            expect(decoded[1]).toBe(100000);
            expect(Object.is(decoded[2], 0)).toBe(true);
        });

        it('nested structure with -0 at multiple levels', () => {
            let data = { a: -0, b: [-0, 0], c: { d: -0 } },
                decoded = c.decode(c.encode(data)) as { a: number; b: number[]; c: { d: number } };

            expect(Object.is(decoded.a, -0)).toBe(true);
            expect(Object.is(decoded.b[0], -0)).toBe(true);
            expect(Object.is(decoded.b[1], 0)).toBe(true);
            expect(Object.is(decoded.c.d, -0)).toBe(true);
        });

        it('float64 (Infinity)', () => {
            expect(c.decode(c.encode(Infinity))).toBe(Infinity);
        });

        it('float64 (-Infinity)', () => {
            expect(c.decode(c.encode(-Infinity))).toBe(-Infinity);
        });

        it('float64 (NaN)', () => {
            expect(Number.isNaN(c.decode(c.encode(NaN)))).toBe(true);
        });

        it('float64 (Number.MAX_SAFE_INTEGER)', () => {
            expect(c.decode(c.encode(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
        });

        it('float64 (Number.MIN_SAFE_INTEGER)', () => {
            expect(c.decode(c.encode(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER);
        });

        it('string (empty)', () => {
            expect(c.decode(c.encode(''))).toBe('');
        });

        it('string (ascii)', () => {
            expect(c.decode(c.encode('hello'))).toBe('hello');
        });

        it('string (unicode)', () => {
            expect(c.decode(c.encode('こんにちは'))).toBe('こんにちは');
        });

        it('string (emoji)', () => {
            expect(c.decode(c.encode('hello 🌍🔥'))).toBe('hello 🌍🔥');
        });

        it('string (long > 16 chars)', () => {
            let s = 'a'.repeat(1000);

            expect(c.decode(c.encode(s))).toBe(s);
        });

        it('bigint', () => {
            expect(c.decode(c.encode(123456789012345678n))).toBe(123456789012345678n);
        });

        it('bigint (negative)', () => {
            expect(c.decode(c.encode(-99999999999n))).toBe(-99999999999n);
        });

        it('bigint (0n)', () => {
            expect(c.decode(c.encode(0n))).toBe(0n);
        });

        it('Date', () => {
            let d = new Date('2025-01-15T10:30:00Z'),
                decoded = c.decode(c.encode(d)) as Date;

            expect(decoded).toBeInstanceOf(Date);
            expect(decoded.getTime()).toBe(d.getTime());
        });

        it('Date (epoch)', () => {
            let d = new Date(0),
                decoded = c.decode(c.encode(d)) as Date;

            expect(decoded.getTime()).toBe(0);
        });

        it('Uint8Array', () => {
            let buf = new Uint8Array([1, 2, 3, 255, 0]),
                decoded = c.decode(c.encode(buf)) as Uint8Array;

            expect(decoded).toBeInstanceOf(Uint8Array);
            expect(Array.from(decoded)).toEqual([1, 2, 3, 255, 0]);
        });

        it('Uint8Array (empty)', () => {
            let buf = new Uint8Array(0),
                decoded = c.decode(c.encode(buf)) as Uint8Array;

            expect(decoded).toBeInstanceOf(Uint8Array);
            expect(decoded.length).toBe(0);
        });
    });


    // === ARRAYS ===

    describe('arrays', () => {
        it('empty array', () => {
            expect(c.decode(c.encode([]))).toEqual([]);
        });

        it('string array', () => {
            expect(c.decode(c.encode(['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
        });

        it('mixed type array', () => {
            let data = [1, 'two', true, null, 3.14];

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('nested array', () => {
            let data = [[1, 2], [3, 4], [5]];

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('packed uint8 array', () => {
            let data = [0, 1, 127, 255],
                encoded = c.encode(data);

            // [12][typeId 5 = uint8][u32 byteLen = 4]
            expect(encoded[0]).toBe(12);
            expect(encoded[1]).toBe(5);
            expect(encoded[2]! | (encoded[3]! << 8) | (encoded[4]! << 16) | (encoded[5]! << 24)).toBe(4);

            let decoded = c.decode(encoded) as number[];

            expect(Array.isArray(decoded)).toBe(true);
            expect(decoded).toEqual(data);
        });

        it('packed int32 array', () => {
            let data = [256, 1000, -1, 2147483647, -2147483648],
                encoded = c.encode(data);

            // [12][typeId 4 = int32][u32 byteLen = 20]
            expect(encoded[0]).toBe(12);
            expect(encoded[1]).toBe(4);
            expect(encoded[2]! | (encoded[3]! << 8) | (encoded[4]! << 16) | (encoded[5]! << 24)).toBe(20);

            let decoded = c.decode(encoded) as number[];

            expect(Array.isArray(decoded)).toBe(true);
            expect(decoded).toEqual(data);
        });

        it('packed float64 array', () => {
            let data = [1.1, 2.2, 3.3, NaN, Infinity],
                encoded = c.encode(data);

            // [12][typeId 1 = float64][u32 byteLen = 40]
            expect(encoded[0]).toBe(12);
            expect(encoded[1]).toBe(1);
            expect(encoded[2]! | (encoded[3]! << 8) | (encoded[4]! << 16) | (encoded[5]! << 24)).toBe(40);

            let decoded = c.decode(encoded) as number[];

            expect(decoded[0]).toBe(1.1);
            expect(decoded[1]).toBe(2.2);
            expect(decoded[2]).toBe(3.3);
            expect(Number.isNaN(decoded[3])).toBe(true);
            expect(decoded[4]).toBe(Infinity);
        });

        it('large uint8 array (100 elements)', () => {
            let data = Array.from({ length: 100 }, (_, i) => i % 256);

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('array of objects', () => {
            let data = [{ a: 1 }, { a: 2 }, { a: 3 }];

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('array with nested objects', () => {
            let data = [{ x: { y: 1 } }, { x: { y: 2 } }];

            expect(c.decode(c.encode(data))).toEqual(data);
        });
    });


    // === OBJECTS ===

    describe('objects', () => {
        it('simple object', () => {
            expect(c.decode(c.encode({ name: 'Alice' }))).toEqual({ name: 'Alice' });
        });

        it('multi-field object', () => {
            let data = { active: true, age: 30, name: 'Alice' };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('nested object', () => {
            let data = { address: { city: 'NYC', zip: '10001' }, name: 'Alice' };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('deeply nested object', () => {
            let data = { a: { b: { c: { d: { e: 42 } } } } };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('object with all types', () => {
            let data = {
                arr: [1, 2, 3],
                big: 123n,
                bool: true,
                date: new Date('2025-01-01'),
                float: 3.14,
                int: 42,
                nested: { x: 1 },
                nil: null,
                str: 'hello',
            };

            let decoded = c.decode(c.encode(data)) as Record<string, unknown>;

            expect(decoded.arr).toEqual([1, 2, 3]);
            expect(decoded.big).toBe(123n);
            expect(decoded.bool).toBe(true);
            expect((decoded.date as Date).getTime()).toBe(new Date('2025-01-01').getTime());
            expect(decoded.float).toBe(3.14);
            expect(decoded.int).toBe(42);
            expect(decoded.nested).toEqual({ x: 1 });
            expect(decoded.nil).toBe(null);
            expect(decoded.str).toBe('hello');
        });

        it('object with empty string key', () => {
            let data = { '': 'empty key' };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('object with unicode keys', () => {
            let data = { '名前': 'Alice', '年齢': 30 };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('object with many fields', () => {
            let data: Record<string, number> = {};

            for (let i = 0; i < 50; i++) {
                data[`field${i}`] = i;
            }

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('object with array field containing objects', () => {
            let data = { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] };

            expect(c.decode(c.encode(data))).toEqual(data);
        });
    });


    // === SCHEMA CACHE — SAME KEYS, DIFFERENT VALUE TYPES ===

    describe('same keys, different value types', () => {
        it('string then number for same key', () => {
            let c = codec(),
                a = { value: 'hello' },
                b = { value: 42 };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('number then string for same key', () => {
            let c = codec(),
                a = { value: 42 },
                b = { value: 'hello' };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('boolean then string for same key', () => {
            let c = codec(),
                a = { flag: true },
                b = { flag: 'yes' };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('null then object for same key', () => {
            let c = codec(),
                a = { data: null },
                b = { data: { x: 1 } };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('int then float for same key', () => {
            let c = codec(),
                a = { n: 42 },
                b = { n: 3.14 };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('uint8 then int32 for same key', () => {
            let c = codec(),
                a = { n: 100 },
                b = { n: 100000 };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('string then array for same key', () => {
            let c = codec(),
                a = { payload: 'text' },
                b = { payload: [1, 2, 3] };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('interleaved types — round robin', () => {
            let c = codec(),
                variants = [
                    { x: 'string' },
                    { x: 42 },
                    { x: true },
                    { x: null },
                    { x: [1, 2] },
                    { x: { nested: true } },
                    { x: 3.14 },
                    { x: 100000 },
                ];

            for (let v of variants) {
                let encoded = c.encode(v);

                expect(c.decode(encoded)).toEqual(v);
            }
        });

        it('multi-field object with type changes', () => {
            let c = codec(),
                a = { age: 30, name: 'Alice' },
                b = { age: 'thirty', name: 42 };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('same keys with object then null values', () => {
            let c = codec(),
                a = { meta: { created: 'today' }, name: 'Alice' },
                b = { meta: null, name: 'Bob' };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });
    });


    // === RING BUFFER CACHE EVICTION ===

    describe('ring buffer cache (16 slots)', () => {
        it('handles > 16 distinct schemas with eviction', () => {
            let c = codec(),
                schemas: Record<string, number>[] = [];

            for (let i = 0; i < 20; i++) {
                schemas.push({ [`key${i}`]: i });
            }

            // Encode all 20 — exceeds 16-slot ring buffer
            for (let s of schemas) {
                expect(c.decode(c.encode(s))).toEqual(s);
            }

            // Re-encode after eviction — schemas re-inferred
            for (let s of schemas) {
                expect(c.decode(c.encode(s))).toEqual(s);
            }
        });

        it('same object identity uses WeakMap', () => {
            let c = codec(),
                obj = { x: 1, y: 2, z: 3 };

            // Encode same reference multiple times
            for (let i = 0; i < 10; i++) {
                expect(c.decode(c.encode(obj))).toEqual(obj);
            }
        });

        it('fresh objects with same shape', () => {
            let c = codec();

            for (let i = 0; i < 20; i++) {
                let obj = { id: i, name: `item-${i}` };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            }
        });
    });


    // === NESTED OBJECT SCHEMAS ===

    describe('nested objects with distinct schemas', () => {
        it('parent and child have different schemas', () => {
            let data = {
                child: { x: 1, y: 2 },
                name: 'parent',
            };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('multiple nesting levels with different shapes', () => {
            let data = {
                level1: {
                    level2: {
                        level3: { value: 42 },
                        tag: 'deep',
                    },
                    count: 10,
                },
                root: true,
            };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('sibling objects with different schemas', () => {
            let data = {
                a: { x: 1 },
                b: { y: 'two', z: true },
            };

            expect(c.decode(c.encode(data))).toEqual(data);
        });
    });


    // === WIRE FORMAT ===

    describe('wire format', () => {
        it('object starts with tag 8', () => {
            let encoded = c.encode({ a: 1 });

            expect(encoded[0]).toBe(8);
        });

        it('null is tag 0', () => {
            let encoded = c.encode(null);

            expect(encoded[0]).toBe(0);
        });

        it('false is tag 1', () => {
            let encoded = c.encode(false);

            expect(encoded[0]).toBe(1);
        });

        it('true is tag 2', () => {
            let encoded = c.encode(true);

            expect(encoded[0]).toBe(2);
        });

        it('uint8 is tag 3', () => {
            let encoded = c.encode(42);

            expect(encoded[0]).toBe(3);
        });

        it('float64 is tag 4', () => {
            let encoded = c.encode(3.14);

            expect(encoded[0]).toBe(4);
        });

        it('string is tag 5', () => {
            let encoded = c.encode('hello');

            expect(encoded[0]).toBe(5);
        });

        it('Uint8Array is tag 6', () => {
            let encoded = c.encode(new Uint8Array([1]));

            expect(encoded[0]).toBe(6);
        });

        it('generic array is tag 7', () => {
            let encoded = c.encode(['a', 'b']);

            expect(encoded[0]).toBe(7);
        });

        it('bigint is tag 9', () => {
            let encoded = c.encode(42n);

            expect(encoded[0]).toBe(9);
        });

        it('Date is tag 10', () => {
            let encoded = c.encode(new Date());

            expect(encoded[0]).toBe(10);
        });

        it('int32 is tag 11', () => {
            let encoded = c.encode(-1);

            expect(encoded[0]).toBe(11);
        });
    });


    // === ENCODE view MODE ===

    describe('encode view mode', () => {
        it('returns subarray (view) when view=true', () => {
            let data = { name: 'Alice' },
                view = c.encode(data, true),
                copy = c.encode(data, false);

            expect(c.decode(view)).toEqual(data);
            expect(view.length).toBe(copy.length);
        });

        it('view is invalidated by next encode', () => {
            let a = { name: 'Alice' },
                viewA = c.encode(a, true);

            // Capture bytes before overwrite
            let bytesA = new Uint8Array(viewA);

            // Encode something else — overwrites shared buffer
            c.encode({ name: 'Bob' }, true);

            // viewA now points to corrupted data; bytesA is the safe snapshot
            expect(c.decode(bytesA)).toEqual(a);
        });
    });


    // === BUFFER GROWTH ===

    describe('buffer growth', () => {
        it('large string exceeds initial 64KB buffer', () => {
            let s = 'x'.repeat(100000),
                data = { big: s };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('large Uint8Array exceeds initial 64KB buffer', () => {
            let buf = new Uint8Array(100000);

            for (let i = 0; i < buf.length; i++) {
                buf[i] = i & 0xFF;
            }

            let decoded = c.decode(c.encode(buf)) as Uint8Array;

            expect(decoded.length).toBe(buf.length);
            expect(decoded[0]).toBe(0);
            expect(decoded[255]).toBe(255);
            expect(decoded[99999]).toBe(buf[99999]);
        });

        it('handles large array', () => {
            let data = Array.from({ length: 10000 }, (_, i) => i);

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('standalone string triggers tryEncodeSbc buffer doubling', () => {
            let s = 'x'.repeat(70000);

            expect(c.decode(c.encode(s))).toBe(s);
        });

        it('object with large field triggers tryEncode retry', () => {
            let data = { payload: 'y'.repeat(80000) };

            expect(c.decode(c.encode(data))).toEqual(data);
        });
    });


    // === EDGE CASES ===

    describe('edge cases', () => {
        it('empty object', () => {
            expect(c.decode(c.encode({}))).toEqual({});
        });

        it('object with undefined value', () => {
            let data = { a: undefined },
                decoded = c.decode(c.encode(data)) as Record<string, unknown>;

            // undefined maps to mixed → encodeSbc → tag 0 → decodes as null
            expect(decoded.a).toBe(null);
        });

        it('key ordering is deterministic (sorted)', () => {
            let c = codec(),
                a = { z: 1, a: 2, m: 3 },
                b = { a: 2, m: 3, z: 1 };

            // Both should produce identical wire bytes
            let encA = c.encode(a),
                encB = c.encode(b);

            expect(Array.from(encA)).toEqual(Array.from(encB));
        });

        it('number boundary: 255 is uint8, 256 is int32', () => {
            let c = codec(),
                a = { n: 255 },
                b = { n: 256 };

            let decA = c.decode(c.encode(a)) as { n: number },
                decB = c.decode(c.encode(b)) as { n: number };

            expect(decA.n).toBe(255);
            expect(decB.n).toBe(256);
        });

        it('array with single element', () => {
            expect(c.decode(c.encode([42]))).toEqual([42]);
        });

        it('array with single string', () => {
            expect(c.decode(c.encode(['hello']))).toEqual(['hello']);
        });

        it('decode with explicit length parameter', () => {
            let data = { name: 'test' },
                encoded = c.encode(data);

            expect(c.decode(encoded, encoded.length)).toEqual(data);
        });

        it('multiple codec instances are independent', () => {
            let c1 = codec(),
                c2 = codec();

            let data = { x: 1 },
                enc1 = c1.encode(data),
                enc2 = c2.encode(data);

            // Same wire format
            expect(Array.from(enc1)).toEqual(Array.from(enc2));

            // Cross-decode works because schemas have same hash
            expect(c1.decode(enc2)).toEqual(data);
            expect(c2.decode(enc1)).toEqual(data);
        });

        it('re-encoding after decode produces same bytes', () => {
            let data = { active: true, items: [1, 2, 3], name: 'test', score: 99.5 },
                enc1 = c.encode(data),
                decoded = c.decode(enc1) as typeof data,
                enc2 = c.encode(decoded);

            expect(Array.from(enc1)).toEqual(Array.from(enc2));
        });

        it('DataView throws the unrepresentable error (F-TEST-4)', () => {
            let ab = new ArrayBuffer(8),
                dv = new DataView(ab);

            dv.setFloat64(0, 3.14);

            // DataView is excluded from the typed-array branch and is not a plain
            // record, so the encoder rejects it with a named throw rather than
            // silently emitting tag 0 (null).
            expect(() => c.encode(dv)).toThrow('Codec2: unrepresentable value of type DataView');
        });
    });


    // === CROSS-INSTANCE SCHEMA COMPATIBILITY ===

    describe('cross-instance compatibility', () => {
        // Shared SIEVE cache enables cross-instance decode
        it('cross-instance decode via shared schema cache', () => {
            let c1 = codec(),
                c2 = codec(),
                data = { active: true, age: 30, name: 'Alice' };

            let enc = c1.encode(data);

            expect(c2.decode(enc)).toEqual(data);
        });

        it('schema hash differs for different key sets', () => {
            let c = codec(),
                a = c.encode({ x: 1 }),
                b = c.encode({ y: 1 });

            let hashA = a[1]! | (a[2]! << 8) | (a[3]! << 16) | (a[4]! << 24),
                hashB = b[1]! | (b[2]! << 8) | (b[3]! << 16) | (b[4]! << 24);

            expect(hashA).not.toBe(hashB);
        });

        it('schema hash differs for same keys with different types', () => {
            let c = codec(),
                a = c.encode({ value: 'string' }),
                b = c.encode({ value: 42 });

            let hashA = a[1]! | (a[2]! << 8) | (a[3]! << 16) | (a[4]! << 24),
                hashB = b[1]! | (b[2]! << 8) | (b[3]! << 16) | (b[4]! << 24);

            expect(hashA).not.toBe(hashB);
        });
    });


    // === BATCH 1 FIX COVERAGE ===

    describe('F-000+F-006: matchSchema type check + Object.keys', () => {
        it('ring buffer distinguishes same keys with different value types', () => {
            let c = codec();

            // First encode caches schema for {x: string}
            c.encode({ x: 'hello' });

            // Second encode must NOT reuse string schema for number value
            let enc = c.encode({ x: 42 }),
                dec = c.decode(enc) as { x: number };

            expect(dec.x).toBe(42);
            expect(typeof dec.x).toBe('number');
        });

        it('objects with inherited props encode only own properties', () => {
            let c = codec(),
                proto = { inherited: true },
                obj = Object.create(proto);

            obj.own = 42;

            let decoded = c.decode(c.encode(obj)) as Record<string, unknown>;

            expect(decoded.own).toBe(42);
            expect(decoded.inherited).toBeUndefined();
        });
    });


    describe('F-007: hash collision detection', () => {
        it('inferAndRegister verifies fields after hash lookup', () => {
            // Two objects with same keys, different types → different hashes → no collision
            let c = codec(),
                a = { val: 'text' },
                b = { val: 100 };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });
    });


    describe('F-001: mixed array with non-number elements', () => {
        it('array starting with number then string falls to generic', () => {
            let data = [1, 'two', 3];

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('array [number, boolean, null] round-trips', () => {
            let data = [42, true, null];

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('array [number, object] round-trips', () => {
            let data = [1, { x: 2 }];

            expect(c.decode(c.encode(data))).toEqual(data);
        });
    });


    describe('F-002+F-003: u32 count/length support', () => {
        it('string length uses u32 header (4 bytes after tag)', () => {
            let s = 'x'.repeat(1000),
                encoded = c.encode(s);

            // tag 5 + u32 LE length + data
            expect(encoded[0]).toBe(5);

            let len = (encoded[1]! | (encoded[2]! << 8) | (encoded[3]! << 16) | (encoded[4]! << 24)) >>> 0;

            expect(len).toBe(1000);
            expect(encoded.length).toBe(5 + 1000);
            expect(c.decode(encoded)).toBe(s);
        });

        it('array count uses u32 header (4 bytes after flag)', () => {
            let data = ['a', 'b', 'c'],
                encoded = c.encode(data);

            // tag 7 + u32 LE count + elements
            expect(encoded[0]).toBe(7);

            let count = (encoded[1]! | (encoded[2]! << 8) | (encoded[3]! << 16) | (encoded[4]! << 24)) >>> 0;

            expect(count).toBe(3);
        });

        it('UTF-8 string in schema-compiled object', () => {
            let data = { label: 'こんにちは' };

            expect(c.decode(c.encode(data))).toEqual(data);
        });
    });


    describe('F-004: decode depth limit', () => {
        it('moderately nested arrays decode fine', () => {
            let data: unknown = [1];

            for (let i = 0; i < 30; i++) {
                data = [data];
            }

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('deeply nested arrays throw depth error', () => {
            // Build a deeply nested array manually in wire format
            // Each nesting: tag 7 + u32 count=1 + ... = 5 bytes header per level
            let depth = 70,
                size = depth * 5 + 2, // 5 per array header + final uint8 element
                buf = new Uint8Array(size),
                p = 0;

            for (let i = 0; i < depth; i++) {
                buf[p] = 7; // tag: generic array
                buf[p + 1] = 1; // count = 1 (u32 LE)
                buf[p + 2] = 0;
                buf[p + 3] = 0;
                buf[p + 4] = 0;
                p += 5;
            }

            buf[p] = 3; // tag: uint8
            buf[p + 1] = 42; // value

            expect(() => c.decode(buf)).toThrow('max decode depth');
        });
    });


    describe('F-008: unknown tag throws', () => {
        it('decoding buffer with unknown tag throws', () => {
            let buf = new Uint8Array([99]); // tag 99 does not exist

            expect(() => c.decode(buf)).toThrow('unknown tag');
        });
    });


    // === BATCH 3 FIX COVERAGE ===

    describe('F-001 (run2): __proto__ prototype pollution', () => {
        it('object with __proto__ as own property round-trips safely', () => {
            let c = codec(),
                data = Object.create(null) as Record<string, unknown>;

            data['__proto__'] = 'safe';
            data['name'] = 'test';

            let encoded = c.encode(data),
                decoded = c.decode(encoded) as Record<string, unknown>;

            expect(decoded['__proto__']).toBe('safe');
            expect(decoded['name']).toBe('test');
            // Verify prototype chain excludes Object.prototype (frozen null-proto prototype)
            let proto = Object.getPrototypeOf(decoded);

            expect(proto).not.toBe(Object.prototype);
            expect(Object.getPrototypeOf(proto)).toBe(null);
            expect(Object.isFrozen(proto)).toBe(true);
        });

        it('decoded objects exclude Object.prototype from chain', () => {
            let data = { x: 1 },
                decoded = c.decode(c.encode(data)) as Record<string, unknown>;

            expect(decoded.x).toBe(1);

            let proto = Object.getPrototypeOf(decoded);

            expect(proto).not.toBe(Object.prototype);
            expect(Object.getPrototypeOf(proto)).toBe(null);
            expect((decoded as Record<string, unknown>).hasOwnProperty).toBeUndefined();
            expect((decoded as Record<string, unknown>).toString).toBeUndefined();
        });
    });


    describe('F-002 (run2): array count DoS guard', () => {
        it('huge array count in wire format throws', () => {
            // tag 7 (generic array) + count = 0x7FFFFFFF (2 billion)
            let buf = new Uint8Array([7, 0xFF, 0xFF, 0xFF, 0x7F]);

            expect(() => c.decode(buf)).toThrow('array count');
        });

        it('huge packed count (byteLen/bpe derived) throws', () => {
            // [12][typeId 5 = uint8, bpe 1][u32 byteLen = 0x7FFFFFFF] -> count 2^31-1 > MAX
            let buf = new Uint8Array([12, 5, 0xFF, 0xFF, 0xFF, 0x7F]);

            expect(() => c.decode(buf)).toThrow('array count');
        });

        it('normal-sized arrays still work', () => {
            let data = Array.from({ length: 1000 }, (_, i) => i);

            expect(c.decode(c.encode(data))).toEqual(data);
        });
    });


    describe('F-003 (run2): decode respects length parameter', () => {
        it('throws when the declared length truncates an array', () => {
            let encoded = c.encode(Array.from({ length: 11 }, (_, i) => i));

            expect(() => c.decode(encoded, 3)).toThrow(/^Codec2:/);
        });

        it('decode with length shorter than buffer ignores trailing bytes', () => {
            let data = { x: 42 },
                encoded = c.encode(data),
                extended = new Uint8Array(encoded.length + 10);

            extended.set(encoded);
            // Fill trailing bytes with garbage
            for (let i = encoded.length; i < extended.length; i++) {
                extended[i] = 0xFF;
            }

            expect(c.decode(extended, encoded.length)).toEqual(data);
        });

        it('decodes an oversized buffer with an exact object length', () => {
            let data = { x: 42 },
                encoded = c.encode(data),
                oversized = new Uint8Array(encoded.length + 10);

            oversized.set(encoded);

            expect(c.decode(oversized, encoded.length)).toEqual(data);
        });
    });


    describe('F-002 (run3): truncated string/bytes bounds check', () => {
        it('truncated string throws', () => {
            // tag 5 (string) + u32 length = 100, but only 5 bytes in buffer
            let buf = new Uint8Array([5, 100, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('truncated string');
        });

        it('truncated bytes throws', () => {
            // tag 6 (bytes) + u32 length = 50, but only 5 bytes in buffer
            let buf = new Uint8Array([6, 50, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('truncated bytes');
        });

        it('valid string still decodes', () => {
            let encoded = c.encode('hello world');

            expect(c.decode(encoded)).toBe('hello world');
        });

        it('truncated string inside schema-compiled object throws', () => {
            let c = codec();

            // Encode a valid object first to register the schema
            c.encode({ name: 'Alice' });

            // Now craft a buffer with valid tag-8 header but truncated string field
            let valid = c.encode({ name: 'Alice' }),
                truncated = valid.slice(0, valid.length - 3); // chop off end of string

            expect(() => c.decode(truncated)).toThrow('truncated');
        });
    });


    describe('fixed-width tag truncation guards', () => {
        let cases: Array<[number, number[]]> = [
            [3, [3]],
            [4, [4]],
            [9, [9]],
            [10, [10]],
            [11, [11, 1]],
            [17, [17, 1]],
        ];

        for (let [tag, bytes] of cases) {
            it('rejects a truncated tag ' + tag + ' directly and in an array', () => {
                let inner = new Uint8Array(bytes),
                    wrapped = new Uint8Array(5 + inner.length);

                wrapped[0] = 7;
                wrapped[1] = 1;
                wrapped.set(inner, 5);

                expect(() => c.decode(inner)).toThrow(/^Codec2:/);
                expect(() => c.decode(wrapped)).toThrow(/^Codec2:/);
            });
        }
    });


    describe('packed array truncation (F-TEST-3)', () => {
        it('truncated packed array (tag 12) payload throws via decodeTagEnd', () => {
            // [12][typeId 5 = uint8][u32 byteLen = 5] + only 2 payload bytes (need 5)
            // Wrap in tag 7 (generic array, count=1) so decodeTagEnd is called
            let inner = new Uint8Array([12, 5, 5, 0, 0, 0, 0xAA, 0xBB]),
                buf = new Uint8Array(5 + inner.length);

            buf[0] = 7; // tag 7 = generic array
            buf[1] = 1; buf[2] = 0; buf[3] = 0; buf[4] = 0; // count = 1
            buf.set(inner, 5);

            expect(() => c.decode(buf)).toThrow('truncated packed array');
        });

        it('truncated packed array (tag 12) header throws via direct decodeSbc', () => {
            let c = codec();

            // [12][typeId 5] — only 2 bytes, 6-byte header cannot be read
            expect(() => c.decode(new Uint8Array([12, 5]))).toThrow('truncated packed array');
        });

        it('truncated packed array (tag 12) payload throws via direct decodeSbc', () => {
            let c = codec();

            // [12][typeId 5 = uint8][u32 byteLen = 5] + only 2 payload bytes — no tag-7 wrapper
            expect(() => c.decode(new Uint8Array([12, 5, 5, 0, 0, 0, 0xAA, 0xBB]))).toThrow('truncated packed array');
        });

        it('misaligned packed byteLen (tag 12) throws', () => {
            let c = codec();

            // [12][typeId 3 = int16, bpe 2][u32 byteLen = 5] — 5 % 2 !== 0
            expect(() => c.decode(new Uint8Array([12, 3, 5, 0, 0, 0]))).toThrow('not aligned');
        });

        it('retired tag 13 throws unknown tag via decodeTagEnd', () => {
            // tag 13 wrapped in a tag-7 generic array so decodeTagEnd sees it
            let inner = new Uint8Array([13, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                buf = new Uint8Array(5 + inner.length);

            buf[0] = 7;
            buf[1] = 1; buf[2] = 0; buf[3] = 0; buf[4] = 0;
            buf.set(inner, 5);

            expect(() => c.decode(buf)).toThrow('unknown tag 13');
        });

        it('retired tag 13 throws unknown tag via direct decodeSbc', () => {
            let c = codec();

            expect(() => c.decode(new Uint8Array([13, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow('unknown tag 13');
        });

        it('retired tag 14 throws unknown tag via decodeTagEnd', () => {
            let inner = new Uint8Array([14, 3, 0, 0, 0, 0, 0, 0, 0]),
                buf = new Uint8Array(5 + inner.length);

            buf[0] = 7;
            buf[1] = 1; buf[2] = 0; buf[3] = 0; buf[4] = 0;
            buf.set(inner, 5);

            expect(() => c.decode(buf)).toThrow('unknown tag 14');
        });

        it('retired tag 14 throws unknown tag via direct decodeSbc', () => {
            let c = codec();

            expect(() => c.decode(new Uint8Array([14, 3, 0, 0, 0, 0, 0, 0, 0]))).toThrow('unknown tag 14');
        });
    });


    describe('F-001: tag-17 typed array bounds check', () => {
        it('oversized bLen on a subarray view throws instead of reading adjacent memory', () => {
            let source = new Int16Array([1, 2, 3, 4]),
                encoded = c.encode(source);

            expect(encoded[0]).toBe(17);

            // Rebuild the tag-17 header into a larger backing buffer whose trailing
            // bytes hold a "secret" pattern the view must never expose.
            let backing = new Uint8Array(128).fill(0xAA);

            backing.set(encoded.subarray(0, 6), 0);

            // Inflate the declared byteLength far past the logical view (bpe-aligned).
            let bLen = 100;

            backing[2] = bLen & 0xFF;
            backing[3] = (bLen >>> 8) & 0xFF;
            backing[4] = (bLen >>> 16) & 0xFF;
            backing[5] = (bLen >>> 24) & 0xFF;

            let view = backing.subarray(0, encoded.length);

            expect(() => c.decode(view)).toThrow('truncated typed array');
        });

        it('valid typed array still round-trips', () => {
            let source = new Int16Array([1, 2, 3, 4]),
                decoded = c.decode(c.encode(source)) as Int16Array;

            expect(decoded).toBeInstanceOf(Int16Array);
            expect(Array.from(decoded)).toEqual([1, 2, 3, 4]);
        });
    });


    // === TYPED ARRAYS ===

    describe('Typed Arrays', () => {
        it('Float32Array round-trip', () => {
            let ta = new Float32Array([1.5, 2.5, 3.5]);
            let result = c.decode(c.encode(ta)) as Float32Array;

            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(3);
            expect(result[0]).toBeCloseTo(1.5);
            expect(result[1]).toBeCloseTo(2.5);
            expect(result[2]).toBeCloseTo(3.5);
        });

        it('Float64Array round-trip', () => {
            let ta = new Float64Array([Math.PI, Math.E]);
            let result = c.decode(c.encode(ta)) as Float64Array;

            expect(result).toBeInstanceOf(Float64Array);
            expect(result[0]).toBe(Math.PI);
            expect(result[1]).toBe(Math.E);
        });

        it('Int8Array round-trip', () => {
            let ta = new Int8Array([-128, 0, 127]);
            let result = c.decode(c.encode(ta)) as Int8Array;

            expect(result).toBeInstanceOf(Int8Array);
            expect([...result]).toEqual([-128, 0, 127]);
        });

        it('Int16Array round-trip', () => {
            let ta = new Int16Array([-32768, 0, 32767]);
            let result = c.decode(c.encode(ta)) as Int16Array;

            expect(result).toBeInstanceOf(Int16Array);
            expect([...result]).toEqual([-32768, 0, 32767]);
        });

        it('Int32Array round-trip', () => {
            let ta = new Int32Array([-2147483648, 0, 2147483647]);
            let result = c.decode(c.encode(ta)) as Int32Array;

            expect(result).toBeInstanceOf(Int32Array);
            expect([...result]).toEqual([-2147483648, 0, 2147483647]);
        });

        it('Uint8ClampedArray round-trip', () => {
            let ta = new Uint8ClampedArray([0, 128, 255]);
            let result = c.decode(c.encode(ta)) as Uint8ClampedArray;

            expect(result).toBeInstanceOf(Uint8ClampedArray);
            expect([...result]).toEqual([0, 128, 255]);
        });

        it('Uint16Array round-trip', () => {
            let ta = new Uint16Array([0, 1000, 65535]);
            let result = c.decode(c.encode(ta)) as Uint16Array;

            expect(result).toBeInstanceOf(Uint16Array);
            expect([...result]).toEqual([0, 1000, 65535]);
        });

        it('Uint32Array round-trip', () => {
            let ta = new Uint32Array([0, 100000, 4294967295]);
            let result = c.decode(c.encode(ta)) as Uint32Array;

            expect(result).toBeInstanceOf(Uint32Array);
            expect([...result]).toEqual([0, 100000, 4294967295]);
        });

        it('BigInt64Array round-trip', () => {
            let ta = new BigInt64Array([BigInt('-9223372036854775808'), 0n, BigInt('9223372036854775807')]);
            let result = c.decode(c.encode(ta)) as BigInt64Array;

            expect(result).toBeInstanceOf(BigInt64Array);
            expect(result[0]).toBe(BigInt('-9223372036854775808'));
            expect(result[2]).toBe(BigInt('9223372036854775807'));
        });

        it('BigUint64Array round-trip', () => {
            let ta = new BigUint64Array([0n, BigInt('18446744073709551615')]);
            let result = c.decode(c.encode(ta)) as BigUint64Array;

            expect(result).toBeInstanceOf(BigUint64Array);
            expect(result[0]).toBe(0n);
            expect(result[1]).toBe(BigInt('18446744073709551615'));
        });

        it('empty typed array', () => {
            let ta = new Float32Array(0);
            let result = c.decode(c.encode(ta)) as Float32Array;

            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(0);
        });

        it('large typed array', () => {
            let ta = new Int32Array(10000);

            for (let i = 0; i < 10000; i++) {
                ta[i] = i;
            }

            let result = c.decode(c.encode(ta)) as Int32Array;

            expect(result.length).toBe(10000);
            expect(result[0]).toBe(0);
            expect(result[9999]).toBe(9999);
        });

        it('plain Uint8Array still uses tag 6', () => {
            let ta = new Uint8Array([1, 2, 3]);
            let encoded = c.encode(ta);

            expect(encoded[0]).toBe(6);

            let result = c.decode(encoded) as Uint8Array;

            expect(result).toBeInstanceOf(Uint8Array);
            expect([...result]).toEqual([1, 2, 3]);
        });

        it('typed array in object field', () => {
            let obj = { data: new Float32Array([1.0, 2.0]) };
            let result = c.decode(c.encode(obj)) as Record<string, unknown>;
            let ta = result.data as Float32Array;

            expect(ta).toBeInstanceOf(Float32Array);
            expect(ta.length).toBe(2);
        });
    });


    // === DECODE AT ===

    describe('decodeAt', () => {
        it('decode object at non-zero offset', () => {
            let obj = { name: 'Alice' },
                encoded = c.encode(obj),
                padded = new Uint8Array(10 + encoded.length);

            padded.set(encoded, 10);

            expect(c.decodeAt(padded, 10)).toEqual(obj);
        });

        it('decode primitive at offset', () => {
            let encoded = c.encode(42),
                padded = new Uint8Array(5 + encoded.length);

            padded.set(encoded, 5);

            expect(c.decodeAt(padded, 5)).toBe(42);
        });

        it('decode string at offset', () => {
            let encoded = c.encode('hello'),
                padded = new Uint8Array(3 + encoded.length);

            padded.set(encoded, 3);

            expect(c.decodeAt(padded, 3)).toBe('hello');
        });

        it('decode array at offset', () => {
            let arr = [1, 2, 3],
                encoded = c.encode(arr),
                padded = new Uint8Array(7 + encoded.length);

            padded.set(encoded, 7);

            expect(c.decodeAt(padded, 7)).toEqual(arr);
        });

        it('decode null at offset', () => {
            let encoded = c.encode(null),
                padded = new Uint8Array(2 + encoded.length);

            padded.set(encoded, 2);

            expect(c.decodeAt(padded, 2)).toBe(null);
        });

        it('decode boolean at offset', () => {
            let encoded = c.encode(true),
                padded = new Uint8Array(4 + encoded.length);

            padded.set(encoded, 4);

            expect(c.decodeAt(padded, 4)).toBe(true);
        });

        it('decode multiple values concatenated', () => {
            let a = c.encode('hello'),
                b = c.encode(42),
                x = c.encode({ x: 1 }),
                combined = new Uint8Array(a.length + b.length + x.length);

            combined.set(a, 0);
            combined.set(b, a.length);
            combined.set(x, a.length + b.length);

            expect(c.decodeAt(combined, 0)).toBe('hello');
            expect(c.decodeAt(combined, a.length)).toBe(42);
            expect(c.decodeAt(combined, a.length + b.length)).toEqual({ x: 1 });
        });
    });


    // === DEFINE SCHEMA ===

    describe('defineSchema', () => {
        it('pre-registered schema encodes/decodes with its declared widths', () => {
            let c = codec();
            let h = c.defineSchema([
                { name: 'age', type: 'int32' },
                { name: 'name', type: 'string' },
            ]);

            let obj = { age: 25, name: 'Alice' },
                buf = c.encode(obj);

            // Declared int32 is honored over the uint8 inference would pick for 25 —
            // the emitted hash is the declared hash, not an inferred one.
            expect(schemaHash(buf)).toBe(h);
            expect(c.decode(buf)).toEqual(obj);
        });

        it('returns consistent hash for same fields', () => {
            let c = codec();
            let h1 = c.defineSchema([
                { name: 'x', type: 'int32' },
                { name: 'y', type: 'int32' },
            ]);
            let h2 = c.defineSchema([
                { name: 'x', type: 'int32' },
                { name: 'y', type: 'int32' },
            ]);

            expect(h1).toBe(h2);
        });

        it('sorts fields alphabetically', () => {
            let c = codec();

            c.defineSchema([
                { name: 'z', type: 'string' },
                { name: 'a', type: 'uint8' },
            ]);

            let obj = { a: 1, z: 'test' };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('matches auto-inferred schema hash', () => {
            let c = codec();
            let obj = { active: true, name: 'Bob' };

            let inferred = c.encode(obj).slice();

            let hash = c.defineSchema([
                { name: 'active', type: 'boolean' },
                { name: 'name', type: 'string' },
            ]);

            // The declared shape hash equals the hash inference already minted for
            // this object — declaring after inferring is idempotent.
            expect(hash).toBe(schemaHash(inferred));
            expect(schemaHash(c.encode(obj))).toBe(hash);
            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('schema with all fixed types', () => {
            let c = codec();

            c.defineSchema([
                { name: 'a', type: 'uint8' },
                { name: 'b', type: 'int32' },
                { name: 'c', type: 'float64' },
                { name: 'd', type: 'boolean' },
            ]);

            let obj = { a: 42, b: -1000, c: 3.14, d: true };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('schema with variable types', () => {
            let c = codec();

            c.defineSchema([
                { name: 'data', type: 'bytes' },
                { name: 'label', type: 'string' },
            ]);

            let obj = { data: new Uint8Array([1, 2, 3]), label: 'test' };
            let result = c.decode(c.encode(obj)) as Record<string, unknown>;

            expect(result.label).toBe('test');
            expect([...(result.data as Uint8Array)]).toEqual([1, 2, 3]);
        });

        it('schema with mixed type', () => {
            let c = codec();

            c.defineSchema([
                { name: 'id', type: 'uint8' },
                { name: 'value', type: 'mixed' },
            ]);

            expect(c.decode(c.encode({ id: 1, value: 'hello' }))).toEqual({ id: 1, value: 'hello' });
            expect(c.decode(c.encode({ id: 2, value: 42 }))).toEqual({ id: 2, value: 42 });
        });

    });


    // === NULLABLE FIELDS ===

    describe('nullable fields', () => {
        it('nullable string field — non-null', () => {
            let c = codec();

            c.defineSchema([
                { name: 'name', type: 'string' },
                { name: 'email', type: 'string', nullable: true },
            ]);

            let obj = { email: 'alice@test.com', name: 'Alice' };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('nullable string field — null', () => {
            let c = codec();

            c.defineSchema([
                { name: 'name', type: 'string' },
                { name: 'email', type: 'string', nullable: true },
            ]);

            let obj = { email: null, name: 'Alice' };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('nullable uint8 field', () => {
            let c = codec();

            c.defineSchema([
                { name: 'age', type: 'uint8', nullable: true },
                { name: 'name', type: 'string' },
            ]);

            expect(c.decode(c.encode({ age: 25, name: 'Bob' }))).toEqual({ age: 25, name: 'Bob' });
            expect(c.decode(c.encode({ age: null, name: 'Bob' }))).toEqual({ age: null, name: 'Bob' });
        });

        it('multiple nullable fields — mixed null/non-null', () => {
            let c = codec();

            c.defineSchema([
                { name: 'a', type: 'string', nullable: true },
                { name: 'b', type: 'int32', nullable: true },
                { name: 'c', type: 'float64', nullable: true },
                { name: 'id', type: 'uint8' },
            ]);

            let obj = { a: null, b: 42, c: null, id: 1 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('all nullable fields null', () => {
            let c = codec();

            c.defineSchema([
                { name: 'a', type: 'string', nullable: true },
                { name: 'b', type: 'int32', nullable: true },
                { name: 'id', type: 'uint8' },
            ]);

            let obj = { a: null, b: null, id: 5 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('all nullable fields present', () => {
            let c = codec();

            c.defineSchema([
                { name: 'a', type: 'string', nullable: true },
                { name: 'b', type: 'int32', nullable: true },
                { name: 'id', type: 'uint8' },
            ]);

            let obj = { a: 'hello', b: -100, id: 5 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('max 16 nullable fields', () => {
            let c = codec();
            let fields: { name: string; type: 'uint8'; nullable: true }[] = [];

            for (let i = 0; i < 16; i++) {
                fields.push({ name: `f${String(i).padStart(2, '0')}`, type: 'uint8', nullable: true });
            }

            let hash = c.defineSchema(fields);

            expect(typeof hash).toBe('number');

            let obj: Record<string, number | null> = {};

            for (let i = 0; i < 16; i++) {
                obj[`f${String(i).padStart(2, '0')}`] = i % 2 === 0 ? i : null;
            }

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('throws if >16 nullable fields', () => {
            let c = codec();
            let fields: { name: string; type: 'uint8'; nullable: true }[] = [];

            for (let i = 0; i < 17; i++) {
                fields.push({ name: `f${String(i).padStart(2, '0')}`, type: 'uint8', nullable: true });
            }

            expect(() => c.defineSchema(fields)).toThrow('max 16 nullable');
        });

        it('nullable boolean field', () => {
            let c = codec();

            c.defineSchema([
                { name: 'active', type: 'boolean', nullable: true },
                { name: 'name', type: 'string' },
            ]);

            expect(c.decode(c.encode({ active: true, name: 'X' }))).toEqual({ active: true, name: 'X' });
            expect(c.decode(c.encode({ active: false, name: 'X' }))).toEqual({ active: false, name: 'X' });
            expect(c.decode(c.encode({ active: null, name: 'X' }))).toEqual({ active: null, name: 'X' });
        });

        it('nullable nested object field', () => {
            let c = codec();

            c.defineSchema([
                { name: 'addr', type: 'object', nullable: true },
                { name: 'name', type: 'string' },
            ]);

            let obj1 = { addr: { city: 'NYC' }, name: 'Alice' };
            let result1 = c.decode(c.encode(obj1)) as Record<string, unknown>;

            expect(result1.name).toBe('Alice');
            expect((result1.addr as Record<string, string>).city).toBe('NYC');

            let obj2 = { addr: null, name: 'Bob' };

            expect(c.decode(c.encode(obj2))).toEqual(obj2);
        });

        it('undefined treated as null for nullable fields', () => {
            let c = codec();

            c.defineSchema([
                { name: 'name', type: 'string' },
                { name: 'note', type: 'string', nullable: true },
            ]);

            let obj = { name: 'Alice', note: undefined };
            let result = c.decode(c.encode(obj)) as Record<string, unknown>;

            expect(result.name).toBe('Alice');
            expect(result.note).toBe(null);
        });
    });


    // === EXTRACT FIELD ===

    describe('extractField', () => {
        it('extract fixed-size field (O(1))', () => {
            let c = codec();

            c.defineSchema([
                { name: 'active', type: 'boolean' },
                { name: 'age', type: 'uint8' },
                { name: 'score', type: 'int32' },
            ]);

            let encoded = c.encode({ active: true, age: 30, score: -500 });

            expect(c.extractField(encoded, 'active')).toBe(true);
            expect(c.extractField(encoded, 'age')).toBe(30);
            expect(c.extractField(encoded, 'score')).toBe(-500);
        });

        it('extract string field', () => {
            let c = codec();

            c.defineSchema([
                { name: 'id', type: 'uint8' },
                { name: 'name', type: 'string' },
            ]);

            let encoded = c.encode({ id: 1, name: 'Alice' });

            expect(c.extractField(encoded, 'name')).toBe('Alice');
            expect(c.extractField(encoded, 'id')).toBe(1);
        });

        it('extract field after variable-size field', () => {
            let c = codec();

            c.defineSchema([
                { name: 'label', type: 'string' },
                { name: 'value', type: 'int32' },
            ]);

            let encoded = c.encode({ label: 'test', value: 42 });

            expect(c.extractField(encoded, 'value')).toBe(42);
        });

        it('extract nullable field — non-null', () => {
            let c = codec();

            c.defineSchema([
                { name: 'name', type: 'string' },
                { name: 'note', type: 'string', nullable: true },
            ]);

            let encoded = c.encode({ name: 'Alice', note: 'hello' });

            expect(c.extractField(encoded, 'note')).toBe('hello');
        });

        it('extract nullable field — null', () => {
            let c = codec();

            c.defineSchema([
                { name: 'name', type: 'string' },
                { name: 'note', type: 'string', nullable: true },
            ]);

            let encoded = c.encode({ name: 'Alice', note: null });

            expect(c.extractField(encoded, 'note')).toBe(null);
        });

        it('returns undefined for non-tag-8 buffer', () => {
            let c = codec(),
                encoded = c.encode('hello');

            expect(c.extractField(encoded, 'anything')).toBeUndefined();
        });

        it('returns undefined for unknown field', () => {
            let c = codec();

            c.defineSchema([{ name: 'x', type: 'uint8' }]);

            let encoded = c.encode({ x: 1 });

            expect(c.extractField(encoded, 'nonexistent')).toBeUndefined();
        });

        it('extract bytes field', () => {
            let c = codec();

            c.defineSchema([
                { name: 'data', type: 'bytes' },
                { name: 'id', type: 'uint8' },
            ]);

            let encoded = c.encode({ data: new Uint8Array([10, 20, 30]), id: 5 });
            let extracted = c.extractField(encoded, 'data') as Uint8Array;

            expect([...extracted]).toEqual([10, 20, 30]);
            expect(c.extractField(encoded, 'id')).toBe(5);
        });

        it('extract from auto-inferred schema', () => {
            let c = codec(),
                encoded = c.encode({ age: 25, name: 'Bob' });

            expect(c.extractField(encoded, 'name')).toBe('Bob');
            expect(c.extractField(encoded, 'age')).toBe(25);
        });

        it('extract nested object field', () => {
            let c = codec(),
                encoded = c.encode({ addr: { city: 'NYC' }, name: 'Alice' });
            let addr = c.extractField(encoded, 'addr') as Record<string, string>;

            expect(addr.city).toBe('NYC');
        });

    });


    // === COMPUTE SIZE ===

    describe('computeSize', () => {
        it('null', () => {
            expect(c.computeSize(null)).toBe(1);
        });

        it('undefined', () => {
            expect(c.computeSize(undefined)).toBe(1);
        });

        it('boolean', () => {
            expect(c.computeSize(true)).toBe(1);
        });

        it('uint8 (0)', () => {
            expect(c.computeSize(0)).toBe(2);
        });

        it('uint8 (255)', () => {
            expect(c.computeSize(255)).toBe(2);
        });

        it('int32', () => {
            expect(c.computeSize(256)).toBe(5);
        });

        it('float64', () => {
            expect(c.computeSize(3.14)).toBe(9);
        });

        it('bigint', () => {
            expect(c.computeSize(123n)).toBe(9);
        });

        it('string', () => {
            expect(c.computeSize('hello')).toBe(5 + 5);
        });

        it('empty string', () => {
            expect(c.computeSize('')).toBe(5);
        });

        it('date', () => {
            expect(c.computeSize(new Date())).toBe(9);
        });

        it('Uint8Array', () => {
            expect(c.computeSize(new Uint8Array(10))).toBe(15);
        });

        it('matches actual encoded size for primitives', () => {
            let values: unknown[] = [null, true, false, 0, 255, 256, -1, 3.14, 'hello', '', 123n, new Date(0), new Uint8Array([1, 2, 3])];

            for (let v of values) {
                expect(c.computeSize(v)).toBe(c.encode(v).length);
            }
        });

        it('plain object with fixed fields', () => {
            let obj = { active: true, age: 25, score: -500 },
                size = c.computeSize(obj);

            expect(size).toBe(c.encode(obj).length);
        });

        it('plain object with string field', () => {
            let obj = { id: 1, name: 'Alice' },
                size = c.computeSize(obj);

            expect(size).toBe(c.encode(obj).length);
        });

        it('typed array sizes exactly (6 + byteLength)', () => {
            let arr = new Float32Array(3);

            expect(c.computeSize(arr)).toBe(6 + arr.byteLength);
            expect(c.computeSize(arr)).toBe(c.encode(arr).length);
        });

        it('array sizes exactly', () => {
            let arr = [1, 2, 3];

            expect(c.computeSize(arr)).toBe(c.encode(arr).length);
        });

        it('object with a first-sample-null field sizes exactly (nullable inference, not the -1 sentinel)', () => {
            // 'data' first samples null, so it registers nullable (bitmap-tracked) instead
            // of falling through computeSize's unlisted-type -1 arm.
            let obj = { data: null, id: 1 };

            expect(c.computeSize(obj)).toBe(c.encode(obj).length);
        });

        it('object with only fixed and string fields', () => {
            let withNote = { name: 'Alice', note: 'hello' },
                sizeWith = c.computeSize(withNote);

            expect(sizeWith).toBe(c.encode(withNote).length);
        });

        it('nested object', () => {
            let obj = { addr: { city: 'NYC' }, name: 'Alice' },
                size = c.computeSize(obj);

            expect(size).toBe(c.encode(obj).length);
        });
    });


    // === COMPRESSION ===

    describe('compression', () => {
        it('compressed and uncompressed produce equivalent results', () => {
            let normal = codec(),
                comp = codec({ compress: true }),
                obj = { age: 25, name: 'Alice', score: 3.14 };

            // Register schema on both instances first
            normal.encode(obj);
            comp.encode(obj);

            expect(comp.decode(comp.encode(obj))).toEqual(obj);
            expect(normal.decode(comp.encode(obj))).toEqual(obj);
            expect(comp.decode(normal.encode(obj))).toEqual(obj);
        });

        it('compressed objects use tag 18', () => {
            let c = codec({ compress: true }),
                obj = { active: true, age: 25, name: 'Alice' };

            expect(c.encode(obj)[0]).toBe(18);
        });

        it('non-compressible schema uses tag 8', () => {
            let c = codec({ compress: true }),
                obj = { label: 'test', name: 'Alice' };

            expect(c.encode(obj)[0]).toBe(8);
        });

        it('varint edge cases', () => {
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'a', type: 'uint16' },
                { name: 'b', type: 'uint16' },
                { name: 'c', type: 'uint32' },
                { name: 'd', type: 'uint32' },
                { name: 'e', type: 'uint32' },
            ]);

            let obj = { a: 0, b: 127, c: 128, d: 16383, e: 16384 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('roundtrips value requiring 4-byte varint (2097152)', () => {
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'small', type: 'uint32' },
                { name: 'big', type: 'uint32' },
            ]);

            // 2097152 = 2^21, first value needing 4-byte varint
            let obj = { small: 42, big: 2097152 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('roundtrips value requiring 5-byte varint (268435456)', () => {
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'count', type: 'uint32' },
            ]);

            // 268435456 = 2^28, first value needing 5-byte varint
            let obj = { count: 268435456 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('roundtrips max uint32 via 5-byte varint (4294967295)', () => {
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'max', type: 'uint32' },
            ]);

            let obj = { max: 4294967295 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('4-byte varint boundary via array count', () => {
            // An array<uint8> with 2097152 elements uses a 4-byte varint for count.
            // Instead of allocating 2M elements, test via compressed uint32 which
            // also uses writeVarint directly.
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'a', type: 'uint32' },
                { name: 'b', type: 'uint32' },
                { name: 'c', type: 'uint32' },
            ]);

            let obj = { a: 2097151, b: 2097152, c: 268435455 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('varint exceeds 5 bytes throws', () => {
            // Encode a compressed schema with a string field, then corrupt the string
            // length varint to have 6 consecutive continuation bytes (all 0x80).
            // The compressed decoder calls readVarint for string lengths >= 128.
            let c = codec({ compress: true });

            c.defineSchema([{ name: 'msg', type: 'string' }]);

            // Encode a valid object to get a proper header (tag, hash, dataLen)
            let valid = c.encode({ msg: 'x' }),
                corrupt = new Uint8Array(valid.length + 5);

            // Copy header (9 bytes: tag + hash + dataLen)
            corrupt.set(valid.subarray(0, 9));

            // Replace data with 6 bytes of 0x80 (multi-byte varint that never terminates within 5 bytes)
            for (let i = 0; i < 6; i++) {
                corrupt[9 + i] = 0x80;
            }

            expect(() => c.decode(corrupt)).toThrow('varint');
        });

        it('varint read past end of buffer throws', () => {
            // Encode a compressed schema with a string field, then provide a buffer
            // where the string length varint byte has continuation bit set but no next byte.
            let c = codec({ compress: true });

            c.defineSchema([{ name: 'msg', type: 'string' }]);

            // Keep the header's declared dataLen intact (so the F-004 length check passes)
            // but fill the payload with continuation bytes so the string-length varint
            // runs off the end of the buffer.
            let corrupt = c.encode({ msg: 'x' }).slice();

            corrupt[corrupt.length - 2] = 0x80;
            corrupt[corrupt.length - 1] = 0x80;

            expect(() => c.decode(corrupt)).toThrow('varint');
        });

        it('zigzag negative values', () => {
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'a', type: 'int32' },
                { name: 'b', type: 'int32' },
                { name: 'c', type: 'int32' },
                { name: 'd', type: 'int32' },
            ]);

            let obj = { a: -1, b: -128, c: -2147483648, d: 2147483647 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('adaptive float64 — integer values', () => {
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'temperature', type: 'float64' },
                { name: 'value', type: 'float64' },
            ]);

            let obj = { temperature: 72.0, value: 42.0 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('adaptive float64 — non-integer', () => {
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'e', type: 'float64' },
                { name: 'pi', type: 'float64' },
            ]);

            let obj = { e: Math.E, pi: Math.PI };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('boolean fields via bitmap', () => {
            let c = codec({ compress: true }),
                obj = { a: true, b: false, c: true, d: false };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('compressed schema with 9 boolean fields (2-byte bitmap)', () => {
            let c = codec({ compress: true }),
                fields = [];

            for (let i = 0; i < 9; i++) {
                fields.push({ name: `b${i}`, type: 'boolean' });
            }

            c.defineSchema(fields);

            let obj: Record<string, boolean> = {};

            for (let i = 0; i < 9; i++) {
                obj[`b${i}`] = i % 2 === 0;
            }

            let buf = c.encode(obj),
                decoded = c.decode(buf) as Record<string, boolean>;

            for (let i = 0; i < 9; i++) {
                expect(decoded[`b${i}`]).toBe(i % 2 === 0);
            }
        });

        it('compressed schema with 16 boolean fields (2-byte bitmap full)', () => {
            let c = codec({ compress: true }),
                fields = [];

            for (let i = 0; i < 16; i++) {
                fields.push({ name: `flag${i}`, type: 'boolean' });
            }

            c.defineSchema(fields);

            let obj: Record<string, boolean> = {};

            for (let i = 0; i < 16; i++) {
                obj[`flag${i}`] = i % 3 === 0;
            }

            let buf = c.encode(obj),
                decoded = c.decode(buf) as Record<string, boolean>;

            for (let i = 0; i < 16; i++) {
                expect(decoded[`flag${i}`]).toBe(i % 3 === 0);
            }
        });

        it('defineSchema with 17 boolean fields round-trips (exceeds 2-byte bitmap — uncompressed fallback)', () => {
            let c = codec({ compress: true }),
                fields = [];

            for (let i = 0; i < 17; i++) {
                fields.push({ name: `flag${i}`, type: 'boolean' });
            }

            c.defineSchema(fields);

            let obj: Record<string, boolean> = {};

            for (let i = 0; i < 17; i++) {
                obj[`flag${i}`] = i % 2 === 0;
            }

            let buf = c.encode(obj),
                decoded = c.decode(buf) as Record<string, boolean>;

            for (let i = 0; i < 17; i++) {
                expect(decoded[`flag${i}`]).toBe(i % 2 === 0);
            }
        });

        it('inferred schema with 20 boolean fields round-trips (uncompressed fallback)', () => {
            let c = codec({ compress: true }),
                obj: Record<string, boolean> = {};

            for (let i = 0; i < 20; i++) {
                obj[`b${i}`] = i % 2 === 0;
            }

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('mixed compressed and uncompressed in same stream', () => {
            let c = codec({ compress: true }),
                obj1 = { active: true, id: 1, name: 'Alice' },
                obj2 = { label: 'test', notes: 'hello' };

            expect(c.encode(obj1)[0]).toBe(18);
            expect(c.encode(obj2)[0]).toBe(8);
            expect(c.decode(c.encode(obj1))).toEqual(obj1);
            expect(c.decode(c.encode(obj2))).toEqual(obj2);
        });

        it('compressed nullable fields', () => {
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'name', type: 'string' },
                { name: 'score', type: 'int32', nullable: true },
            ]);

            expect(c.decode(c.encode({ name: 'Alice', score: 42 }))).toEqual({ name: 'Alice', score: 42 });
            expect(c.decode(c.encode({ name: 'Alice', score: null }))).toEqual({ name: 'Alice', score: null });
        });

        it('cross-codec decode', () => {
            let c1 = codec({ compress: true }),
                c2 = codec();

            c1.defineSchema([{ name: 'id', type: 'uint8' }, { name: 'value', type: 'int32' }]);
            c2.defineSchema([{ name: 'id', type: 'uint8' }, { name: 'value', type: 'int32' }]);

            let obj = { id: 1, value: -999 };

            expect(c2.decode(c1.encode(obj))).toEqual(obj);
        });

        it('compressed wire size smaller for integer-heavy', () => {
            let normal = codec(),
                comp = codec({ compress: true }),
                obj = { a: 1, b: 2, c: 3, d: 4, e: 5 };

            expect(comp.encode(obj).length).toBeLessThanOrEqual(normal.encode(obj).length);
        });

        it('all field types together', () => {
            let c = codec({ compress: true });

            c.defineSchema([
                { name: 'active', type: 'boolean' },
                { name: 'big', type: 'int64' },
                { name: 'data', type: 'bytes' },
                { name: 'f', type: 'float64' },
                { name: 'i', type: 'int32' },
                { name: 'name', type: 'string' },
                { name: 'ts', type: 'date' },
                { name: 'u', type: 'uint8' },
            ]);

            let obj = { active: true, big: 123n, data: new Uint8Array([1, 2]), f: 3.14, i: -42, name: 'test', ts: new Date(1000), u: 7 },
                result = c.decode(c.encode(obj)) as Record<string, unknown>;

            expect(result.active).toBe(true);
            expect(result.big).toBe(123n);
            expect([...(result.data as Uint8Array)]).toEqual([1, 2]);
            expect(result.f).toBe(3.14);
            expect(result.i).toBe(-42);
            expect(result.name).toBe('test');
            expect((result.ts as Date).getTime()).toBe(1000);
            expect(result.u).toBe(7);
        });
    });


    // === REGISTRY SERIALIZATION ===

    describe('registry serialization', () => {
        it('serialize and deserialize round-trip', () => {
            let c1 = codec();

            c1.defineSchema([
                { name: 'age', type: 'uint8' },
                { name: 'name', type: 'string' },
            ]);

            let blob = c1.serializeRegistry();

            let c2 = codec();

            c2.deserializeRegistry(blob);

            let obj = { age: 25, name: 'Alice' };
            let encoded = c1.encode(obj);

            expect(c2.decode(encoded)).toEqual(obj);
        });

        it('cross-instance decode after import', () => {
            let server = codec();

            server.defineSchema([
                { name: 'active', type: 'boolean' },
                { name: 'id', type: 'int32' },
                { name: 'name', type: 'string' },
            ]);

            let encoded = server.encode({ active: true, id: 42, name: 'Test' });
            let blob = server.serializeRegistry();

            let client = codec();

            client.deserializeRegistry(blob);

            expect(client.decode(encoded)).toEqual({ active: true, id: 42, name: 'Test' });
        });

        it('nullable fields preserved', () => {
            let c1 = codec();

            c1.defineSchema([
                { name: 'name', type: 'string' },
                { name: 'note', type: 'string', nullable: true },
            ]);

            // Encode with non-null value to use the pre-defined nullable schema
            let withValue = { name: 'Alice', note: 'hello' };
            let encoded = c1.encode(withValue);

            let blob = c1.serializeRegistry();
            let c2 = codec();

            c2.deserializeRegistry(blob);

            // c2 can decode data from c1's nullable schema
            expect(c2.decode(encoded)).toEqual(withValue);

            // c2 can also encode/decode with the nullable schema (null value)
            let withNull = { name: 'Bob', note: 'world' };
            let encoded2 = c2.encode(withNull);

            expect(c1.decode(encoded2)).toEqual(withNull);
        });

        it('duplicate schemas skipped', () => {
            let c = codec();

            c.defineSchema([{ name: 'x', type: 'uint8' }]);

            let blob = c.serializeRegistry();

            c.deserializeRegistry(blob); // should not throw

            expect(c.decode(c.encode({ x: 42 }))).toEqual({ x: 42 });
        });

        it('multiple schemas', () => {
            let c1 = codec();

            c1.defineSchema([{ name: 'a', type: 'uint8' }]);
            c1.defineSchema([{ name: 'x', type: 'string' }, { name: 'y', type: 'int32' }]);

            let blob = c1.serializeRegistry();
            let c2 = codec();

            c2.deserializeRegistry(blob);

            expect(c2.decode(c1.encode({ a: 7 }))).toEqual({ a: 7 });
            expect(c2.decode(c1.encode({ x: 'hi', y: -1 }))).toEqual({ x: 'hi', y: -1 });
        });

        it('empty registry', () => {
            let c = codec();
            let blob = c.serializeRegistry();

            expect(blob.length).toBe(2); // just u16 count = 0

            let c2 = codec();

            c2.deserializeRegistry(blob); // should not throw
        });

        it('auto-inferred schemas included', () => {
            let c1 = codec();

            c1.encode({ name: 'Alice', score: 100 }); // auto-infer

            let blob = c1.serializeRegistry();
            let c2 = codec();

            c2.deserializeRegistry(blob);

            let encoded = c1.encode({ name: 'Bob', score: 200 });

            expect(c2.decode(encoded)).toEqual({ name: 'Bob', score: 200 });
        });
    });


    // === STRUCTURAL FIELD TYPES ===

    describe('structural field types', () => {
        describe('array<uint8>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<uint8>' },
                ]);

                let obj = { data: [0, 1, 127, 255] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('empty array round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<uint8>' },
                ]);

                expect(c.decode(c.encode({ data: [] }))).toEqual({ data: [] });
            });

            it('wire size: no tag bytes', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<uint8>' },
                ]);

                let generic = codec();

                generic.defineSchema([
                    { name: 'data', type: 'array' },
                ]);

                let arr = Array.from({ length: 100 }, (_, i) => i % 256);
                let typedBuf = c.encode({ data: arr }),
                    genericBuf = generic.encode({ data: arr });

                // Typed should be smaller (no flag byte, varint count vs u32 count)
                expect(typedBuf.length).toBeLessThan(genericBuf.length);
            });

            it('large array (10000 elements)', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<uint8>' },
                ]);

                let arr = Array.from({ length: 10000 }, (_, i) => i % 256),
                    obj = { data: arr };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('array<int8>', () => {
            it('round-trips signed values', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<int8>' },
                ]);

                let obj = { data: [-128, -1, 0, 1, 127] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('array<uint16>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<uint16>' },
                ]);

                let obj = { data: [0, 256, 65535] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('array<int16>', () => {
            it('round-trips signed values', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<int16>' },
                ]);

                let obj = { data: [-32768, -1, 0, 1, 32767] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('array<uint32>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<uint32>' },
                ]);

                let obj = { data: [0, 65536, 4294967295] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('array<int32>', () => {
            it('round-trips signed values', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<int32>' },
                ]);

                let obj = { data: [-2147483648, -1, 0, 1, 2147483647] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('array<float64>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<float64>' },
                ]);

                let obj = { data: [0, 3.14, -1.5, Infinity, -Infinity] };
                let result = c.decode(c.encode(obj)) as { data: number[] };

                expect(result.data.length).toBe(5);
                expect(result.data[0]).toBe(0);
                expect(result.data[1]).toBeCloseTo(3.14);
                expect(result.data[2]).toBeCloseTo(-1.5);
                expect(result.data[3]).toBe(Infinity);
                expect(result.data[4]).toBe(-Infinity);
            });

            it('NaN round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<float64>' },
                ]);

                let result = c.decode(c.encode({ data: [NaN] })) as { data: number[] };

                expect(Number.isNaN(result.data[0])).toBe(true);
            });
        });

        describe('array<boolean>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<boolean>' },
                ]);

                let obj = { data: [true, false, true, true, false] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('array<int64>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<int64>' },
                ]);

                let obj = { data: [0n, 1n, -1n, 9007199254740993n] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('array<date>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<date>' },
                ]);

                let dates = [new Date('2020-01-01'), new Date(0), new Date('2025-12-31')],
                    obj = { data: dates },
                    result = c.decode(c.encode(obj)) as { data: Date[] };

                expect(result.data.length).toBe(3);

                for (let i = 0; i < 3; i++) {
                    expect(result.data[i]!.getTime()).toBe(dates[i]!.getTime());
                }
            });
        });

        describe('array<string>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'tags', type: 'array<string>' },
                ]);

                let obj = { tags: ['hello', 'world', 'test'] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('empty strings', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'tags', type: 'array<string>' },
                ]);

                expect(c.decode(c.encode({ tags: ['', '', ''] }))).toEqual({ tags: ['', '', ''] });
            });

            it('unicode strings', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'tags', type: 'array<string>' },
                ]);

                let obj = { tags: ['日本語', '🎉', 'café'] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('wire size: smaller than generic', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'tags', type: 'array<string>' },
                ]);

                let generic = codec();

                generic.defineSchema([
                    { name: 'tags', type: 'array' },
                ]);

                let arr = Array.from({ length: 100 }, (_, i) => 'item' + i),
                    typedBuf = c.encode({ tags: arr }),
                    genericBuf = generic.encode({ tags: arr });

                expect(typedBuf.length).toBeLessThan(genericBuf.length);
            });
        });

        describe('array<bytes>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'chunks', type: 'array<bytes>' },
                ]);

                let chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])],
                    obj = { chunks },
                    result = c.decode(c.encode(obj)) as { chunks: Uint8Array[] };

                expect(result.chunks.length).toBe(2);
                expect([...result.chunks[0]!]).toEqual([1, 2, 3]);
                expect([...result.chunks[1]!]).toEqual([4, 5]);
            });
        });

        describe('object(hash)', () => {
            it('round-trips nested typed object', () => {
                let c = codec();

                let addrHash = c.defineSchema([
                    { name: 'city', type: 'string' },
                    { name: 'zip', type: 'string' },
                ]);

                c.defineSchema([
                    { name: 'address', type: `object(${addrHash})` },
                    { name: 'name', type: 'string' },
                ]);

                let obj = {
                    address: { city: 'NYC', zip: '10001' },
                    name: 'Alice',
                };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('round-trips nested typed object whose payload exceeds 128 bytes (F-002)', () => {
                let c = codec();

                let innerHash = c.defineSchema([
                    { name: 's', type: 'string' },
                ]);

                c.defineSchema([
                    { name: 'inner', type: `object(${innerHash})` },
                ]);

                let obj = { inner: { s: 'x'.repeat(200) } };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('round-trips typed object at the 127/128-byte payload boundary (F-002)', () => {
                let c = codec();

                let innerHash = c.defineSchema([
                    { name: 's', type: 'string' },
                ]);

                c.defineSchema([
                    { name: 'inner', type: `object(${innerHash})` },
                ]);

                for (let len = 120; len <= 140; len++) {
                    let obj = { inner: { s: 'y'.repeat(len) } };

                    expect(c.decode(c.encode(obj))).toEqual(obj);
                }
            });

            it('wire size: smaller than generic object', () => {
                let c = codec();

                let addrHash = c.defineSchema([
                    { name: 'city', type: 'string' },
                    { name: 'zip', type: 'string' },
                ]);

                c.defineSchema([
                    { name: 'address', type: `object(${addrHash})` },
                    { name: 'name', type: 'string' },
                ]);

                let generic = codec();

                generic.defineSchema([
                    { name: 'city', type: 'string' },
                    { name: 'zip', type: 'string' },
                ]);

                generic.defineSchema([
                    { name: 'address', type: 'object' },
                    { name: 'name', type: 'string' },
                ]);

                let obj = {
                    address: { city: 'NYC', zip: '10001' },
                    name: 'Alice',
                };

                let typedBuf = c.encode(obj),
                    genericBuf = generic.encode(obj);

                expect(typedBuf.length).toBeLessThan(genericBuf.length);
            });
        });

        describe('array<object(hash)>', () => {
            it('round-trips array of typed objects', () => {
                let c = codec();

                let itemHash = c.defineSchema([
                    { name: 'id', type: 'uint32' },
                    { name: 'name', type: 'string' },
                ]);

                c.defineSchema([
                    { name: 'items', type: `array<object(${itemHash})>` },
                ]);

                let obj = {
                    items: [
                        { id: 1, name: 'apple' },
                        { id: 2, name: 'banana' },
                        { id: 3, name: 'cherry' },
                    ],
                };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('empty array round-trips', () => {
                let c = codec();

                let itemHash = c.defineSchema([
                    { name: 'id', type: 'uint32' },
                ]);

                c.defineSchema([
                    { name: 'items', type: `array<object(${itemHash})>` },
                ]);

                expect(c.decode(c.encode({ items: [] }))).toEqual({ items: [] });
            });
        });

        describe('nested structural types', () => {
            it('array<array<uint8>> round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'matrix', type: 'array<array<uint8>>' },
                ]);

                let obj = {
                    matrix: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
                };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('array<array<string>> round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'grid', type: 'array<array<string>>' },
                ]);

                let obj = {
                    grid: [['a', 'b'], ['c', 'd']],
                };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('mixed schema fields', () => {
            it('schema with both generic array and typed array', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'generic', type: 'array' },
                    { name: 'scores', type: 'array<float64>' },
                    { name: 'tags', type: 'array<string>' },
                ]);

                let obj = {
                    generic: [1, 'two', true],
                    scores: [9.5, 8.7, 10.0],
                    tags: ['a', 'b', 'c'],
                };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('compressed mode with typed fields', () => {
            it('array<uint8> round-trips in compressed mode', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'active', type: 'boolean' },
                    { name: 'data', type: 'array<uint8>' },
                ]);

                let obj = { active: true, data: [0, 1, 127, 255] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('array<string> round-trips in compressed mode', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'count', type: 'int32' },
                    { name: 'tags', type: 'array<string>' },
                ]);

                let obj = { count: 42, tags: ['hello', 'world'] };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('object(hash) round-trips in compressed mode', () => {
                let c = codec({ compress: true });

                let addrHash = c.defineSchema([
                    { name: 'city', type: 'string' },
                    { name: 'zip', type: 'string' },
                ]);

                c.defineSchema([
                    { name: 'address', type: `object(${addrHash})` },
                    { name: 'name', type: 'string' },
                    { name: 'score', type: 'float64' },
                ]);

                let obj = {
                    address: { city: 'NYC', zip: '10001' },
                    name: 'Alice',
                    score: 95.5,
                };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });

            it('array<object(hash)> round-trips in compressed mode', () => {
                let c = codec({ compress: true });

                let itemHash = c.defineSchema([
                    { name: 'id', type: 'uint32' },
                    { name: 'name', type: 'string' },
                ]);

                c.defineSchema([
                    { name: 'active', type: 'boolean' },
                    { name: 'items', type: `array<object(${itemHash})>` },
                ]);

                let obj = {
                    active: true,
                    items: [
                        { id: 1, name: 'apple' },
                        { id: 2, name: 'banana' },
                    ],
                };

                expect(c.decode(c.encode(obj))).toEqual(obj);
            });
        });

        describe('registry serialization with structural types', () => {
            it('preserves structural type strings through serialize/deserialize', () => {
                let c1 = codec();

                let addrHash = c1.defineSchema([
                    { name: 'city', type: 'string' },
                    { name: 'zip', type: 'string' },
                ]);

                c1.defineSchema([
                    { name: 'address', type: `object(${addrHash})` },
                    { name: 'name', type: 'string' },
                    { name: 'scores', type: 'array<float64>' },
                    { name: 'tags', type: 'array<string>' },
                ]);

                let blob = c1.serializeRegistry(),
                    c2 = codec();

                c2.deserializeRegistry(blob);

                let obj = {
                    address: { city: 'NYC', zip: '10001' },
                    name: 'Alice',
                    scores: [9.5, 10.0],
                    tags: ['a', 'b'],
                };

                let encoded = c1.encode(obj);

                expect(c2.decode(encoded)).toEqual(obj);
            });
        });

        describe('extractField with typed fields', () => {
            it('extracts field after typed array', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<uint8>' },
                    { name: 'name', type: 'string' },
                ]);

                let buf = c.encode({ data: [1, 2, 3], name: 'test' });

                expect(c.extractField(buf, 'name')).toBe('test');
            });

            it('extracts typed array field', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<uint8>' },
                    { name: 'name', type: 'string' },
                ]);

                let buf = c.encode({ data: [1, 2, 3], name: 'test' });

                expect(c.extractField(buf, 'data')).toEqual([1, 2, 3]);
            });

            it('extracts field after typed string array', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'name', type: 'string' },
                    { name: 'tags', type: 'array<string>' },
                ]);

                let buf = c.encode({ name: 'test', tags: ['a', 'b', 'c'] });

                expect(c.extractField(buf, 'name')).toBe('test');
            });

            it('extracts field after object(hash)', () => {
                let c = codec();

                let addrHash = c.defineSchema([
                    { name: 'city', type: 'string' },
                    { name: 'zip', type: 'string' },
                ]);

                c.defineSchema([
                    { name: 'address', type: `object(${addrHash})` },
                    { name: 'name', type: 'string' },
                ]);

                let buf = c.encode({
                    address: { city: 'NYC', zip: '10001' },
                    name: 'Alice',
                });

                expect(c.extractField(buf, 'name')).toBe('Alice');
            });
        });

        describe('computeSize with typed fields', () => {
            it('computes size for typed uint8 array', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<uint8>' },
                ]);

                let obj = { data: [1, 2, 3, 4, 5] },
                    size = c.computeSize(obj),
                    buf = c.encode(obj);

                expect(size).toBe(buf.length);
            });

            it('computes size for typed string array', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'tags', type: 'array<string>' },
                ]);

                let obj = { tags: ['hi', 'bye'] },
                    size = c.computeSize(obj),
                    buf = c.encode(obj);

                expect(size).toBe(buf.length);
            });
        });

        describe('parseFieldType validation', () => {
            it('rejects empty array element type', () => {
                let c = codec();

                expect(() => c.defineSchema([
                    { name: 'x', type: 'array<>' },
                ])).toThrow('empty array element type');
            });

            it('rejects invalid object hash', () => {
                let c = codec();

                expect(() => c.defineSchema([
                    { name: 'x', type: 'object(abc)' },
                ])).toThrow('invalid object hash');
            });

            it('rejects empty object hash', () => {
                let c = codec();

                expect(() => c.defineSchema([
                    { name: 'x', type: 'object()' },
                ])).toThrow('invalid object hash');
            });

            it('rejects float object hash', () => {
                let c = codec();

                expect(() => c.defineSchema([
                    { name: 'x', type: 'object(1.5)' },
                ])).toThrow('invalid object hash');
            });

            it('rejects unknown base type', () => {
                let c = codec();

                expect(() => c.defineSchema([
                    { name: 'x', type: 'foobar' },
                ])).toThrow('unknown field type');
            });
        });

        describe('different hashes for array vs array<T>', () => {
            it('array and array<uint8> produce different hashes', () => {
                let c = codec();

                let h1 = c.defineSchema([
                    { name: 'data', type: 'array' },
                ]);

                let c2 = codec();

                let h2 = c2.defineSchema([
                    { name: 'data', type: 'array<uint8>' },
                ]);

                expect(h1).not.toBe(h2);
            });
        });
    });


    // === COMPRESSED MODE (tag 18) — extractField, decodeAt, encode view+hint ===

    describe('compressed mode (tag 18)', () => {
        describe('extractField on tag-18 buffer', () => {
            it('compressed buffer has tag 18 and round-trips via decode', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'active', type: 'boolean' },
                    { name: 'age', type: 'uint8' },
                    { name: 'score', type: 'int32' },
                ]);

                let obj = { active: true, age: 30, score: -500 },
                    encoded = c.encode(obj);

                expect(encoded[0]).toBe(18);
                expect(c.decode(encoded)).toEqual(obj);
            });

            it('extractField returns correct value for int32 on compressed buffer', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'active', type: 'boolean' },
                    { name: 'age', type: 'uint8' },
                    { name: 'score', type: 'int32' },
                ]);

                let encoded = c.encode({ active: true, age: 30, score: -500 });

                expect(encoded[0]).toBe(18);
                expect(c.extractField(encoded, 'score')).toBe(-500);
            });

            it('extractField returns correct value for varint-encoded fields on tag-18', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'count', type: 'uint16' },
                    { name: 'id', type: 'uint8' },
                    { name: 'value', type: 'int32' },
                ]);

                let encoded = c.encode({ count: 1000, id: 42, value: -99999 });

                expect(encoded[0]).toBe(18);
                expect(c.extractField(encoded, 'id')).toBe(42);
            });

            it('declared int32-nullable schema is honored and compresses to tag-18', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'id', type: 'uint8' },
                    { name: 'optional', type: 'int32', nullable: true },
                ]);

                let encoded = c.encode({ id: 5, optional: 123 });

                // Declared int32 is compressible → tag-18; the uint8 inference would
                // pick for 123 is not, so pre-fix this emitted tag-8.
                expect(encoded[0]).toBe(18);
                expect(c.extractField(encoded, 'optional')).toBe(123);
                expect(c.decode(encoded)).toEqual({ id: 5, optional: 123 });
            });
        });

        describe('decodeAt on tag-18 buffer', () => {
            it('decodeAt offset 0 on compressed buffer', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'id', type: 'uint8' },
                    { name: 'value', type: 'int32' },
                ]);

                let obj = { id: 7, value: 12345 },
                    encoded = c.encode(obj);

                expect(encoded[0]).toBe(18);
                expect(c.decodeAt(encoded, 0)).toEqual(obj);
            });

            it('decodeAt non-zero offset on compressed buffer', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'active', type: 'boolean' },
                    { name: 'score', type: 'int32' },
                ]);

                let obj = { active: true, score: -42 },
                    encoded = c.encode(obj),
                    padded = new Uint8Array(8 + encoded.length);

                padded.set(encoded, 8);

                expect(c.decodeAt(padded, 8)).toEqual(obj);
            });

            it('decodeAt concatenated compressed values', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'x', type: 'uint8' },
                    { name: 'y', type: 'int32' },
                ]);

                let a = c.encode({ x: 1, y: 100 }),
                    b = c.encode({ x: 2, y: 200 }),
                    combined = new Uint8Array(a.length + b.length);

                combined.set(a, 0);
                combined.set(b, a.length);

                expect(c.decodeAt(combined, 0)).toEqual({ x: 1, y: 100 });
                expect(c.decodeAt(combined, a.length)).toEqual({ x: 2, y: 200 });
            });
        });

        describe('encode with compress + view + schema hint', () => {
            it('view=true with schema hint produces decodable tag-18 buffer', () => {
                let c = codec({ compress: true });

                let hash = c.defineSchema([
                    { name: 'id', type: 'uint8' },
                    { name: 'value', type: 'int32' },
                ]);

                let obj = { id: 10, value: 9999 },
                    view = c.encode(obj, { schema: hash, view: true });

                expect(view[0]).toBe(18);

                // View is decodable before next encode
                let decoded = c.decode(view) as Record<string, unknown>;

                expect(decoded).toEqual(obj);
            });

            it('view=true + schema hint + multiple fields', () => {
                let c = codec({ compress: true });

                let hash = c.defineSchema([
                    { name: 'active', type: 'boolean' },
                    { name: 'count', type: 'uint16' },
                    { name: 'id', type: 'uint8' },
                    { name: 'score', type: 'int32' },
                ]);

                let obj = { active: true, count: 500, id: 42, score: -100 },
                    view = c.encode(obj, { schema: hash, view: true });

                expect(view[0]).toBe(18);
                expect(c.decode(view)).toEqual(obj);
            });

            it('view=true + schema as FieldSpec[] with compress', () => {
                let c = codec({ compress: true });

                let fields: { name: string; type: string }[] = [
                    { name: 'a', type: 'uint8' },
                    { name: 'b', type: 'int32' },
                ];

                c.defineSchema(fields);

                let obj = { a: 5, b: -999 },
                    view = c.encode(obj, { schema: fields, view: true });

                expect(view[0]).toBe(18);
                expect(c.decode(view)).toEqual(obj);
            });

            it('view=true alias is overwritten by next encode (compressed)', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'id', type: 'uint8' },
                    { name: 'value', type: 'int32' },
                ]);

                let first = c.encode({ id: 1, value: 100 }, { view: true }),
                    second = c.encode({ id: 2, value: 200 }, { view: true });

                // Both views share the same underlying ArrayBuffer
                expect(first.buffer).toBe(second.buffer);
            });
        });
    });


    // === VIEW MODE (encode buffer aliasing) ===

    describe('view mode aliasing', () => {
        it('view=true returns a live alias that is overwritten by subsequent encode()', () => {
            let c = codec();
            let first = c.encode({ msg: 'aaaa' }, { view: true });
            let second = c.encode({ msg: 'zzzz' }, { view: true });

            // Both views share the same underlying ArrayBuffer — they are aliased
            expect(first.buffer).toBe(second.buffer);

            // The first view now contains the second encode's data at overlapping positions
            // (both objects share schema/shape so the header + payload overlap completely)
            expect(first[0]).toBe(second[0]);
        });

        it('default (view=false) returns an independent copy not affected by subsequent encode()', () => {
            let c = codec();
            let first = c.encode({ msg: 'aaaa' });
            let snapshot = first.slice();

            // Second encode should NOT affect the first result
            c.encode({ msg: 'zzzz' });

            expect(first).toEqual(snapshot);
        });

        it('view=true alias is decodable before next encode()', () => {
            let c = codec();
            let view = c.encode({ x: 42 }, { view: true });
            let decoded = c.decode(view) as Record<string, unknown>;

            expect(decoded.x).toBe(42);
        });
    });


    // === Retired tags 15/16 (Map/Set value types removed) ===

    describe('retired tags 15/16', () => {
        it('decode: tag 15 throws unknown tag', () => {
            let buf = new Uint8Array([15, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('Codec2: unknown tag 15');
        });

        it('decode: tag 16 throws unknown tag', () => {
            let buf = new Uint8Array([16, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('Codec2: unknown tag 16');
        });

        it('defineSchema refuses a field typed map', () => {
            let c = codec();

            expect(() => c.defineSchema([{ name: 'meta', type: 'map' }])).toThrow('unknown field type: map');
        });

        it('defineSchema refuses a field typed set', () => {
            let c = codec();

            expect(() => c.defineSchema([{ name: 'tags', type: 'set' }])).toThrow('unknown field type: set');
        });

        it('defineSchema refuses a field typed bigint (renamed to int64)', () => {
            let c = codec();

            expect(() => c.defineSchema([{ name: 'big', type: 'bigint' }])).toThrow('Codec2: unknown field type: bigint');
        });

        it('int64 (KNOWN_TYPES sanity): round-trips through tagged, compiled, compressed, and hinted paths', () => {
            let value = 123456789012345678n;

            let tagged = codec();

            expect(tagged.decode(tagged.encode(value))).toBe(value);

            let compiled = codec();

            compiled.defineSchema([{ name: 'big', type: 'int64' }]);
            expect(compiled.decode(compiled.encode({ big: value }))).toEqual({ big: value });

            let compressed = codec({ compress: true });

            compressed.defineSchema([{ name: 'big', type: 'int64' }, { name: 'n', type: 'int32' }]);
            expect(compressed.decode(compressed.encode({ big: value, n: 7 }))).toEqual({ big: value, n: 7 });

            let hinted = codec();

            expect(hinted.decode(hinted.encode({ big: value }, { schema: [{ name: 'big', type: 'int64' }] }))).toEqual({ big: value });
        });

        it('int64 vocabulary pins: constants tables and inferType name int64, never bigint', () => {
            expect(FIELD_SIZES['int64']).toBe(8);
            expect(KNOWN_TYPES['int64']).toBe(1);
            expect('bigint' in FIELD_SIZES).toBe(false);
            expect('bigint' in KNOWN_TYPES).toBe(false);
            expect(inferType(123n)).toBe('int64');
        });
    });


    // === F-015 + F-016: Typed array error paths ===

    describe('typed array error paths (F-015, F-016)', () => {
        it('unknown typeId throws', () => {
            // tag 17 + typeId=99 + bLen=4 (u32 LE) + 4 dummy bytes
            let buf = new Uint8Array([17, 99, 4, 0, 0, 0, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('unknown typed array typeId 99');
        });

        it('unknown typeId 255 throws', () => {
            let buf = new Uint8Array([17, 255, 1, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('unknown typed array typeId 255');
        });

        it('byteLength not aligned throws for Float64Array (bpe=8)', () => {
            // tag 17 + typeId=1 (Float64Array, bpe=8) + bLen=3 (not aligned to 8)
            let buf = new Uint8Array([17, 1, 3, 0, 0, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('byteLength not aligned');
        });

        it('byteLength not aligned throws for Int32Array (bpe=4)', () => {
            // tag 17 + typeId=4 (Int32Array, bpe=4) + bLen=5 (not aligned to 4)
            let buf = new Uint8Array([17, 4, 5, 0, 0, 0, 0, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('byteLength not aligned');
        });

        it('byteLength not aligned throws for Int16Array (bpe=2)', () => {
            // tag 17 + typeId=3 (Int16Array, bpe=2) + bLen=3 (not aligned to 2)
            let buf = new Uint8Array([17, 3, 3, 0, 0, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('byteLength not aligned');
        });

        it('valid typed array still decodes', () => {
            let ta = new Float32Array([1.5, 2.5]);
            let result = c.decode(c.encode(ta)) as Float32Array;

            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(2);
        });
    });


    // === F-017: deserializeRegistry with corrupted/truncated input ===

    describe('deserializeRegistry corruption (F-017)', () => {
        it('truncated after schema count throws', () => {
            let c = codec();

            // Declares 1 schema (u16 LE = 1) but no data follows for hash/fields.
            expect(() => c.deserializeRegistry(new Uint8Array([1, 0]))).toThrow('truncated');
        });

        it('schema count 0 is valid (empty registry)', () => {
            let c = codec();

            // u16 LE count = 0
            c.deserializeRegistry(new Uint8Array([0, 0])); // should not throw
        });

        it('truncated field data throws on truncation', () => {
            let c = codec();

            // Declares 1 schema: hash=0x00000000, fieldCount=1, but truncated before field data.
            // Bounds checking detects truncation before field name read.
            let buf = new Uint8Array([
                1, 0,           // schemaCount = 1
                0, 0, 0, 0,    // hash = 0
                1, 0,           // fieldCount = 1
                // truncated — no nameLen/name/typeLen/type/flags
            ]);

            expect(() => c.deserializeRegistry(buf)).toThrow('truncated');
        });

        it('valid serialized registry round-trips correctly', () => {
            let c1 = codec();

            c1.defineSchema([
                { name: 'id', type: 'uint8' },
                { name: 'name', type: 'string' },
            ]);

            let blob = c1.serializeRegistry(),
                c2 = codec();

            c2.deserializeRegistry(blob);

            let obj = { id: 5, name: 'test' };

            expect(c2.decode(c1.encode(obj))).toEqual(obj);
        });

        it('completely empty buffer throws', () => {
            let c = codec();

            // Empty Uint8Array — no bytes available for schema count
            expect(() => c.deserializeRegistry(new Uint8Array(0))).toThrow('truncated');
        });

        it('schema count exceeding MAX_SCHEMA_COUNT (1024) throws', () => {
            let c = codec();

            // u16 LE: 0x01 | (0x04 << 8) = 1025, which exceeds MAX_SCHEMA_COUNT (1024)
            expect(() => c.deserializeRegistry(new Uint8Array([0x01, 0x04]))).toThrow('schema count');
        });
    });


    // === F-018: computeSize for bytes-type schema field ===

    describe('computeSize bytes field (F-018)', () => {
        it('bytes field computes correct size', () => {
            let c = codec();

            c.defineSchema([{ name: 'data', type: 'bytes' }]);

            let obj = { data: new Uint8Array([1, 2, 3]) },
                size = c.computeSize(obj),
                encoded = c.encode(obj);

            expect(size).toBeGreaterThan(0);
            expect(size).toBe(encoded.length);
        });

        it('empty bytes field computes correct size', () => {
            let c = codec();

            c.defineSchema([{ name: 'data', type: 'bytes' }]);

            let obj = { data: new Uint8Array(0) },
                size = c.computeSize(obj),
                encoded = c.encode(obj);

            expect(size).toBeGreaterThan(0);
            expect(size).toBe(encoded.length);
        });

        it('bytes field alongside fixed fields', () => {
            let c = codec();

            c.defineSchema([
                { name: 'data', type: 'bytes' },
                { name: 'id', type: 'uint8' },
            ]);

            let obj = { data: new Uint8Array([10, 20, 30, 40, 50]), id: 7 },
                size = c.computeSize(obj),
                encoded = c.encode(obj);

            expect(size).toBeGreaterThan(0);
            expect(size).toBe(encoded.length);
        });

        it('large bytes field computes correct size', () => {
            let c = codec();

            c.defineSchema([{ name: 'payload', type: 'bytes' }]);

            let payload = new Uint8Array(1000);

            for (let i = 0; i < 1000; i++) {
                payload[i] = i % 256;
            }

            let obj = { payload },
                size = c.computeSize(obj),
                encoded = c.encode(obj);

            expect(size).toBe(encoded.length);
        });
    });


    // === BATCH C: SECURITY/CORRECTNESS FIX COVERAGE ===

    describe('field name validation', () => {
        it('defineSchema rejects field name with spaces', () => {
            let c = codec();

            expect(() => c.defineSchema([{ name: 'bad field', type: 'uint8' }])).toThrow('Codec2: invalid field name');
        });

        it('defineSchema rejects field name with special chars', () => {
            let c = codec();

            expect(() => c.defineSchema([{ name: 'field@name!', type: 'string' }])).toThrow('Codec2: invalid field name');
        });

        it('defineSchema accepts valid field names', () => {
            let c = codec();

            expect(() => c.defineSchema([
                { name: '_private', type: 'uint8' },
                { name: '$dollar', type: 'uint8' },
                { name: 'camelCase', type: 'string' },
                { name: 'PascalCase', type: 'int32' },
            ])).not.toThrow();
        });

        it('deserializeRegistry rejects crafted buffer with invalid field name', () => {
            let c1 = codec();

            // Register a valid schema first
            c1.defineSchema([{ name: 'ok', type: 'uint8' }]);

            let blob = c1.serializeRegistry();

            // Find the field name bytes in the blob and corrupt them with a space character
            // Registry format: u16 schemaCount + [u32 hash + u16 fieldCount + fields...]
            // Field format: u16 nameLen + utf8 name + u16 typeLen + utf8 type + u8 flags
            // For a single schema with field 'ok': offset 8 is where name data starts (after schemaCount+hash+fieldCount)
            // schemaCount(2) + hash(4) + fieldCount(2) + nameLen(2) = 10 bytes before name
            let corrupt = new Uint8Array(blob);

            // The name 'ok' starts at offset 10 — replace first byte with space (0x20)
            corrupt[10] = 0x20; // space character

            let c2 = codec();

            expect(() => c2.deserializeRegistry(corrupt)).toThrow('Codec2: invalid field name in registry data');
        });
    });


    describe('decodeAt truncation guard', () => {
        it('decodeAt with 5-byte buffer (tag=8 but too short for header) throws', () => {
            let c = codec();

            // tag=8 but buffer only 5 bytes — needs 9 for full header
            let buf = new Uint8Array([8, 0, 0, 0, 0]);

            expect(() => c.decodeAt(buf, 0)).toThrow('Codec2: truncated tag-8/18 header');
        });

        it('decodeAt with 5-byte buffer tag=18 throws', () => {
            let c = codec();

            let buf = new Uint8Array([18, 0, 0, 0, 0]);

            expect(() => c.decodeAt(buf, 0)).toThrow('Codec2: truncated tag-8/18 header');
        });
    });


    describe('extractField buffer bounds guard', () => {
        it('extractField on truncated buffer throws', () => {
            let c = codec();

            // Register schema so extractField knows the field layout
            c.defineSchema([
                { name: 'age', type: 'uint8' },
                { name: 'name', type: 'string' },
                { name: 'score', type: 'int32' },
            ]);

            // Encode a valid object to get proper header
            let valid = c.encode({ age: 25, name: 'Alice', score: 100 });

            // Truncate the buffer — keep tag+hash+dataLen header (9 bytes) but chop most data
            let truncated = valid.slice(0, 11);

            // Requesting 'score' (3rd field) should fail because buffer is too short
            expect(() => c.extractField(truncated, 'score')).toThrow('Codec2: buffer too short for field');
        });
    });


    describe('decode hint len >= 9 boundary', () => {
        it('decode with schema hint on 6-byte tag-8 buffer skips hint fast path', () => {
            let c = codec();

            let hash = c.defineSchema([{ name: 'x', type: 'uint8' }]);

            // 6 bytes: tag=8 + 4 hash bytes + 1 garbage — len < 9 so hint path is skipped
            let buf = new Uint8Array([8, hash & 0xFF, (hash >> 8) & 0xFF, (hash >> 16) & 0xFF, (hash >> 24) & 0xFF, 0]);

            // With hint, the condition `len >= 9` fails, so it falls through to normal decode
            // Normal decode path sees tag=8, but buffer.length=6 < 9 — decodeSbc bounds check
            // correctly throws truncation error instead of reading OOB
            expect(() => c.decode(buf, { schema: hash })).toThrow('Codec2: truncated tag-8/18 header');
        });

        it('decode with schema hint on 9+ byte tag-8 buffer uses hint fast path', () => {
            let c = codec();

            c.defineSchema([{ name: 'x', type: 'uint8' }]);

            let obj = { x: 42 },
                encoded = c.encode(obj);

            // len >= 9, so hint path is used — verify correct decode
            let decoded = c.decode(encoded, { schema: [{ name: 'x', type: 'uint8' }] });

            expect(decoded).toEqual(obj);
        });
    });


    describe('computeSize nested object >= 128 bytes', () => {
        it('nested typed object with 16+ float64 fields uses 9-byte header in computeSize', () => {
            let c = codec();

            // Create inner schema with 16 float64 fields = 16 * 8 = 128 bytes (>= 128 threshold)
            let innerFields: { name: string; type: string }[] = [];

            for (let i = 0; i < 16; i++) {
                innerFields.push({ name: `f${String(i).padStart(2, '0')}`, type: 'float64' });
            }

            let innerHash = c.defineSchema(innerFields);

            c.defineSchema([
                { name: 'data', type: `object(${innerHash})` },
                { name: 'id', type: 'uint8' },
            ]);

            // Use non-integer float values so inferType returns 'float64' for all fields
            let innerObj: Record<string, number> = {};

            for (let i = 0; i < 16; i++) {
                innerObj[`f${String(i).padStart(2, '0')}`] = i + 0.1;
            }

            let obj = { data: innerObj, id: 1 },
                size = c.computeSize(obj);

            // nestedSize = 16 * 8 = 128 (>= 128): the fixed format prefixes the payload with a
            // 2-byte varint length (first byte >= 128, unambiguous vs the 1-byte < 128 case), not the
            // old 9-byte tag-8 header. Expected: 9 (outer header) + (2 varint + 128 payload) + 1 (id) = 140.
            // computeSize must exactly equal the real encoded length (no under-allocation).
            expect(size).toBe(140);
            expect(size).toBe(c.encode(obj).length);
        });

        it('nested typed object < 128 bytes uses 1-byte varint header', () => {
            let c = codec();

            // Create inner schema with 15 float64 fields = 15 * 8 = 120 bytes (< 128 threshold)
            let innerFields: { name: string; type: string }[] = [];

            for (let i = 0; i < 15; i++) {
                innerFields.push({ name: `f${String(i).padStart(2, '0')}`, type: 'float64' });
            }

            let innerHash = c.defineSchema(innerFields);

            c.defineSchema([
                { name: 'data', type: `object(${innerHash})` },
                { name: 'id', type: 'uint8' },
            ]);

            let innerObj: Record<string, number> = {};

            for (let i = 0; i < 15; i++) {
                innerObj[`f${String(i).padStart(2, '0')}`] = i + 0.1;
            }

            let obj = { data: innerObj, id: 1 },
                size = c.computeSize(obj);

            // nestedSize = 15 * 8 = 120 (< 128), so computeSize uses 1-byte varint header
            // Expected: 9 (outer header) + (1 + 120) (nested with 1-byte varint) + 1 (id) = 131
            expect(size).toBe(131);

            // And verify this matches actual encoded length
            let encoded = c.encode(obj);

            expect(size).toBe(encoded.length);
        });
    });


    describe('nested truncated tag-8/18 in array (F-CORR-15)', () => {
        it('array containing truncated tag-8 header throws', () => {
            // tag 7 (generic array) + count=1 (u32 LE) + then tag-8 with only 4 bytes (needs 9)
            let buf = new Uint8Array([7, 1, 0, 0, 0, 8, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('truncated');
        });

        it('array containing truncated tag-18 header throws', () => {
            let buf = new Uint8Array([7, 1, 0, 0, 0, 18, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('truncated');
        });
    });


    describe('compressed decoder truncation (S-NEW-1)', () => {
        it('truncated compressed buffer throws', () => {
            let c = codec({ compress: true });

            c.defineSchema([{ name: 'msg', type: 'string' }]);

            let valid = c.encode({ msg: 'hello world' }),
                truncated = valid.slice(0, 10);

            expect(() => c.decode(truncated)).toThrow();
        });
    });


    describe('decode fast path len < 9 guard (S5)', () => {
        it('tag-8 buffer with len < 9 skips fast path without reading OOB', () => {
            // 1-byte buffer with tag 8 — len < 9 so fast path must not execute
            let buf = new Uint8Array([8]);

            // The fast path would try to read buffer[1..8] — with len=1 that's OOB.
            // After fix, fast path is skipped. decodeSbc still tries to handle tag 8
            // but does not crash from the fast-path read.
            expect(() => c.decode(buf)).not.toThrow('SBC: silent data corruption');
        });

        it('tag-18 buffer with len < 9 skips fast path without reading OOB', () => {
            let buf = new Uint8Array([18]);

            expect(() => c.decode(buf)).not.toThrow('SBC: silent data corruption');
        });
    });


    describe('nested compressed object tag-18 dispatch', () => {
        it('encode nested typed object with compress:true, decode with compress:false', () => {
            let comp = codec({ compress: true }),
                plain = codec();

            let innerHash = comp.defineSchema([
                { name: 'value', type: 'int32' },
                { name: 'x', type: 'uint8' },
            ]);

            comp.defineSchema([
                { name: 'child', type: `object(${innerHash})` },
                { name: 'name', type: 'string' },
            ]);

            // Register same schemas on plain codec
            let innerHash2 = plain.defineSchema([
                { name: 'value', type: 'int32' },
                { name: 'x', type: 'uint8' },
            ]);

            plain.defineSchema([
                { name: 'child', type: `object(${innerHash2})` },
                { name: 'name', type: 'string' },
            ]);

            let obj = { child: { value: -42, x: 7 }, name: 'test' },
                encoded = comp.encode(obj);

            // Compressed codec produces tag 18 for compressible schemas
            // The parent schema has a string field so may not be compressible,
            // but the child is (int32+uint8 = compressible)
            // Either way, plain.decode should handle the tag-18 dispatch correctly
            expect(plain.decode(encoded)).toEqual(obj);
        });

        it('cross-codec nested compressed object round-trips', () => {
            let comp = codec({ compress: true }),
                plain = codec();

            let innerHash = comp.defineSchema([
                { name: 'a', type: 'boolean' },
                { name: 'b', type: 'int32' },
                { name: 'c', type: 'uint8' },
            ]);

            comp.defineSchema([
                { name: 'id', type: 'uint8' },
                { name: 'nested', type: `object(${innerHash})` },
            ]);

            plain.defineSchema([
                { name: 'a', type: 'boolean' },
                { name: 'b', type: 'int32' },
                { name: 'c', type: 'uint8' },
            ]);

            plain.defineSchema([
                { name: 'id', type: 'uint8' },
                { name: 'nested', type: `object(${innerHash})` },
            ]);

            let obj = { id: 5, nested: { a: true, b: -999, c: 42 } },
                encoded = comp.encode(obj);

            expect(plain.decode(encoded)).toEqual(obj);
        });
    });


    describe('extractField bounds on truncated object headers', () => {
        it('truncated untyped object field in target-field read returns undefined', () => {
            let c = codec();

            c.defineSchema([
                { name: 'x', type: 'uint8' },
                { name: 'y', type: 'int32' },
            ]);

            c.defineSchema([
                { name: 'child', type: 'object' },
                { name: 'name', type: 'string' },
            ]);

            // Encode valid object with untyped nested object
            let valid = c.encode({ child: { x: 1, y: 2 }, name: 'test' });

            // Find where the 'child' field data starts (after outer 9-byte header + bitmap)
            // Truncate so the child tag-8 header is incomplete (keep fewer than 9 bytes of child data)
            // Outer header = 9 bytes, bitmap = 0 or 1 bytes, then child field starts
            // We want to cut mid-way through the child's tag-8/18 header
            // The child is the first field, so truncate at 9 + bitmapBytes + 5 (partial header)
            let truncated = valid.slice(0, 15);

            // extractField targeting 'child' should return undefined (not crash)
            expect(c.extractField(truncated, 'child')).toBeUndefined();
        });

        it('truncated untyped mixed/object field in scan loop returns undefined', () => {
            let c = codec();

            c.defineSchema([
                { name: 'data', type: 'object' },
                { name: 'id', type: 'uint8' },
            ]);

            let valid = c.encode({ data: { foo: 'bar' }, id: 7 });

            // Truncate so the scan over 'data' (untyped object with tag-8) hits bounds check
            let truncated = valid.slice(0, 14);

            expect(c.extractField(truncated, 'id')).toBeUndefined();
        });
    });


    describe('JIT decoder p+9 bounds guard (S6)', () => {
        it('truncated nested untyped object tag-8 header throws in JIT decoder', () => {
            let c = codec();

            // Schema with an untyped 'object' field — the JIT decoder generates an
            // unconditional p+9 bounds check before reading the tag-8 header
            c.defineSchema([
                { name: 'child', type: 'object' },
                { name: 'name', type: 'string' },
            ]);

            let valid = c.encode({ child: { a: 1, b: 2 }, name: 'hello' });

            // The child field starts at offset 9 (after outer 9-byte header)
            // It's encoded as tag-8 with its own 9-byte header
            // Truncate mid-way through the child's tag-8 header
            let truncated = valid.slice(0, 14);

            expect(() => c.decode(truncated)).toThrow('truncated');
        });
    });


    describe('JIT decoder p+9+_dl payload overflow guard', () => {
        it('intact inner header but overflowing payload length throws', () => {
            let c = codec();

            c.defineSchema([
                { name: 'child', type: 'object' },
                { name: 'name', type: 'string' },
            ]);

            let valid = c.encode({ child: { a: 1, b: 2 }, name: 'hello' });

            // Find the child field's tag-8 header at offset 9
            // Corrupt the dataLen (bytes 14-17) to a huge value
            let corrupted = new Uint8Array(valid);

            corrupted[14] = 0xFF;
            corrupted[15] = 0xFF;
            corrupted[16] = 0xFF;
            corrupted[17] = 0x7F;

            expect(() => c.decode(corrupted)).toThrow('truncated');
        });
    });


    describe('single-pass packed array classifier (F-PERF-5)', () => {
        // typeId: 1 float64, 2 int8, 3 int16, 4 int32, 5 uint8, 7 uint16, 8 uint32 — bpe from
        // the shared TYPED_ARRAY tables. Every packed number[] decodes to a plain Array.
        let cases: { data: number[]; bpe: number; typeId: number }[] = [
            { data: [0, 255], bpe: 1, typeId: 5 },
            { data: [-5, 5], bpe: 1, typeId: 2 },
            { data: [0, 65535], bpe: 2, typeId: 7 },
            { data: [256, 1000, -1], bpe: 2, typeId: 3 },
            { data: [0, 300, 2147483648], bpe: 4, typeId: 8 },
            { data: [-1, -2147483648], bpe: 4, typeId: 4 },
            { data: [1.5], bpe: 8, typeId: 1 },
            { data: [2 ** 40], bpe: 8, typeId: 1 },
            { data: [0, 300, 3.14], bpe: 8, typeId: 1 },
        ];

        for (let tc of cases) {
            it('packs ' + JSON.stringify(tc.data) + ' as typeId ' + tc.typeId + ' (' + tc.bpe + ' B/element)', () => {
                let c = codec(),
                    encoded = c.encode(tc.data),
                    byteLen = (encoded[2]! | (encoded[3]! << 8) | (encoded[4]! << 16) | (encoded[5]! << 24)) >>> 0;

                expect(encoded[0]).toBe(12);
                expect(encoded[1]).toBe(tc.typeId);
                expect(byteLen).toBe(tc.data.length * tc.bpe);

                let decoded = c.decode(encoded) as number[];

                expect(Array.isArray(decoded)).toBe(true);
                expect(decoded).toEqual(tc.data);
            });
        }
    });


    // === F-002: matchSchema typed-schema fallback must verify full field signatures ===

    describe('F-002: typed schema fallback type safety', () => {
        it('does not bind {x: number[]} schema to object with {x: string[]}', () => {
            let c = codec();

            c.defineSchema([{ name: 'x', type: 'array<int32>' }]);

            // Encoding an object with same key but incompatible element type must NOT
            // reuse the int32-array schema — it must infer a fresh schema.
            let obj = { x: ['a', 'b', 'c'] },
                encoded = c.encode(obj),
                decoded = c.decode(encoded) as { x: string[] };

            expect(decoded).toEqual(obj);
        });

        it('does not bind {x: array<int32>} schema to object with {x: array<float64>}', () => {
            let c = codec();

            c.defineSchema([{ name: 'x', type: 'array<int32>' }]);

            let obj = { x: [1.5, 2.5, 3.5] },
                decoded = c.decode(c.encode(obj)) as { x: number[] };

            expect(decoded.x[0]).toBe(1.5);
            expect(decoded.x[1]).toBe(2.5);
            expect(decoded.x[2]).toBe(3.5);
        });

        it('does not bind {nested: object(hash)} schema to object with {nested: number}', () => {
            let c = codec(),
                inner = c.defineSchema([{ name: 'v', type: 'uint8' }]);

            c.defineSchema([{ name: 'nested', type: 'object(' + inner + ')' }]);

            // Structurally different — nested is a plain number, not an object
            let obj = { nested: 42 },
                decoded = c.decode(c.encode(obj)) as { nested: number };

            expect(decoded.nested).toBe(42);
        });

        it('binds typed array<int32> schema when incoming value is a compatible int array', () => {
            let c = codec();

            c.defineSchema([{ name: 'x', type: 'array<int32>' }]);

            let obj = { x: [1, 2, 3] },
                decoded = c.decode(c.encode(obj)) as { x: number[] };

            expect(decoded.x).toEqual([1, 2, 3]);
        });

        it('distinct typed schemas with same keys but different element types remain isolated', () => {
            let c = codec();

            // Define first typed schema. A later defineSchema with same keys but
            // different types causes the typed-schema index to drop the old entry
            // (collision detection in index.ts). The key invariant: a plain object
            // with string values must never bind to the uint8-array schema.
            c.defineSchema([{ name: 'data', type: 'array<uint8>' }]);

            let obj = { data: ['one', 'two'] },
                decoded = c.decode(c.encode(obj)) as { data: string[] };

            expect(decoded.data).toEqual(['one', 'two']);
        });

        it('typed schema with multiple container fields verifies every field', () => {
            let c = codec();

            c.defineSchema([
                { name: 'ids', type: 'array<int32>' },
                { name: 'tags', type: 'array<string>' },
            ]);

            // Swap: ids should be numbers but here it is strings
            let obj = { ids: ['x', 'y'], tags: ['a', 'b'] },
                decoded = c.decode(c.encode(obj)) as { ids: string[]; tags: string[] };

            expect(decoded.ids).toEqual(['x', 'y']);
            expect(decoded.tags).toEqual(['a', 'b']);
        });

        it('primitive typed schemas still match by names when types align', () => {
            let c = codec();

            c.defineSchema([
                { name: 'id', type: 'int32' },
                { name: 'name', type: 'string' },
            ]);

            let obj = { id: 42, name: 'alice' },
                decoded = c.decode(c.encode(obj)) as { id: number; name: string };

            expect(decoded).toEqual(obj);
        });
    });


    describe('F-004: declared dataLen validated against buffer length', () => {
        it('truncated tag-8 object whose header dataLen exceeds remaining bytes throws', () => {
            let encoded = c.encode({ a: 1, b: 2, c: 3 });

            expect(encoded[0]).toBe(8);

            let truncated = encoded.subarray(0, encoded.length - 1);

            expect(() => c.decode(truncated)).toThrow('truncated');
        });

        it('nested object with oversized declared dataLen throws via decodeSbc', () => {
            let encoded = c.encode([{ x: 1, y: 2 }]),
                inflated = encoded.slice();

            // Locate the inner tag-8 header (element 0 of the array) and inflate its dataLen.
            let hp = 5;

            expect(inflated[hp]).toBe(8);

            inflated[hp + 5] = 0xFF;
            inflated[hp + 6] = 0xFF;

            expect(() => c.decode(inflated)).toThrow('truncated');
        });

        it('valid buffers still decode', () => {
            expect(c.decode(c.encode({ a: 1, b: 2, c: 3 }))).toEqual({ a: 1, b: 2, c: 3 });
        });
    });


    describe('F-005: typed numeric array count bounds-checked before element loop', () => {
        it('uint8 array count exceeding remaining buffer throws', () => {
            let c = codec();

            c.defineSchema([{ name: 'nums', type: 'array<uint8>' }]);

            let encoded = c.encode({ nums: [1, 2, 3] }).slice();

            // Inflate the element count (single-byte varint at the payload start) far past
            // the bytes actually present, without touching the header dataLen.
            expect(encoded[9]).toBe(3);
            encoded[9] = 120;

            expect(() => c.decode(encoded)).toThrow('truncated array');
        });

        it('uint32 array count exceeding remaining buffer throws', () => {
            let c = codec();

            c.defineSchema([{ name: 'nums', type: 'array<uint32>' }]);

            let encoded = c.encode({ nums: [1, 2, 3] }).slice();

            expect(encoded[9]).toBe(3);
            encoded[9] = 120;

            expect(() => c.decode(encoded)).toThrow('truncated array');
        });

        it('valid typed numeric arrays still round-trip', () => {
            let c = codec();

            c.defineSchema([{ name: 'nums', type: 'array<uint8>' }]);

            expect(c.decode(c.encode({ nums: [1, 2, 3] }))).toEqual({ nums: [1, 2, 3] });
        });
    });

    describe('F-007: weakCache hit revalidates mutated objects', () => {
        it('mutating a cached field out of its inferred range re-matches instead of truncating', () => {
            let c = codec(),
                obj = { count: 5 };

            expect(c.decode(c.encode(obj))).toEqual({ count: 5 });

            obj.count = 300;

            expect(c.decode(c.encode(obj))).toEqual({ count: 300 });
        });

        it('mutating a cached field to a different type family re-matches', () => {
            let c = codec(),
                obj: { v: unknown } = { v: 42 };

            expect(c.decode(c.encode(obj))).toEqual({ v: 42 });

            obj.v = 'hello';

            expect(c.decode(c.encode(obj))).toEqual({ v: 'hello' });
        });

        it('adding a field to a cached object re-matches instead of dropping it', () => {
            let c = codec(),
                obj: Record<string, unknown> = { a: 1 };

            expect(c.decode(c.encode(obj))).toEqual({ a: 1 });

            obj.b = 2;

            expect(c.decode(c.encode(obj))).toEqual({ a: 1, b: 2 });
        });
    });

    describe('F-006: typed-schema matching range-checks fixed-width integers', () => {
        it('out-of-range integer for a uint8 field falls through to inference instead of truncating', () => {
            let c = codec();

            // structural schema (array field) → matchesTypedField/primitiveMatches path
            c.defineSchema([
                { name: 'items', type: 'array<string>' },
                { name: 'n', type: 'uint8' },
            ]);

            let obj = { items: ['a'], n: 300 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('negative value for a uint8 field falls through instead of wrapping', () => {
            let c = codec();

            c.defineSchema([
                { name: 'items', type: 'array<string>' },
                { name: 'n', type: 'uint8' },
            ]);

            let obj = { items: ['a'], n: -5 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('in-range value still matches the typed schema and round-trips', () => {
            let c = codec();

            c.defineSchema([
                { name: 'items', type: 'array<string>' },
                { name: 'n', type: 'uint8' },
            ]);

            let obj = { items: ['a'], n: 200 };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });
    });

    describe('F-010: unknown schema hash throws instead of decoding to null', () => {
        it('top-level tag-8 with an unregistered schema hash throws', () => {
            let c = codec();

            // tag 8, hash 0xDEADBEEF (never registered), dataLen 0
            let buf = new Uint8Array([8, 0xEF, 0xBE, 0xAD, 0xDE, 0, 0, 0, 0]);

            expect(() => c.decode(buf)).toThrow('unknown schema hash');
        });

        it('nested object with an unregistered schema hash throws during compiled decode', () => {
            let c = codec();

            c.defineSchema([{ name: 'data', type: 'object' }]);

            let buf = c.encode({ data: { x: 1 } }).slice();

            // Nested object begins at offset 9: [8, innerHash(4), innerLen(4), ...].
            expect(buf[9]).toBe(8);
            buf[10] = 0xEF;
            buf[11] = 0xBE;
            buf[12] = 0xAD;
            buf[13] = 0xDE;

            expect(() => c.decode(buf)).toThrow('unknown schema hash');
        });

        it('extractField resolves a schema via the shared cache like decode does', () => {
            let a = codec();

            // inferAndRegister populates the shared module cache with this shape
            let buf = a.encode({ label: 'hello', num: 7 });

            // fresh codec: schema is absent from its registry, present only in the shared cache
            let b = codec();

            expect(b.extractField(buf, 'label')).toBe('hello');
        });
    });

    describe('sbc-key-enumeration-parity: own-key counting matches Object.keys', () => {
        afterEach(() => {
            delete (Object.prototype as Record<string, unknown>)[POLLUTION_KEY];
        });

        it('own-key guard executes on the encode counting path under prototype pollution', () => {
            let objA = { a: 1, b: 2 },
                objB = { a: 3, b: 4 },
                c = codec();

            // Warm the caches BEFORE pollution: registers the schema, seeds weakCache + ring.
            c.encode(objA);

            (Object.prototype as Record<string, unknown>)[POLLUTION_KEY] = 1;

            let ownChecks = 0,
                realHasOwn = Object.hasOwn;

            Object.hasOwn = (target: object, key: PropertyKey): boolean => {
                if (target === objA || target === objB) {
                    ownChecks++;
                }

                return realHasOwn(target, key);
            };

            try {
                c.encode(objA);            // same reference → revalidateCached counts own keys
                c.encode(objB);            // fresh same-shape ref → matchSchema counts own keys
            }
            finally {
                Object.hasOwn = realHasOwn;
            }

            // Both counting loops now guard with Object.hasOwn on the encoded object.
            // A bare for-in (the pre-fix loop) never calls Object.hasOwn — this is 0 then.
            expect(ownChecks).toBeGreaterThan(0);
        });

        it('re-encoding a reference under pollution stays on the cached path and keeps the same schema hash', () => {
            let store = makeCountingStore(),
                c = codec({ store });

            (Object.prototype as Record<string, unknown>)[POLLUTION_KEY] = 1;

            let obj = { a: 1, b: 2 },
                first = c.encode(obj).slice(),
                setsAfterFirst = store.sets,
                sizeAfterFirst = store.size,
                second = c.encode(obj).slice();

            expect(schemaHash(second)).toBe(schemaHash(first));
            expect(store.sets).toBe(setsAfterFirst);
            expect(store.size).toBe(sizeAfterFirst);
            expect(c.decode(second)).toEqual({ a: 1, b: 2 });
        });

        it('Object.create with a data-carrying prototype encodes only own fields and drops the inherited key', () => {
            let c = codec(),
                obj = Object.create({ inherited: 99 }) as Record<string, unknown>;

            obj.own1 = 'x';
            obj.own2 = 7;

            let decoded = c.decode(c.encode(obj)) as Record<string, unknown>;

            expect(decoded).toEqual({ own1: 'x', own2: 7 });
            expect('inherited' in decoded).toBe(false);
        });

        it('revalidateCached still invalidates when an own key is added or removed between encodes', () => {
            let c = codec(),
                obj: Record<string, unknown> = { a: 1, b: 2 };

            expect(c.decode(c.encode(obj))).toEqual({ a: 1, b: 2 });

            obj.cee = 3;
            expect(c.decode(c.encode(obj))).toEqual({ a: 1, b: 2, cee: 3 });

            delete obj.b;
            expect(c.decode(c.encode(obj))).toEqual({ a: 1, cee: 3 });
        });

        it('a plain object literal round-trips deterministically and repeated encodes do not re-infer', () => {
            let store = makeCountingStore(),
                c = codec({ store }),
                obj = { name: 'Alice', score: 42 },
                snapshot = c.encode(obj).slice(),
                setsAfterFirst = store.sets;

            for (let i = 0; i < 8; i++) {
                expect([...c.encode(obj).slice()]).toEqual([...snapshot]);
            }

            expect(store.sets).toBe(setsAfterFirst);
            expect(c.decode(snapshot)).toEqual(obj);
        });
    });

    describe('sbc-schema-preregistration: declared schemas honored, unknown hints throw (D2/D4)', () => {
        it('declared widths drive emitted bytes — small value keeps declared int32 width', () => {
            let c = codec(),
                h = c.defineSchema([
                    { name: 'a', type: 'int32' },
                    { name: 'b', type: 'int32' },
                ]);

            let buf = c.encode({ a: 5, b: 2 });

            // Declared int32 → 4-byte little-endian fields, datalen 8. Inference would
            // pick uint8 for these values (1 byte each, datalen 2) under a different hash.
            let expected = new Uint8Array([
                8,
                h & 0xFF, (h >>> 8) & 0xFF, (h >>> 16) & 0xFF, (h >>> 24) & 0xFF,
                8, 0, 0, 0,
                5, 0, 0, 0,
                2, 0, 0, 0,
            ]);

            expect(schemaHash(buf)).toBe(h);
            expect([...buf]).toEqual([...expected]);
            expect(c.decode(buf)).toEqual({ a: 5, b: 2 });
        });

        it('one registry entry after N encodes of one declared type', () => {
            let store = makeCountingStore(),
                c = codec({ store });

            c.defineSchema([{ name: 'n', type: 'int32' }]);

            for (let v of [5, 500, 70000]) {
                c.encode({ n: v });
            }

            // Every value binds to the declared int32 schema. Inference would have minted
            // three shapes (uint8 / uint16 / int32) across these three encodes.
            let reg = c.serializeRegistry();

            expect(reg[0]! | (reg[1]! << 8)).toBe(1);
            expect(store.size).toBe(1);
            expect(c.decode(c.encode({ n: 70000 }))).toEqual({ n: 70000 });
        });

        it('README nullable example is honored for both null and non-null values', () => {
            let c = codec(),
                h = c.defineSchema([
                    { name: 'bio', nullable: true, type: 'string' },
                    { name: 'id', type: 'uint32' },
                ]);

            let withBio = c.encode({ bio: 'hi', id: 5 }),
                noBio = c.encode({ bio: null, id: 7 });

            // Both objects bind to the declared schema. Inference would mint distinct
            // non-nullable shapes (string+uint8 vs mixed+uint8), discarding the declared hash.
            expect(schemaHash(withBio)).toBe(h);
            expect(schemaHash(noBio)).toBe(h);
            expect(c.decode(withBio)).toEqual({ bio: 'hi', id: 5 });
            expect(c.decode(noBio)).toEqual({ bio: null, id: 7 });
        });

        it('encode with an unknown numeric schema hint throws', () => {
            let c = codec();

            expect(() => c.encode({ a: 1 }, { schema: 0xdeadbeef })).toThrow('Codec2: unknown schema hash 3735928559');
        });

        it('decode with an unknown numeric schema hint still throws (D4 symmetry)', () => {
            let c = codec(),
                buf = new Uint8Array([8, 0, 0, 0, 0, 0, 0, 0, 0]);

            expect(() => c.decode(buf, { schema: 0xdeadbeef })).toThrow('Codec2: unknown schema hash');
        });
    });
});
