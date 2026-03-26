import { describe, expect, it } from 'vitest';
import { createCodec, transformCode } from './utils';


describe('Codec: Optional Fields', () => {
    describe('generated code wraps optional fields in undefined check', () => {
        it('wraps optional field size calc and write in if-check', () => {
            let code = transformCode(`
                type Brand<T, B extends string> = T & { __brand: B };
                type integer = Brand<number, 'integer'>;
                type Data = { id: string; count?: integer };
                codec<Data>();
            `);

            expect(code).toContain("_data['count'] !== undefined");
        });

        it('does not wrap required fields in if-check', () => {
            let code = transformCode(`
                type Brand<T, B extends string> = T & { __brand: B };
                type integer = Brand<number, 'integer'>;
                type Data = { id: string; count: integer };
                codec<Data>();
            `);

            expect(code).not.toContain("!== undefined");
        });
    });

    describe('optional integer field', () => {
        let codec = createCodec<{ count?: number; name: string }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type Data = { name: string; count?: integer };
            codec<Data>();
        `);

        it('roundtrips with optional integer present', () => {
            let data = { count: 42, name: 'Alice' },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.count).toBe(42);
            expect(decoded.name).toBe('Alice');
        });

        it('roundtrips with optional integer absent', () => {
            let data = { name: 'Bob' } as { count?: number; name: string },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.name).toBe('Bob');
            expect(decoded.count).toBeUndefined();
        });
    });

    describe('optional bigint field', () => {
        let codec = createCodec<{ id: string; value?: bigint }>(`
            type Data = { id: string; value?: bigint };
            codec<Data>();
        `);

        it('roundtrips with optional bigint present', () => {
            let data = { id: 'x1', value: BigInt(9007199254740991) },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.id).toBe('x1');
            expect(decoded.value).toBe(BigInt(9007199254740991));
        });

        it('roundtrips with optional bigint absent', () => {
            let data = { id: 'x2' } as { id: string; value?: bigint },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.id).toBe('x2');
            expect(decoded.value).toBeUndefined();
        });
    });

    describe('optional number (double) field', () => {
        let codec = createCodec<{ name: string; score?: number }>(`
            type Data = { name: string; score?: number };
            codec<Data>();
        `);

        it('roundtrips with optional double present', () => {
            let data = { name: 'test', score: 3.14 },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.name).toBe('test');
            expect(decoded.score).toBeCloseTo(3.14);
        });

        it('roundtrips with optional double absent', () => {
            let data = { name: 'test' } as { name: string; score?: number },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.name).toBe('test');
            expect(decoded.score).toBeUndefined();
        });
    });

    describe('multiple optional fields of different types', () => {
        let codec = createCodec<{
            age?: number;
            id: string;
            score?: bigint;
        }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type Data = {
                id: string;
                age?: integer;
                score?: bigint;
            };
            codec<Data>();
        `);

        it('roundtrips with all optional fields present', () => {
            let data = { age: 25, id: 'x1', score: BigInt(100) },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.age).toBe(25);
            expect(decoded.id).toBe('x1');
            expect(decoded.score).toBe(BigInt(100));
        });

        it('roundtrips with no optional fields', () => {
            let data = { id: 'x2' } as { age?: number; id: string; score?: bigint },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.id).toBe('x2');
            expect(decoded.age).toBeUndefined();
            expect(decoded.score).toBeUndefined();
        });

        it('roundtrips with some optional fields', () => {
            let data = { age: 30, id: 'x3' } as { age?: number; id: string; score?: bigint },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.age).toBe(30);
            expect(decoded.id).toBe('x3');
            expect(decoded.score).toBeUndefined();
        });
    });

    describe('optional fields do not interfere with required fields', () => {
        let codec = createCodec<{ count?: number; name: string; tag: string }>(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type Data = { name: string; tag: string; count?: integer };
            codec<Data>();
        `);

        it('preserves required fields when optional is absent', () => {
            let data = { name: 'Alice', tag: 'admin' } as { count?: number; name: string; tag: string },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.name).toBe('Alice');
            expect(decoded.tag).toBe('admin');
            expect(decoded.count).toBeUndefined();
        });

        it('preserves required fields when optional is present', () => {
            let data = { count: 7, name: 'Alice', tag: 'admin' },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.count).toBe(7);
            expect(decoded.name).toBe('Alice');
            expect(decoded.tag).toBe('admin');
        });
    });
});
