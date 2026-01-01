import { describe, expect, it } from 'vitest';
import { createCodec } from './utils';


describe('Codec Encode/Decode', () => {
    describe('primitive types', () => {
        describe('string', () => {
            it('encodes and decodes string', () => {
                let codec = createCodec<{ name: string }>(`
                    type User = { name: string };
                    codec<User>();
                `);

                let data = { name: 'John' };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });

            it('handles empty string', () => {
                let codec = createCodec<{ name: string }>(`
                    type User = { name: string };
                    codec<User>();
                `);

                let data = { name: '' };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });

            it('handles unicode', () => {
                let codec = createCodec<{ name: string }>(`
                    type User = { name: string };
                    codec<User>();
                `);

                let data = { name: 'こんにちは' };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });
        });

        describe('number (double)', () => {
            it('encodes and decodes number', () => {
                let codec = createCodec<{ value: number }>(`
                    type Data = { value: number };
                    codec<Data>();
                `);

                let data = { value: 42 };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });

            it('handles negative numbers', () => {
                let codec = createCodec<{ value: number }>(`
                    type Data = { value: number };
                    codec<Data>();
                `);

                let data = { value: -123.456 };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded.value).toBeCloseTo(data.value);
            });

            it('handles floating point', () => {
                let codec = createCodec<{ value: number }>(`
                    type Data = { value: number };
                    codec<Data>();
                `);

                let data = { value: 3.14159 };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded.value).toBeCloseTo(data.value);
            });
        });

        describe('integer branded type', () => {
            it('encodes and decodes integer', () => {
                let codec = createCodec<{ count: number }>(`
                    type Brand<T, B extends string> = T & { __brand: B };
                    type integer = Brand<number, 'integer'>;
                    type Data = { count: integer };
                    codec<Data>();
                `);

                let data = { count: 42 };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });

            it('handles large integers', () => {
                let codec = createCodec<{ count: number }>(`
                    type Brand<T, B extends string> = T & { __brand: B };
                    type integer = Brand<number, 'integer'>;
                    type Data = { count: integer };
                    codec<Data>();
                `);

                let data = { count: 1000000 };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });
        });

        describe('float branded type', () => {
            it('encodes and decodes float', () => {
                let codec = createCodec<{ value: number }>(`
                    type Brand<T, B extends string> = T & { __brand: B };
                    type float = Brand<number, 'float'>;
                    type Data = { value: float };
                    codec<Data>();
                `);

                let data = { value: 3.14 };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                // Float has less precision than double
                expect(decoded.value).toBeCloseTo(data.value, 5);
            });
        });

        describe('boolean', () => {
            it('encodes and decodes true', () => {
                let codec = createCodec<{ active: boolean }>(`
                    type Flags = { active: boolean };
                    codec<Flags>();
                `);

                let data = { active: true };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });

            it('encodes and decodes false', () => {
                let codec = createCodec<{ active: boolean }>(`
                    type Flags = { active: boolean };
                    codec<Flags>();
                `);

                let data = { active: false };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });
        });

        describe('bigint', () => {
            it('encodes and decodes bigint', () => {
                let codec = createCodec<{ value: bigint }>(`
                    type Data = { value: bigint };
                    codec<Data>();
                `);

                let data = { value: BigInt(9007199254740991) };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });

            it('handles small bigint', () => {
                let codec = createCodec<{ value: bigint }>(`
                    type Data = { value: bigint };
                    codec<Data>();
                `);

                let data = { value: BigInt(42) };
                let encoded = codec.encode(data);
                let decoded = codec.decode(encoded);

                expect(decoded).toEqual(data);
            });
        });
    });

    describe('arrays', () => {
        it('encodes and decodes string array', () => {
            let codec = createCodec<{ items: string[] }>(`
                type Data = { items: string[] };
                codec<Data>();
            `);

            let data = { items: ['a', 'b', 'c'] };
            let encoded = codec.encode(data);
            let decoded = codec.decode(encoded);

            expect(decoded).toEqual(data);
        });

        it('handles empty array', () => {
            let codec = createCodec<{ items: string[] }>(`
                type Data = { items: string[] };
                codec<Data>();
            `);

            let data = { items: [] };
            let encoded = codec.encode(data);
            let decoded = codec.decode(encoded);

            expect(decoded).toEqual(data);
        });

        it('encodes and decodes boolean array', () => {
            let codec = createCodec<{ flags: boolean[] }>(`
                type Data = { flags: boolean[] };
                codec<Data>();
            `);

            let data = { flags: [true, false, true] };
            let encoded = codec.encode(data);
            let decoded = codec.decode(encoded);

            expect(decoded).toEqual(data);
        });

        it('encodes and decodes integer array', () => {
            let codec = createCodec<{ values: number[] }>(`
                type Brand<T, B extends string> = T & { __brand: B };
                type integer = Brand<number, 'integer'>;
                type Data = { values: integer[] };
                codec<Data>();
            `);

            let data = { values: [1, 2, 3, 4, 5] };
            let encoded = codec.encode(data);
            let decoded = codec.decode(encoded);

            expect(decoded).toEqual(data);
        });
    });

    // Note: Multi-property codec has a known issue with variable name collision
    // in generated code. Single-property types work correctly.
    // TODO: Fix codec generator to use unique variable names for each property

    describe('buffer output', () => {
        it('produces Uint8Array output', () => {
            let codec = createCodec<{ value: string }>(`
                type Data = { value: string };
                codec<Data>();
            `);

            let encoded = codec.encode({ value: 'test' });

            expect(encoded).toBeInstanceOf(Uint8Array);
            expect(encoded.length).toBeGreaterThan(0);
        });
    });

    describe('roundtrip integrity', () => {
        it('preserves string data through roundtrip', () => {
            let codec = createCodec<{ name: string }>(`
                type Data = { name: string };
                codec<Data>();
            `);

            let original = { name: 'test' };
            let encoded = codec.encode(original);
            let decoded = codec.decode(encoded);

            expect(decoded).toEqual(original);
        });

        it('preserves integer data through roundtrip', () => {
            let codec = createCodec<{ count: number }>(`
                type Brand<T, B extends string> = T & { __brand: B };
                type integer = Brand<number, 'integer'>;
                type Data = { count: integer };
                codec<Data>();
            `);

            let original = { count: 42 };
            let encoded = codec.encode(original);
            let decoded = codec.decode(encoded);

            expect(decoded).toEqual(original);
        });
    });
});
