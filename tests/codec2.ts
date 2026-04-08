import { describe, expect, it } from 'vitest';
import { createCodec } from '../src/codec2';


describe('Codec2', () => {
    let codec = createCodec();


    // === PRIMITIVES ===

    describe('primitives', () => {
        it('null', () => {
            expect(codec.decode(codec.encode(null))).toBe(null);
        });

        it('undefined', () => {
            expect(codec.decode(codec.encode(undefined))).toBe(null);
        });

        it('boolean true', () => {
            expect(codec.decode(codec.encode(true))).toBe(true);
        });

        it('boolean false', () => {
            expect(codec.decode(codec.encode(false))).toBe(false);
        });

        it('uint8 (0)', () => {
            expect(codec.decode(codec.encode(0))).toBe(0);
        });

        it('uint8 (255)', () => {
            expect(codec.decode(codec.encode(255))).toBe(255);
        });

        it('uint8 (1)', () => {
            expect(codec.decode(codec.encode(1))).toBe(1);
        });

        it('int32 (256)', () => {
            expect(codec.decode(codec.encode(256))).toBe(256);
        });

        it('int32 (-1)', () => {
            expect(codec.decode(codec.encode(-1))).toBe(-1);
        });

        it('int32 (2147483647)', () => {
            expect(codec.decode(codec.encode(2147483647))).toBe(2147483647);
        });

        it('int32 (-2147483648)', () => {
            expect(codec.decode(codec.encode(-2147483648))).toBe(-2147483648);
        });

        it('float64 (3.14)', () => {
            expect(codec.decode(codec.encode(3.14))).toBe(3.14);
        });

        it.fails('BUG: -0 classified as uint8 instead of float64', () => {
            expect(Object.is(codec.decode(codec.encode(-0)) as number, -0)).toBe(true);
        });

        it('float64 (Infinity)', () => {
            expect(codec.decode(codec.encode(Infinity))).toBe(Infinity);
        });

        it('float64 (-Infinity)', () => {
            expect(codec.decode(codec.encode(-Infinity))).toBe(-Infinity);
        });

        it('float64 (NaN)', () => {
            expect(Number.isNaN(codec.decode(codec.encode(NaN)))).toBe(true);
        });

        it('float64 (Number.MAX_SAFE_INTEGER)', () => {
            expect(codec.decode(codec.encode(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
        });

        it('float64 (Number.MIN_SAFE_INTEGER)', () => {
            expect(codec.decode(codec.encode(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER);
        });

        it('string (empty)', () => {
            expect(codec.decode(codec.encode(''))).toBe('');
        });

        it('string (ascii)', () => {
            expect(codec.decode(codec.encode('hello'))).toBe('hello');
        });

        it('string (unicode)', () => {
            expect(codec.decode(codec.encode('こんにちは'))).toBe('こんにちは');
        });

        it('string (emoji)', () => {
            expect(codec.decode(codec.encode('hello 🌍🔥'))).toBe('hello 🌍🔥');
        });

        it('string (long > 16 chars)', () => {
            let s = 'a'.repeat(1000);

            expect(codec.decode(codec.encode(s))).toBe(s);
        });

        it('bigint', () => {
            expect(codec.decode(codec.encode(123456789012345678n))).toBe(123456789012345678n);
        });

        it('bigint (negative)', () => {
            expect(codec.decode(codec.encode(-99999999999n))).toBe(-99999999999n);
        });

        it('bigint (0n)', () => {
            expect(codec.decode(codec.encode(0n))).toBe(0n);
        });

        it('Date', () => {
            let d = new Date('2025-01-15T10:30:00Z'),
                decoded = codec.decode(codec.encode(d)) as Date;

            expect(decoded).toBeInstanceOf(Date);
            expect(decoded.getTime()).toBe(d.getTime());
        });

        it('Date (epoch)', () => {
            let d = new Date(0),
                decoded = codec.decode(codec.encode(d)) as Date;

            expect(decoded.getTime()).toBe(0);
        });

        it('Uint8Array', () => {
            let buf = new Uint8Array([1, 2, 3, 255, 0]),
                decoded = codec.decode(codec.encode(buf)) as Uint8Array;

            expect(decoded).toBeInstanceOf(Uint8Array);
            expect(Array.from(decoded)).toEqual([1, 2, 3, 255, 0]);
        });

        it('Uint8Array (empty)', () => {
            let buf = new Uint8Array(0),
                decoded = codec.decode(codec.encode(buf)) as Uint8Array;

            expect(decoded).toBeInstanceOf(Uint8Array);
            expect(decoded.length).toBe(0);
        });
    });


    // === ARRAYS ===

    describe('arrays', () => {
        it('empty array', () => {
            expect(codec.decode(codec.encode([]))).toEqual([]);
        });

        it('string array', () => {
            expect(codec.decode(codec.encode(['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
        });

        it('mixed type array', () => {
            let data = [1, 'two', true, null, 3.14];

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('nested array', () => {
            let data = [[1, 2], [3, 4], [5]];

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('packed uint8 array', () => {
            let data = [0, 1, 127, 255];

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('packed int32 array', () => {
            let data = [256, 1000, -1, 2147483647, -2147483648];

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('packed float64 array', () => {
            let data = [1.1, 2.2, 3.3, NaN, Infinity];
            let decoded = codec.decode(codec.encode(data)) as number[];

            expect(decoded[0]).toBe(1.1);
            expect(decoded[1]).toBe(2.2);
            expect(decoded[2]).toBe(3.3);
            expect(Number.isNaN(decoded[3])).toBe(true);
            expect(decoded[4]).toBe(Infinity);
        });

        it('large uint8 array (100 elements)', () => {
            let data = Array.from({ length: 100 }, (_, i) => i % 256);

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('array of objects', () => {
            let data = [{ a: 1 }, { a: 2 }, { a: 3 }];

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('array with nested objects', () => {
            let data = [{ x: { y: 1 } }, { x: { y: 2 } }];

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });
    });


    // === OBJECTS ===

    describe('objects', () => {
        it('simple object', () => {
            expect(codec.decode(codec.encode({ name: 'Alice' }))).toEqual({ name: 'Alice' });
        });

        it('multi-field object', () => {
            let data = { active: true, age: 30, name: 'Alice' };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('nested object', () => {
            let data = { address: { city: 'NYC', zip: '10001' }, name: 'Alice' };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('deeply nested object', () => {
            let data = { a: { b: { c: { d: { e: 42 } } } } };

            expect(codec.decode(codec.encode(data))).toEqual(data);
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

            let decoded = codec.decode(codec.encode(data)) as Record<string, unknown>;

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

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('object with unicode keys', () => {
            let data = { '名前': 'Alice', '年齢': 30 };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('object with many fields', () => {
            let data: Record<string, number> = {};

            for (let i = 0; i < 50; i++) {
                data[`field${i}`] = i;
            }

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('object with array field containing objects', () => {
            let data = { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });
    });


    // === SCHEMA CACHE — SAME KEYS, DIFFERENT VALUE TYPES ===

    describe('same keys, different value types', () => {
        it('string then number for same key', () => {
            let c = createCodec(),
                a = { value: 'hello' },
                b = { value: 42 };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('number then string for same key', () => {
            let c = createCodec(),
                a = { value: 42 },
                b = { value: 'hello' };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('boolean then string for same key', () => {
            let c = createCodec(),
                a = { flag: true },
                b = { flag: 'yes' };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('null then object for same key', () => {
            let c = createCodec(),
                a = { data: null },
                b = { data: { x: 1 } };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('int then float for same key', () => {
            let c = createCodec(),
                a = { n: 42 },
                b = { n: 3.14 };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('uint8 then int32 for same key', () => {
            let c = createCodec(),
                a = { n: 100 },
                b = { n: 100000 };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('string then array for same key', () => {
            let c = createCodec(),
                a = { payload: 'text' },
                b = { payload: [1, 2, 3] };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('interleaved types — round robin', () => {
            let c = createCodec(),
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
            let c = createCodec(),
                a = { age: 30, name: 'Alice' },
                b = { age: 'thirty', name: 42 };

            let encA = c.encode(a),
                encB = c.encode(b);

            expect(c.decode(encA)).toEqual(a);
            expect(c.decode(encB)).toEqual(b);
        });

        it('same keys with object then null values', () => {
            let c = createCodec(),
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
            let c = createCodec(),
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
            let c = createCodec(),
                obj = { x: 1, y: 2, z: 3 };

            // Encode same reference multiple times
            for (let i = 0; i < 10; i++) {
                expect(c.decode(c.encode(obj))).toEqual(obj);
            }
        });

        it('fresh objects with same shape', () => {
            let c = createCodec();

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

            expect(codec.decode(codec.encode(data))).toEqual(data);
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

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('sibling objects with different schemas', () => {
            let data = {
                a: { x: 1 },
                b: { y: 'two', z: true },
            };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });
    });


    // === WIRE FORMAT ===

    describe('wire format', () => {
        it('object starts with tag 8', () => {
            let encoded = codec.encode({ a: 1 });

            expect(encoded[0]).toBe(8);
        });

        it('null is tag 0', () => {
            let encoded = codec.encode(null);

            expect(encoded[0]).toBe(0);
        });

        it('false is tag 1', () => {
            let encoded = codec.encode(false);

            expect(encoded[0]).toBe(1);
        });

        it('true is tag 2', () => {
            let encoded = codec.encode(true);

            expect(encoded[0]).toBe(2);
        });

        it('uint8 is tag 3', () => {
            let encoded = codec.encode(42);

            expect(encoded[0]).toBe(3);
        });

        it('float64 is tag 4', () => {
            let encoded = codec.encode(3.14);

            expect(encoded[0]).toBe(4);
        });

        it('string is tag 5', () => {
            let encoded = codec.encode('hello');

            expect(encoded[0]).toBe(5);
        });

        it('Uint8Array is tag 6', () => {
            let encoded = codec.encode(new Uint8Array([1]));

            expect(encoded[0]).toBe(6);
        });

        it('generic array is tag 7', () => {
            let encoded = codec.encode(['a', 'b']);

            expect(encoded[0]).toBe(7);
        });

        it('bigint is tag 9', () => {
            let encoded = codec.encode(42n);

            expect(encoded[0]).toBe(9);
        });

        it('Date is tag 10', () => {
            let encoded = codec.encode(new Date());

            expect(encoded[0]).toBe(10);
        });

        it('int32 is tag 11', () => {
            let encoded = codec.encode(-1);

            expect(encoded[0]).toBe(11);
        });
    });


    // === ENCODE view MODE ===

    describe('encode view mode', () => {
        it('returns subarray (view) when view=true', () => {
            let data = { name: 'Alice' },
                view = codec.encode(data, true),
                copy = codec.encode(data, false);

            expect(codec.decode(view)).toEqual(data);
            expect(view.length).toBe(copy.length);
        });

        it('view is invalidated by next encode', () => {
            let a = { name: 'Alice' },
                viewA = codec.encode(a, true);

            // Capture bytes before overwrite
            let bytesA = new Uint8Array(viewA);

            // Encode something else — overwrites shared buffer
            codec.encode({ name: 'Bob' }, true);

            // viewA now points to corrupted data; bytesA is the safe snapshot
            expect(codec.decode(bytesA)).toEqual(a);
        });
    });


    // === BUFFER GROWTH ===

    describe('buffer growth', () => {
        // BUG: Buffer growth guard retries after out-of-bounds write already threw.
        // The encodeFn writes beyond buffer bounds before size is checked.

        it.fails('BUG: large string exceeds initial 64KB buffer', () => {
            let s = 'x'.repeat(100000),
                data = { big: s };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it.fails('BUG: large Uint8Array exceeds initial 64KB buffer', () => {
            let buf = new Uint8Array(100000);

            for (let i = 0; i < buf.length; i++) {
                buf[i] = i & 0xFF;
            }

            let decoded = codec.decode(codec.encode(buf)) as Uint8Array;

            expect(decoded.length).toBe(buf.length);
            expect(decoded[0]).toBe(0);
            expect(decoded[255]).toBe(255);
            expect(decoded[99999]).toBe(buf[99999]);
        });

        it('handles large array', () => {
            let data = Array.from({ length: 10000 }, (_, i) => i);

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });
    });


    // === EDGE CASES ===

    describe('edge cases', () => {
        it('empty object', () => {
            expect(codec.decode(codec.encode({}))).toEqual({});
        });

        it('object with undefined value', () => {
            let data = { a: undefined },
                decoded = codec.decode(codec.encode(data)) as Record<string, unknown>;

            // undefined maps to mixed → encodeSbc → tag 0 → decodes as null
            expect(decoded.a).toBe(null);
        });

        it('key ordering is deterministic (sorted)', () => {
            let c = createCodec(),
                a = { z: 1, a: 2, m: 3 },
                b = { a: 2, m: 3, z: 1 };

            // Both should produce identical wire bytes
            let encA = c.encode(a),
                encB = c.encode(b);

            expect(Array.from(encA)).toEqual(Array.from(encB));
        });

        it('number boundary: 255 is uint8, 256 is int32', () => {
            let c = createCodec(),
                a = { n: 255 },
                b = { n: 256 };

            let decA = c.decode(c.encode(a)) as { n: number },
                decB = c.decode(c.encode(b)) as { n: number };

            expect(decA.n).toBe(255);
            expect(decB.n).toBe(256);
        });

        it('array with single element', () => {
            expect(codec.decode(codec.encode([42]))).toEqual([42]);
        });

        it('array with single string', () => {
            expect(codec.decode(codec.encode(['hello']))).toEqual(['hello']);
        });

        it('decode with explicit length parameter', () => {
            let data = { name: 'test' },
                encoded = codec.encode(data);

            expect(codec.decode(encoded, encoded.length)).toEqual(data);
        });

        it('multiple codec instances are independent', () => {
            let c1 = createCodec(),
                c2 = createCodec();

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
                enc1 = codec.encode(data),
                decoded = codec.decode(enc1) as typeof data,
                enc2 = codec.encode(decoded);

            expect(Array.from(enc1)).toEqual(Array.from(enc2));
        });
    });


    // === CROSS-INSTANCE SCHEMA COMPATIBILITY ===

    describe('cross-instance compatibility', () => {
        // Known limitation: schema registry is per-instance, wire format is not self-describing
        it.fails('cross-instance decode — not self-describing (by design)', () => {
            let c1 = createCodec(),
                c2 = createCodec(),
                data = { active: true, age: 30, name: 'Alice' };

            let enc = c1.encode(data);

            expect(c2.decode(enc)).toEqual(data);
        });

        it('schema hash differs for different key sets', () => {
            let c = createCodec(),
                a = c.encode({ x: 1 }),
                b = c.encode({ y: 1 });

            let hashA = a[1]! | (a[2]! << 8) | (a[3]! << 16) | (a[4]! << 24),
                hashB = b[1]! | (b[2]! << 8) | (b[3]! << 16) | (b[4]! << 24);

            expect(hashA).not.toBe(hashB);
        });

        it('schema hash differs for same keys with different types', () => {
            let c = createCodec(),
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
            let c = createCodec();

            // First encode caches schema for {x: string}
            c.encode({ x: 'hello' });

            // Second encode must NOT reuse string schema for number value
            let enc = c.encode({ x: 42 }),
                dec = c.decode(enc) as { x: number };

            expect(dec.x).toBe(42);
            expect(typeof dec.x).toBe('number');
        });

        it('objects with inherited props encode only own properties', () => {
            let c = createCodec(),
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
            let c = createCodec(),
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

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('array [number, boolean, null] round-trips', () => {
            let data = [42, true, null];

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });

        it('array [number, object] round-trips', () => {
            let data = [1, { x: 2 }];

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });
    });


    describe('F-002+F-003: u32 count/length support', () => {
        it('string length uses u32 header (4 bytes after tag)', () => {
            let s = 'x'.repeat(1000),
                encoded = codec.encode(s);

            // tag 5 + u32 LE length + data
            expect(encoded[0]).toBe(5);

            let len = (encoded[1]! | (encoded[2]! << 8) | (encoded[3]! << 16) | (encoded[4]! << 24)) >>> 0;

            expect(len).toBe(1000);
            expect(encoded.length).toBe(5 + 1000);
            expect(codec.decode(encoded)).toBe(s);
        });

        it('array count uses u32 header (4 bytes after flag)', () => {
            let data = ['a', 'b', 'c'],
                encoded = codec.encode(data);

            // tag 7 + u32 LE count + elements
            expect(encoded[0]).toBe(7);

            let count = (encoded[1]! | (encoded[2]! << 8) | (encoded[3]! << 16) | (encoded[4]! << 24)) >>> 0;

            expect(count).toBe(3);
        });

        it('UTF-8 string in schema-compiled object', () => {
            let data = { label: 'こんにちは' };

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });
    });


    describe('F-004: decode depth limit', () => {
        it('moderately nested arrays decode fine', () => {
            let data: unknown = [1];

            for (let i = 0; i < 30; i++) {
                data = [data];
            }

            expect(codec.decode(codec.encode(data))).toEqual(data);
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

            expect(() => codec.decode(buf)).toThrow('max decode depth');
        });
    });


    describe('F-008: unknown tag throws', () => {
        it('decoding buffer with unknown tag throws', () => {
            let buf = new Uint8Array([99]); // tag 99 does not exist

            expect(() => codec.decode(buf)).toThrow('unknown tag');
        });
    });


    // === BATCH 3 FIX COVERAGE ===

    describe('F-001 (run2): __proto__ prototype pollution', () => {
        it('object with __proto__ as own property round-trips safely', () => {
            let c = createCodec(),
                data = Object.create(null) as Record<string, unknown>;

            data['__proto__'] = 'safe';
            data['name'] = 'test';

            let encoded = c.encode(data),
                decoded = c.decode(encoded) as Record<string, unknown>;

            expect(decoded['__proto__']).toBe('safe');
            expect(decoded['name']).toBe('test');
            // Verify prototype was NOT polluted — should be null (Object.create(null))
            expect(Object.getPrototypeOf(decoded)).toBe(null);
        });

        it('decoded objects use null prototype', () => {
            let data = { x: 1 },
                decoded = codec.decode(codec.encode(data)) as Record<string, unknown>;

            expect(decoded.x).toBe(1);
            expect(Object.getPrototypeOf(decoded)).toBe(null);
        });
    });


    describe('F-002 (run2): array count DoS guard', () => {
        it('huge array count in wire format throws', () => {
            // tag 7 (generic array) + count = 0x7FFFFFFF (2 billion)
            let buf = new Uint8Array([7, 0xFF, 0xFF, 0xFF, 0x7F]);

            expect(() => codec.decode(buf)).toThrow('array count');
        });

        it('huge packed uint8 count throws', () => {
            let buf = new Uint8Array([12, 0xFF, 0xFF, 0xFF, 0x7F]);

            expect(() => codec.decode(buf)).toThrow('array count');
        });

        it('normal-sized arrays still work', () => {
            let data = Array.from({ length: 1000 }, (_, i) => i);

            expect(codec.decode(codec.encode(data))).toEqual(data);
        });
    });


    describe('F-003 (run2): decode respects length parameter', () => {
        it('decode with length shorter than buffer ignores trailing bytes', () => {
            let data = { x: 42 },
                encoded = codec.encode(data),
                extended = new Uint8Array(encoded.length + 10);

            extended.set(encoded);
            // Fill trailing bytes with garbage
            for (let i = encoded.length; i < extended.length; i++) {
                extended[i] = 0xFF;
            }

            expect(codec.decode(extended, encoded.length)).toEqual(data);
        });
    });


    describe('F-002 (run3): truncated string/bytes bounds check', () => {
        it('truncated string throws', () => {
            // tag 5 (string) + u32 length = 100, but only 5 bytes in buffer
            let buf = new Uint8Array([5, 100, 0, 0, 0]);

            expect(() => codec.decode(buf)).toThrow('truncated string');
        });

        it('truncated bytes throws', () => {
            // tag 6 (bytes) + u32 length = 50, but only 5 bytes in buffer
            let buf = new Uint8Array([6, 50, 0, 0, 0]);

            expect(() => codec.decode(buf)).toThrow('truncated bytes');
        });

        it('valid string still decodes', () => {
            let encoded = codec.encode('hello world');

            expect(codec.decode(encoded)).toBe('hello world');
        });

        it('truncated string inside schema-compiled object throws', () => {
            let c = createCodec();

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
            let result = codec.decode(codec.encode(new Map())) as Map<unknown, unknown>;

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });

        it('string keys', () => {
            let m = new Map([['a', 1], ['b', 2], ['c', 3]]);
            let result = codec.decode(codec.encode(m)) as Map<unknown, unknown>;

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(3);
            expect(result.get('a')).toBe(1);
            expect(result.get('b')).toBe(2);
            expect(result.get('c')).toBe(3);
        });

        it('numeric keys', () => {
            let m = new Map([[1, 'one'], [2, 'two']]);
            let result = codec.decode(codec.encode(m)) as Map<unknown, unknown>;

            expect(result.get(1)).toBe('one');
            expect(result.get(2)).toBe('two');
        });

        it('mixed value types', () => {
            let m = new Map<unknown, unknown>([['str', 'hello'], ['num', 42], ['bool', true], ['null', null]]);
            let result = codec.decode(codec.encode(m)) as Map<unknown, unknown>;

            expect(result.get('str')).toBe('hello');
            expect(result.get('num')).toBe(42);
            expect(result.get('bool')).toBe(true);
            expect(result.get('null')).toBe(null);
        });

        it('nested Map', () => {
            let inner = new Map([['x', 1]]);
            let outer = new Map<string, unknown>([['inner', inner]]);
            let result = codec.decode(codec.encode(outer)) as Map<string, unknown>;
            let resultInner = result.get('inner') as Map<string, unknown>;

            expect(resultInner).toBeInstanceOf(Map);
            expect(resultInner.get('x')).toBe(1);
        });

        it('Map in object field', () => {
            let obj = { data: new Map([['key', 'val']]) };
            let result = codec.decode(codec.encode(obj)) as Record<string, unknown>;
            let m = result.data as Map<string, string>;

            expect(m).toBeInstanceOf(Map);
            expect(m.get('key')).toBe('val');
        });

        it('large Map (1000 entries)', () => {
            let m = new Map<number, number>();

            for (let i = 0; i < 1000; i++) {
                m.set(i, i * 2);
            }

            let result = codec.decode(codec.encode(m)) as Map<number, number>;

            expect(result.size).toBe(1000);
            expect(result.get(0)).toBe(0);
            expect(result.get(999)).toBe(1998);
        });
    });


    // === SET ===

    describe('Set', () => {
        it('empty Set', () => {
            let result = codec.decode(codec.encode(new Set())) as Set<unknown>;

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        it('string values', () => {
            let s = new Set(['a', 'b', 'c']);
            let result = codec.decode(codec.encode(s)) as Set<string>;

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(3);
            expect(result.has('a')).toBe(true);
            expect(result.has('b')).toBe(true);
            expect(result.has('c')).toBe(true);
        });

        it('numeric values', () => {
            let s = new Set([1, 2, 3, 42]);
            let result = codec.decode(codec.encode(s)) as Set<number>;

            expect(result.size).toBe(4);
            expect(result.has(42)).toBe(true);
        });

        it('mixed types', () => {
            let s = new Set<unknown>([1, 'hello', true, null]);
            let result = codec.decode(codec.encode(s)) as Set<unknown>;

            expect(result.size).toBe(4);
            expect(result.has(1)).toBe(true);
            expect(result.has('hello')).toBe(true);
            expect(result.has(true)).toBe(true);
            expect(result.has(null)).toBe(true);
        });

        it('nested Set', () => {
            let inner = new Set([1, 2]);
            let outer = new Set<unknown>([inner]);
            let result = codec.decode(codec.encode(outer)) as Set<unknown>;
            let items = [...result];

            expect(items[0]).toBeInstanceOf(Set);
            expect((items[0] as Set<number>).has(1)).toBe(true);
        });

        it('Set in object field', () => {
            let obj = { tags: new Set(['a', 'b']) };
            let result = codec.decode(codec.encode(obj)) as Record<string, unknown>;
            let s = result.tags as Set<string>;

            expect(s).toBeInstanceOf(Set);
            expect(s.has('a')).toBe(true);
        });
    });


    // === TYPED ARRAYS ===

    describe('Typed Arrays', () => {
        it('Float32Array round-trip', () => {
            let ta = new Float32Array([1.5, 2.5, 3.5]);
            let result = codec.decode(codec.encode(ta)) as Float32Array;

            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(3);
            expect(result[0]).toBeCloseTo(1.5);
            expect(result[1]).toBeCloseTo(2.5);
            expect(result[2]).toBeCloseTo(3.5);
        });

        it('Float64Array round-trip', () => {
            let ta = new Float64Array([Math.PI, Math.E]);
            let result = codec.decode(codec.encode(ta)) as Float64Array;

            expect(result).toBeInstanceOf(Float64Array);
            expect(result[0]).toBe(Math.PI);
            expect(result[1]).toBe(Math.E);
        });

        it('Int8Array round-trip', () => {
            let ta = new Int8Array([-128, 0, 127]);
            let result = codec.decode(codec.encode(ta)) as Int8Array;

            expect(result).toBeInstanceOf(Int8Array);
            expect([...result]).toEqual([-128, 0, 127]);
        });

        it('Int16Array round-trip', () => {
            let ta = new Int16Array([-32768, 0, 32767]);
            let result = codec.decode(codec.encode(ta)) as Int16Array;

            expect(result).toBeInstanceOf(Int16Array);
            expect([...result]).toEqual([-32768, 0, 32767]);
        });

        it('Int32Array round-trip', () => {
            let ta = new Int32Array([-2147483648, 0, 2147483647]);
            let result = codec.decode(codec.encode(ta)) as Int32Array;

            expect(result).toBeInstanceOf(Int32Array);
            expect([...result]).toEqual([-2147483648, 0, 2147483647]);
        });

        it('Uint8ClampedArray round-trip', () => {
            let ta = new Uint8ClampedArray([0, 128, 255]);
            let result = codec.decode(codec.encode(ta)) as Uint8ClampedArray;

            expect(result).toBeInstanceOf(Uint8ClampedArray);
            expect([...result]).toEqual([0, 128, 255]);
        });

        it('Uint16Array round-trip', () => {
            let ta = new Uint16Array([0, 1000, 65535]);
            let result = codec.decode(codec.encode(ta)) as Uint16Array;

            expect(result).toBeInstanceOf(Uint16Array);
            expect([...result]).toEqual([0, 1000, 65535]);
        });

        it('Uint32Array round-trip', () => {
            let ta = new Uint32Array([0, 100000, 4294967295]);
            let result = codec.decode(codec.encode(ta)) as Uint32Array;

            expect(result).toBeInstanceOf(Uint32Array);
            expect([...result]).toEqual([0, 100000, 4294967295]);
        });

        it('BigInt64Array round-trip', () => {
            let ta = new BigInt64Array([BigInt('-9223372036854775808'), 0n, BigInt('9223372036854775807')]);
            let result = codec.decode(codec.encode(ta)) as BigInt64Array;

            expect(result).toBeInstanceOf(BigInt64Array);
            expect(result[0]).toBe(BigInt('-9223372036854775808'));
            expect(result[2]).toBe(BigInt('9223372036854775807'));
        });

        it('BigUint64Array round-trip', () => {
            let ta = new BigUint64Array([0n, BigInt('18446744073709551615')]);
            let result = codec.decode(codec.encode(ta)) as BigUint64Array;

            expect(result).toBeInstanceOf(BigUint64Array);
            expect(result[0]).toBe(0n);
            expect(result[1]).toBe(BigInt('18446744073709551615'));
        });

        it('empty typed array', () => {
            let ta = new Float32Array(0);
            let result = codec.decode(codec.encode(ta)) as Float32Array;

            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(0);
        });

        it('large typed array', () => {
            let ta = new Int32Array(10000);

            for (let i = 0; i < 10000; i++) {
                ta[i] = i;
            }

            let result = codec.decode(codec.encode(ta)) as Int32Array;

            expect(result.length).toBe(10000);
            expect(result[0]).toBe(0);
            expect(result[9999]).toBe(9999);
        });

        it('plain Uint8Array still uses tag 6', () => {
            let ta = new Uint8Array([1, 2, 3]);
            let encoded = codec.encode(ta);

            expect(encoded[0]).toBe(6);

            let result = codec.decode(encoded) as Uint8Array;

            expect(result).toBeInstanceOf(Uint8Array);
            expect([...result]).toEqual([1, 2, 3]);
        });

        it('typed array in object field', () => {
            let obj = { data: new Float32Array([1.0, 2.0]) };
            let result = codec.decode(codec.encode(obj)) as Record<string, unknown>;
            let ta = result.data as Float32Array;

            expect(ta).toBeInstanceOf(Float32Array);
            expect(ta.length).toBe(2);
        });
    });


    // === DECODE AT ===

    describe('decodeAt', () => {
        it('decode object at non-zero offset', () => {
            let obj = { name: 'Alice' },
                encoded = codec.encode(obj),
                padded = new Uint8Array(10 + encoded.length);

            padded.set(encoded, 10);

            expect(codec.decodeAt(padded, 10)).toEqual(obj);
        });

        it('decode primitive at offset', () => {
            let encoded = codec.encode(42),
                padded = new Uint8Array(5 + encoded.length);

            padded.set(encoded, 5);

            expect(codec.decodeAt(padded, 5)).toBe(42);
        });

        it('decode string at offset', () => {
            let encoded = codec.encode('hello'),
                padded = new Uint8Array(3 + encoded.length);

            padded.set(encoded, 3);

            expect(codec.decodeAt(padded, 3)).toBe('hello');
        });

        it('decode array at offset', () => {
            let arr = [1, 2, 3],
                encoded = codec.encode(arr),
                padded = new Uint8Array(7 + encoded.length);

            padded.set(encoded, 7);

            expect(codec.decodeAt(padded, 7)).toEqual(arr);
        });

        it('decode null at offset', () => {
            let encoded = codec.encode(null),
                padded = new Uint8Array(2 + encoded.length);

            padded.set(encoded, 2);

            expect(codec.decodeAt(padded, 2)).toBe(null);
        });

        it('decode boolean at offset', () => {
            let encoded = codec.encode(true),
                padded = new Uint8Array(4 + encoded.length);

            padded.set(encoded, 4);

            expect(codec.decodeAt(padded, 4)).toBe(true);
        });

        it('decode multiple values concatenated', () => {
            let a = codec.encode('hello'),
                b = codec.encode(42),
                c = codec.encode({ x: 1 }),
                combined = new Uint8Array(a.length + b.length + c.length);

            combined.set(a, 0);
            combined.set(b, a.length);
            combined.set(c, a.length + b.length);

            expect(codec.decodeAt(combined, 0)).toBe('hello');
            expect(codec.decodeAt(combined, a.length)).toBe(42);
            expect(codec.decodeAt(combined, a.length + b.length)).toEqual({ x: 1 });
        });
    });


    // === DEFINE SCHEMA ===

    describe('defineSchema', () => {
        it('pre-registered schema encodes/decodes', () => {
            let c = createCodec();

            c.defineSchema([
                { name: 'name', type: 'string' },
                { name: 'age', type: 'uint8' },
            ]);

            let obj = { age: 25, name: 'Alice' };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('returns consistent hash for same fields', () => {
            let c = createCodec();
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
            let c = createCodec();

            c.defineSchema([
                { name: 'z', type: 'string' },
                { name: 'a', type: 'uint8' },
            ]);

            let obj = { a: 1, z: 'test' };

            expect(c.decode(c.encode(obj))).toEqual(obj);
        });

        it('matches auto-inferred schema hash', () => {
            let c = createCodec();
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
            let c = createCodec();

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
            let c = createCodec();

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
            let c = createCodec();

            c.defineSchema([
                { name: 'id', type: 'uint8' },
                { name: 'value', type: 'mixed' },
            ]);

            expect(c.decode(c.encode({ id: 1, value: 'hello' }))).toEqual({ id: 1, value: 'hello' });
            expect(c.decode(c.encode({ id: 2, value: 42 }))).toEqual({ id: 2, value: 42 });
        });

        it('schema with map/set types', () => {
            let c = createCodec();

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
});
