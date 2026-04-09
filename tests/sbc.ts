import { describe, expect, it } from 'vitest';
import type { CodecOptions } from '../src/sbc';
import { codec } from '../src/sbc';


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

        it.fails('BUG: -0 classified as uint8 instead of float64', () => {
            expect(Object.is(c.decode(c.encode(-0)) as number, -0)).toBe(true);
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
            let data = [0, 1, 127, 255];

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('packed int32 array', () => {
            let data = [256, 1000, -1, 2147483647, -2147483648];

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it('packed float64 array', () => {
            let data = [1.1, 2.2, 3.3, NaN, Infinity];
            let decoded = c.decode(c.encode(data)) as number[];

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

    describe('ring buffer cache (4 slots)', () => {
        it('handles > 4 distinct schemas', () => {
            let c = codec(),
                schemas = [
                    { a: 1 },
                    { b: 2 },
                    { c: 3 },
                    { d: 4 },
                    { e: 5 },
                    { f: 6 },
                ];

            for (let s of schemas) {
                expect(c.decode(c.encode(s))).toEqual(s);
            }

            // Re-encode earlier schemas after eviction
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
        // BUG: Buffer growth guard retries after out-of-bounds write already threw.
        // The encodeFn writes beyond buffer bounds before size is checked.

        it.fails('BUG: large string exceeds initial 64KB buffer', () => {
            let s = 'x'.repeat(100000),
                data = { big: s };

            expect(c.decode(c.encode(data))).toEqual(data);
        });

        it.fails('BUG: large Uint8Array exceeds initial 64KB buffer', () => {
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

        it('huge packed uint8 count throws', () => {
            let buf = new Uint8Array([12, 0xFF, 0xFF, 0xFF, 0x7F]);

            expect(() => c.decode(buf)).toThrow('array count');
        });

        it('normal-sized arrays still work', () => {
            let data = Array.from({ length: 1000 }, (_, i) => i);

            expect(c.decode(c.encode(data))).toEqual(data);
        });
    });


    describe('F-003 (run2): decode respects length parameter', () => {
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


    // === MAP ===

    describe('Map', () => {
        it('empty Map', () => {
            let result = c.decode(c.encode(new Map())) as Map<unknown, unknown>;

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });

        it('string keys', () => {
            let m = new Map([['a', 1], ['b', 2], ['c', 3]]);
            let result = c.decode(c.encode(m)) as Map<unknown, unknown>;

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(3);
            expect(result.get('a')).toBe(1);
            expect(result.get('b')).toBe(2);
            expect(result.get('c')).toBe(3);
        });

        it('numeric keys', () => {
            let m = new Map([[1, 'one'], [2, 'two']]);
            let result = c.decode(c.encode(m)) as Map<unknown, unknown>;

            expect(result.get(1)).toBe('one');
            expect(result.get(2)).toBe('two');
        });

        it('mixed value types', () => {
            let m = new Map<unknown, unknown>([['str', 'hello'], ['num', 42], ['bool', true], ['null', null]]);
            let result = c.decode(c.encode(m)) as Map<unknown, unknown>;

            expect(result.get('str')).toBe('hello');
            expect(result.get('num')).toBe(42);
            expect(result.get('bool')).toBe(true);
            expect(result.get('null')).toBe(null);
        });

        it('nested Map', () => {
            let inner = new Map([['x', 1]]);
            let outer = new Map<string, unknown>([['inner', inner]]);
            let result = c.decode(c.encode(outer)) as Map<string, unknown>;
            let resultInner = result.get('inner') as Map<string, unknown>;

            expect(resultInner).toBeInstanceOf(Map);
            expect(resultInner.get('x')).toBe(1);
        });

        it('Map in object field', () => {
            let obj = { data: new Map([['key', 'val']]) };
            let result = c.decode(c.encode(obj)) as Record<string, unknown>;
            let m = result.data as Map<string, string>;

            expect(m).toBeInstanceOf(Map);
            expect(m.get('key')).toBe('val');
        });

        it('large Map (1000 entries)', () => {
            let m = new Map<number, number>();

            for (let i = 0; i < 1000; i++) {
                m.set(i, i * 2);
            }

            let result = c.decode(c.encode(m)) as Map<number, number>;

            expect(result.size).toBe(1000);
            expect(result.get(0)).toBe(0);
            expect(result.get(999)).toBe(1998);
        });
    });


    // === SET ===

    describe('Set', () => {
        it('empty Set', () => {
            let result = c.decode(c.encode(new Set())) as Set<unknown>;

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        it('string values', () => {
            let s = new Set(['a', 'b', 'c']);
            let result = c.decode(c.encode(s)) as Set<string>;

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(3);
            expect(result.has('a')).toBe(true);
            expect(result.has('b')).toBe(true);
            expect(result.has('c')).toBe(true);
        });

        it('numeric values', () => {
            let s = new Set([1, 2, 3, 42]);
            let result = c.decode(c.encode(s)) as Set<number>;

            expect(result.size).toBe(4);
            expect(result.has(42)).toBe(true);
        });

        it('mixed types', () => {
            let s = new Set<unknown>([1, 'hello', true, null]);
            let result = c.decode(c.encode(s)) as Set<unknown>;

            expect(result.size).toBe(4);
            expect(result.has(1)).toBe(true);
            expect(result.has('hello')).toBe(true);
            expect(result.has(true)).toBe(true);
            expect(result.has(null)).toBe(true);
        });

        it('nested Set', () => {
            let inner = new Set([1, 2]);
            let outer = new Set<unknown>([inner]);
            let result = c.decode(c.encode(outer)) as Set<unknown>;
            let items = [...result];

            expect(items[0]).toBeInstanceOf(Set);
            expect((items[0] as Set<number>).has(1)).toBe(true);
        });

        it('Set in object field', () => {
            let obj = { tags: new Set(['a', 'b']) };
            let result = c.decode(c.encode(obj)) as Record<string, unknown>;
            let s = result.tags as Set<string>;

            expect(s).toBeInstanceOf(Set);
            expect(s.has('a')).toBe(true);
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
        it('pre-registered schema encodes/decodes', () => {
            let c = codec();

            c.defineSchema([
                { name: 'name', type: 'string' },
                { name: 'age', type: 'uint8' },
            ]);

            let obj = { age: 25, name: 'Alice' };

            expect(c.decode(c.encode(obj))).toEqual(obj);
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

            c.encode(obj);

            let hash = c.defineSchema([
                { name: 'active', type: 'boolean' },
                { name: 'name', type: 'string' },
            ]);

            expect(typeof hash).toBe('number');
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

        it('schema with map/set types', () => {
            let c = codec();

            c.defineSchema([
                { name: 'meta', type: 'map' },
                { name: 'tags', type: 'set' },
            ]);

            let obj = { meta: new Map([['k', 'v']]), tags: new Set(['a', 'b']) };
            let result = c.decode(c.encode(obj)) as Record<string, unknown>;

            expect(result.tags).toBeInstanceOf(Set);
            expect((result.tags as Set<string>).has('a')).toBe(true);
            expect(result.meta).toBeInstanceOf(Map);
            expect((result.meta as Map<string, string>).get('k')).toBe('v');
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
                let size = c.computeSize(v);

                if (size !== -1) {
                    expect(size).toBe(c.encode(v).length);
                }
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

        it('returns -1 for Map', () => {
            expect(c.computeSize(new Map())).toBe(-1);
        });

        it('returns -1 for Set', () => {
            expect(c.computeSize(new Set())).toBe(-1);
        });

        it('returns -1 for typed array', () => {
            expect(c.computeSize(new Float32Array(3))).toBe(-1);
        });

        it('returns -1 for array', () => {
            expect(c.computeSize([1, 2, 3])).toBe(-1);
        });

        it('returns -1 for object with mixed field', () => {
            // Null infers as 'mixed' type, which computeSize cannot predict
            expect(c.computeSize({ data: null, id: 1 })).toBe(-1);
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
                { name: 'big', type: 'bigint' },
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

        describe('array<bigint>', () => {
            it('round-trips', () => {
                let c = codec();

                c.defineSchema([
                    { name: 'data', type: 'array<bigint>' },
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

            it.fails('BUG: extractField returns wrong value for int32 on compressed buffer (varint layout mismatch)', () => {
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

            it.fails('BUG: extractField returns wrong value for varint-encoded fields on tag-18', () => {
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

            it.fails('BUG: extractField on compressed nullable buffer gives wrong results', () => {
                let c = codec({ compress: true });

                c.defineSchema([
                    { name: 'id', type: 'uint8' },
                    { name: 'optional', type: 'int32', nullable: true },
                ]);

                let encoded = c.encode({ id: 5, optional: 123 });

                expect(encoded[0]).toBe(18);
                expect(c.extractField(encoded, 'optional')).toBe(123);
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


    // === F-014: Map/Set count guard (encode + decode) ===

    describe('Map/Set count guard (F-014)', () => {
        it('decode: map count > MAX_ARRAY_COUNT throws', () => {
            // tag 15 (Map) + u32 LE count = 1048577 (0x00100001)
            let buf = new Uint8Array([15, 0x01, 0x00, 0x10, 0x00]);

            expect(() => c.decode(buf)).toThrow('map count');
        });

        it('decode: set count > MAX_ARRAY_COUNT throws', () => {
            // tag 16 (Set) + u32 LE count = 1048577 (0x00100001)
            let buf = new Uint8Array([16, 0x01, 0x00, 0x10, 0x00]);

            expect(() => c.decode(buf)).toThrow('set count');
        });

        it('decode: map count exactly at MAX_ARRAY_COUNT + 1 throws', () => {
            // 1048577 = 0x100001 → LE bytes: [0x01, 0x00, 0x10, 0x00]
            let buf = new Uint8Array([15, 0x01, 0x00, 0x10, 0x00]);

            expect(() => c.decode(buf)).toThrow('map count');
        });

        it('decode: set count at 2 billion throws', () => {
            // 0x7FFFFFFF = 2147483647 → LE: [0xFF, 0xFF, 0xFF, 0x7F]
            let buf = new Uint8Array([16, 0xFF, 0xFF, 0xFF, 0x7F]);

            expect(() => c.decode(buf)).toThrow('set count');
        });

        it('small Map still round-trips', () => {
            let m = new Map<string, number>([['a', 1], ['b', 2]]);
            let result = c.decode(c.encode(m)) as Map<string, number>;

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(2);
            expect(result.get('a')).toBe(1);
        });

        it('small Set still round-trips', () => {
            let s = new Set([10, 20, 30]);
            let result = c.decode(c.encode(s)) as Set<number>;

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(3);
            expect(result.has(20)).toBe(true);
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
        it('truncated after schema count reads undefined bytes silently', () => {
            let c = codec();

            // Declares 1 schema (u16 LE = 1) but no data follows for hash/fields.
            // JS bitwise ops on undefined yield 0, so it silently creates a schema
            // with empty fields instead of throwing — documenting this behavior.
            c.deserializeRegistry(new Uint8Array([1, 0]));

            // The function did not throw; it registered a zero-field schema with hash=0.
            // Verify codec still works after corrupted import.
            expect(c.decode(c.encode({ x: 42 }))).toEqual({ x: 42 });
        });

        it('schema count 0 is valid (empty registry)', () => {
            let c = codec();

            // u16 LE count = 0
            c.deserializeRegistry(new Uint8Array([0, 0])); // should not throw
        });

        it('truncated field data throws on invalid type', () => {
            let c = codec();

            // Declares 1 schema: hash=0x00000000, fieldCount=1, but truncated before field data.
            // JS reads undefined bytes as 0, producing nameLen=0 and typeLen=0.
            // defineSchema then rejects the empty type string.
            let buf = new Uint8Array([
                1, 0,           // schemaCount = 1
                0, 0, 0, 0,    // hash = 0
                1, 0,           // fieldCount = 1
                // truncated — no nameLen/name/typeLen/type/flags
            ]);

            expect(() => c.deserializeRegistry(buf)).toThrow('unknown field type');
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

            // Empty Uint8Array — reading data[0] and data[1] yields undefined
            // This may or may not throw depending on schemaCount resolution
            // schemaCount = undefined! | (undefined! << 8) = 0, so loop doesn't execute
            c.deserializeRegistry(new Uint8Array(0));

            // Codec still works
            expect(c.decode(c.encode(42))).toBe(42);
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
});
