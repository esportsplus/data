import { describe, expect, it } from 'vitest';
import { createCodec, transformCode } from './utils';


describe('Codec: Multi-Property Types', () => {
    it('encodes and decodes two string properties', () => {
        let codec = createCodec<{ email: string; name: string }>(`
            type User = { name: string; email: string };
            codec<User>();
        `);

        let data = { email: 'john@test.com', name: 'John' },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('encodes and decodes string + number', () => {
        let codec = createCodec<{ age: number; name: string }>(`
            type User = { name: string; age: number };
            codec<User>();
        `);

        let data = { age: 30, name: 'Alice' },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('encodes and decodes string + boolean + number', () => {
        let codec = createCodec<{ active: boolean; name: string; score: number }>(`
            type Player = { name: string; active: boolean; score: number };
            codec<Player>();
        `);

        let data = { active: true, name: 'Bob', score: 99.5 },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.active).toBe(true);
        expect(decoded.name).toBe('Bob');
        expect(decoded.score).toBeCloseTo(99.5);
    });

    it('encodes and decodes many properties', () => {
        let codec = createCodec<{
            alpha: string;
            beta: number;
            gamma: boolean;
            delta: string;
            epsilon: number;
        }>(`
            type Data = {
                alpha: string;
                beta: number;
                gamma: boolean;
                delta: string;
                epsilon: number;
            };
            codec<Data>();
        `);

        let data = { alpha: 'hello', beta: 42, delta: 'world', epsilon: 3.14, gamma: true },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.alpha).toBe('hello');
        expect(decoded.beta).toBeCloseTo(42);
        expect(decoded.delta).toBe('world');
        expect(decoded.epsilon).toBeCloseTo(3.14);
        expect(decoded.gamma).toBe(true);
    });

    it('encodes and decodes mixed branded types', () => {
        let codec = createCodec<{ count: number; name: string; ratio: number }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type float = Brand<number, 'float'>;
            type Data = { name: string; count: integer; ratio: float };
            codec<Data>();
        `);

        let data = { count: 100, name: 'test', ratio: 0.75 },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.count).toBe(100);
        expect(decoded.name).toBe('test');
        expect(decoded.ratio).toBeCloseTo(0.75, 2);
    });

    it('encodes and decodes all primitive types together', () => {
        let codec = createCodec<{
            active: boolean;
            count: bigint;
            name: string;
            score: number;
        }>(`
            type Data = {
                name: string;
                score: number;
                active: boolean;
                count: bigint;
            };
            codec<Data>();
        `);

        let data = { active: false, count: BigInt(999), name: 'mixed', score: -1.5 },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.active).toBe(false);
        expect(decoded.count).toBe(BigInt(999));
        expect(decoded.name).toBe('mixed');
        expect(decoded.score).toBeCloseTo(-1.5);
    });
});


describe('Codec: Nested Objects', () => {
    it('encodes and decodes single-level nested object', () => {
        let codec = createCodec<{ address: { city: string }; name: string }>(`
            type Address = { city: string };
            type User = { name: string; address: Address };
            codec<User>();
        `);

        let data = { address: { city: 'NYC' }, name: 'John' },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('encodes and decodes nested object with multiple fields', () => {
        let codec = createCodec<{
            address: { city: string; zip: string };
            name: string;
        }>(`
            type Address = { city: string; zip: string };
            type User = { name: string; address: Address };
            codec<User>();
        `);

        let data = { address: { city: 'NYC', zip: '10001' }, name: 'John' },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('encodes and decodes deeply nested objects', () => {
        let codec = createCodec<{
            level1: {
                level2: {
                    value: string;
                };
            };
        }>(`
            type Level2 = { value: string };
            type Level1 = { level2: Level2 };
            type Data = { level1: Level1 };
            codec<Data>();
        `);

        let data = { level1: { level2: { value: 'deep' } } },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('encodes and decodes nested object with mixed types', () => {
        let codec = createCodec<{
            meta: { count: number; tag: string };
            name: string;
        }>(`
            type Meta = { tag: string; count: number };
            type Data = { name: string; meta: Meta };
            codec<Data>();
        `);

        let data = { meta: { count: 5, tag: 'x' }, name: 'test' },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.name).toBe('test');
        expect(decoded.meta.tag).toBe('x');
        expect(decoded.meta.count).toBeCloseTo(5);
    });

    it('encodes and decodes multiple nested objects', () => {
        let codec = createCodec<{
            billing: { city: string };
            shipping: { city: string };
        }>(`
            type Addr = { city: string };
            type Data = { shipping: Addr; billing: Addr };
            codec<Data>();
        `);

        let data = { billing: { city: 'LA' }, shipping: { city: 'NYC' } },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });
});


describe('Codec: Arrays', () => {
    it('encodes and decodes number array (packed double)', () => {
        let codec = createCodec<{ values: number[] }>(`
            type Data = { values: number[] };
            codec<Data>();
        `);

        let data = { values: [1.1, 2.2, 3.3] },
            decoded = codec.decode(codec.encode(data));

        for (let i = 0; i < data.values.length; i++) {
            expect(decoded.values[i]).toBeCloseTo(data.values[i]);
        }
    });

    it('encodes and decodes float array (packed 32-bit)', () => {
        let codec = createCodec<{ values: number[] }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type float = Brand<number, 'float'>;
            type Data = { values: float[] };
            codec<Data>();
        `);

        let data = { values: [1.5, 2.5, 3.5] },
            decoded = codec.decode(codec.encode(data));

        for (let i = 0; i < data.values.length; i++) {
            expect(decoded.values[i]).toBeCloseTo(data.values[i], 5);
        }
    });

    it('encodes and decodes bigint array', () => {
        let codec = createCodec<{ values: bigint[] }>(`
            type Data = { values: bigint[] };
            codec<Data>();
        `);

        let data = { values: [BigInt(1), BigInt(999), BigInt(0)] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('encodes and decodes array of objects', () => {
        let codec = createCodec<{ items: { name: string }[] }>(`
            type Item = { name: string };
            type Data = { items: Item[] };
            codec<Data>();
        `);

        let data = { items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('encodes and decodes array of objects with multiple fields', () => {
        let codec = createCodec<{ items: { active: boolean; name: string }[] }>(`
            type Item = { name: string; active: boolean };
            type Data = { items: Item[] };
            codec<Data>();
        `);

        let data = {
            items: [
                { active: true, name: 'a' },
                { active: false, name: 'b' }
            ]
        };
        let decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('encodes and decodes multiple arrays', () => {
        let codec = createCodec<{ names: string[]; scores: number[] }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type Data = { names: string[]; scores: integer[] };
            codec<Data>();
        `);

        let data = { names: ['Alice', 'Bob'], scores: [100, 200] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles large arrays', () => {
        let codec = createCodec<{ values: number[] }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type Data = { values: integer[] };
            codec<Data>();
        `);

        let values: number[] = [];

        for (let i = 0; i < 1000; i++) {
            values.push(i);
        }

        let data = { values },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.values.length).toBe(1000);
        expect(decoded).toEqual(data);
    });

    it('encodes and decodes single-element array', () => {
        let codec = createCodec<{ items: string[] }>(`
            type Data = { items: string[] };
            codec<Data>();
        `);

        let data = { items: ['only'] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });
});


describe('Codec: Edge Cases', () => {
    it('handles zero value integer', () => {
        let codec = createCodec<{ value: number }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type Data = { value: integer };
            codec<Data>();
        `);

        let data = { value: 0 },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles zero value double', () => {
        let codec = createCodec<{ value: number }>(`
            type Data = { value: number };
            codec<Data>();
        `);

        let data = { value: 0 },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles very long strings', () => {
        let codec = createCodec<{ text: string }>(`
            type Data = { text: string };
            codec<Data>();
        `);

        let data = { text: 'x'.repeat(10000) },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles strings with special characters', () => {
        let codec = createCodec<{ text: string }>(`
            type Data = { text: string };
            codec<Data>();
        `);

        let data = { text: 'line1\nline2\ttab\r\n"quotes"' },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles maximum safe integer', () => {
        let codec = createCodec<{ value: number }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type Data = { value: integer };
            codec<Data>();
        `);

        let data = { value: 2147483647 },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles large bigint values', () => {
        let codec = createCodec<{ value: bigint }>(`
            type Data = { value: bigint };
            codec<Data>();
        `);

        let data = { value: BigInt('9007199254740991') },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles bigint zero', () => {
        let codec = createCodec<{ value: bigint }>(`
            type Data = { value: bigint };
            codec<Data>();
        `);

        let data = { value: BigInt(0) },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles negative double', () => {
        let codec = createCodec<{ value: number }>(`
            type Data = { value: number };
            codec<Data>();
        `);

        let data = { value: -999.999 },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.value).toBeCloseTo(-999.999);
    });

    it('handles very small float', () => {
        let codec = createCodec<{ value: number }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type float = Brand<number, 'float'>;
            type Data = { value: float };
            codec<Data>();
        `);

        let data = { value: 0.001 },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.value).toBeCloseTo(0.001, 3);
    });

    it('encode produces deterministic output', () => {
        let codec = createCodec<{ name: string }>(`
            type Data = { name: string };
            codec<Data>();
        `);

        let data = { name: 'deterministic' },
            encoded1 = codec.encode(data),
            encoded2 = codec.encode(data);

        expect(encoded1).toEqual(encoded2);
    });

    it('decode returns new object each time', () => {
        let codec = createCodec<{ name: string }>(`
            type Data = { name: string };
            codec<Data>();
        `);

        let data = { name: 'test' },
            encoded = codec.encode(data),
            decoded1 = codec.decode(encoded),
            decoded2 = codec.decode(encoded);

        expect(decoded1).toEqual(decoded2);
        expect(decoded1).not.toBe(decoded2);
    });
});


describe('Codec: Generated Code Quality', () => {
    it('generates valid JavaScript for multi-property type', () => {
        let code = transformCode(`
            type User = { name: string; age: number; active: boolean };
            codec<User>();
        `);

        expect(code).toContain('encode');
        expect(code).toContain('decode');
    });

    it('generates nested decoder functions for nested types', () => {
        let code = transformCode(`
            type Address = { city: string };
            type User = { name: string; address: Address };
            codec<User>();
        `);

        expect(code).toContain('_dec0');
    });

    it('generates nested encoder functions for nested types', () => {
        let code = transformCode(`
            type Address = { city: string };
            type User = { name: string; address: Address };
            codec<User>();
        `);

        expect(code).toContain('function _enc0(');
    });

    it('includes only needed runtime helpers', () => {
        let stringOnly = transformCode(`
            type Data = { name: string };
            codec<Data>();
        `);

        expect(stringOnly).toContain('_textEncoder');
        expect(stringOnly).toContain('_readVarint');
        expect(stringOnly).not.toContain('_readDouble');
        expect(stringOnly).not.toContain('_readFloat');
        expect(stringOnly).not.toContain('_readBigInt');

        let numberOnly = transformCode(`
            type Data = { value: number };
            codec<Data>();
        `);

        expect(numberOnly).toContain('_readDouble');
        expect(numberOnly).not.toContain('_textEncoder');
    });

    it('generates packed encoding for integer arrays', () => {
        let code = transformCode(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type Data = { values: integer[] };
            codec<Data>();
        `);

        // Packed encoding reads length prefix then loops
        expect(code).toContain('_readVarint');
    });
});


describe('Codec: Complex Roundtrips', () => {
    it('handles object with nested object and arrays', () => {
        let codec = createCodec<{
            items: { name: string }[];
            title: string;
        }>(`
            type Item = { name: string };
            type Data = { title: string; items: Item[] };
            codec<Data>();
        `);

        let data = {
            items: [{ name: 'item1' }, { name: 'item2' }],
            title: 'list'
        };
        let decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles empty arrays in multi-property objects', () => {
        let codec = createCodec<{ items: string[]; name: string }>(`
            type Data = { name: string; items: string[] };
            codec<Data>();
        `);

        let data = { items: [], name: 'empty' },
            decoded = codec.decode(codec.encode(data));

        expect(decoded.name).toBe('empty');
        expect(decoded.items).toEqual([]);
    });

    it('handles mixed scalar and array properties', () => {
        let codec = createCodec<{
            active: boolean;
            name: string;
            tags: string[];
        }>(`
            type Data = { name: string; active: boolean; tags: string[] };
            codec<Data>();
        `);

        let data = { active: true, name: 'test', tags: ['a', 'b'] },
            decoded = codec.decode(codec.encode(data));

        expect(decoded).toEqual(data);
    });

    it('handles multiple encode/decode cycles', () => {
        let codec = createCodec<{ value: string }>(`
            type Data = { value: string };
            codec<Data>();
        `);

        let data = { value: 'cycle' };

        for (let i = 0; i < 10; i++) {
            let encoded = codec.encode(data),
                decoded = codec.decode(encoded);

            expect(decoded).toEqual(data);
        }
    });

    it('handles object with all numeric types', () => {
        let codec = createCodec<{
            bigVal: bigint;
            doubleVal: number;
            floatVal: number;
            intVal: number;
        }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type float = Brand<number, 'float'>;
            type Data = {
                intVal: integer;
                floatVal: float;
                doubleVal: number;
                bigVal: bigint;
            };
            codec<Data>();
        `);

        let data = {
            bigVal: BigInt(123456789),
            doubleVal: 3.141592653589793,
            floatVal: 2.5,
            intVal: 42
        };
        let decoded = codec.decode(codec.encode(data));

        expect(decoded.bigVal).toBe(BigInt(123456789));
        expect(decoded.doubleVal).toBeCloseTo(3.141592653589793);
        expect(decoded.floatVal).toBeCloseTo(2.5, 5);
        expect(decoded.intVal).toBe(42);
    });
});
