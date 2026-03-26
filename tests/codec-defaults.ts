import { describe, expect, it } from 'vitest';
import { createCodec, transformCode } from './utils';


describe('Codec: Defaults', () => {
    describe('generated code', () => {
        it('generates _applyDefaults when defaults argument is provided', () => {
            let code = transformCode(`
                type User = { age: number; name: string };
                codec<User>({ age: 0, name: 'default_name' });
            `);

            expect(code).toContain('_applyDefaults');
            expect(code).toContain('_defaults');
        });

        it('does not generate _applyDefaults when no defaults argument', () => {
            let code = transformCode(`
                type User = { age: number; name: string };
                codec<User>();
            `);

            expect(code).not.toContain('_applyDefaults');
        });

        it('generates undefined checks for each property', () => {
            let code = transformCode(`
                type User = { age: number; name: string };
                codec<User>({ age: 25, name: 'unknown' });
            `);

            expect(code).toContain("_result['age'] === undefined");
            expect(code).toContain("_result['name'] === undefined");
            expect(code).toContain("_defaults['age']");
            expect(code).toContain("_defaults['name']");
        });
    });

    describe('roundtrip with defaults', () => {
        it('preserves non-default values through encode/decode', () => {
            let codec = createCodec<{ age: number; name: string }>(`
                type User = { age: number; name: string };
                codec<User>({ age: 0, name: 'default_name' });
            `);

            let data = { age: 30, name: 'Alice' },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.name).toBe('Alice');
            expect(decoded.age).toBeCloseTo(30);
        });

        it('preserves zero values through full roundtrip (encoder writes all fields)', () => {
            let codec = createCodec<{ count: number; name: string }>(`
                type Data = { name: string; count: number };
                codec<Data>({ count: 42, name: 'default' });
            `);

            // Full roundtrip: encoder writes all fields including zero values,
            // so decoder reads them back and _applyDefaults sees defined values
            let data = { count: 0, name: 'test' },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.name).toBe('test');
            // count=0 is written and read back, not replaced by default
            expect(decoded.count).toBeCloseTo(0);
        });

        it('applies defaults when decoding a partial buffer (missing fields)', () => {
            let codec = createCodec<{ name: string }>(`
                type Data = { name: string };
                codec<Data>({ name: 'fallback' });
            `);

            // Decode an empty buffer - no fields present
            let decoded = codec.decode(new Uint8Array(0));

            // name field not in buffer -> undefined -> _applyDefaults fills it
            expect(decoded.name).toBe('fallback');
        });

        it('applies number default when decoding empty buffer', () => {
            let codec = createCodec<{ count: number }>(`
                type Brand<T, B extends string> = T & { __brand: B };
                type integer = Brand<number, 'integer'>;
                type Data = { count: integer };
                codec<Data>({ count: 42 });
            `);

            // Decode empty buffer - count not present -> undefined -> default applied
            let decoded = codec.decode(new Uint8Array(0));

            expect(decoded.count).toBe(42);
        });

        it('applies boolean default when decoding empty buffer', () => {
            let codec = createCodec<{ active: boolean }>(`
                type Data = { active: boolean };
                codec<Data>({ active: true });
            `);

            let decoded = codec.decode(new Uint8Array(0));

            expect(decoded.active).toBe(true);
        });

        it('preserves non-zero values and does not override with defaults', () => {
            let codec = createCodec<{ age: number; name: string }>(`
                type User = { age: number; name: string };
                codec<User>({ age: 99, name: 'default' });
            `);

            let data = { age: 25, name: 'Bob' },
                decoded = codec.decode(codec.encode(data));

            expect(decoded.name).toBe('Bob');
            expect(decoded.age).toBeCloseTo(25);
        });
    });

    describe('defaults with partial buffers', () => {
        it('applies defaults for all missing fields from empty buffer', () => {
            let codec = createCodec<{ active: boolean; count: number; name: string }>(`
                type Brand<T, B extends string> = T & { __brand: B };
                type integer = Brand<number, 'integer'>;
                type Data = { name: string; count: integer; active: boolean };
                codec<Data>({ active: true, count: 10, name: 'fallback' });
            `);

            // Empty buffer: no fields present -> all undefined -> all defaults applied
            let decoded = codec.decode(new Uint8Array(0));

            expect(decoded.name).toBe('fallback');
            expect(decoded.count).toBe(10);
            expect(decoded.active).toBe(true);
        });

        it('applies only missing defaults when some fields are present', () => {
            // Encode with one codec (no defaults), decode with another (with defaults)
            let codecEncode = createCodec<{ name: string }>(`
                type Data = { name: string };
                codec<Data>();
            `);

            let codecDecode = createCodec<{ name: string }>(`
                type Data = { name: string };
                codec<Data>({ name: 'fallback' });
            `);

            // Encode 'hello' - name field is on wire
            let encoded = codecEncode.encode({ name: 'hello' }),
                decoded = codecDecode.decode(encoded);

            // name was present on wire, so default is NOT applied
            expect(decoded.name).toBe('hello');
        });
    });
});
