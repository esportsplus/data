import { describe, expect, test } from 'vitest';

import { codec } from '../../../src/sbc';
import sbcPlugin from '../../../src/compiler/sbc';
import { transformWith } from '../../utils';


let preamble = `
    type FieldSpec = { name: string; nullable?: boolean; type: string; };
    declare const codec: {
        decode<T>(buffer: Uint8Array, options?: { schema?: number | FieldSpec[] }): T;
        defineSchema(fields: FieldSpec[]): number;
        encode<T>(value: T, options?: boolean | { schema?: number | FieldSpec[]; view?: boolean }): Uint8Array;
    };
`;


function bufferHash(u8: Uint8Array): number {
    return (u8[0]! === 8 || u8[0]! === 18)
        ? ((u8[1]! | (u8[2]! << 8) | (u8[3]! << 16) | (u8[4]! << 24)) >>> 0)
        : -1;
}

function extractSchema(transformed: string): FieldSpec[] | null {
    let match = transformed.match(/"schema":(\[.*?\])/);

    return match ? JSON.parse(match[1]!) as FieldSpec[] : null;
}

function transformCodec2(code: string): string {
    return transformWith([sbcPlugin], preamble + code);
}


type FieldSpec = { name: string; nullable?: boolean; type: string };


// Part 1: Compiler Transformation Tests — parity-or-omit emit/omit decisions
describe('codec2 compiler plugin transformations', () => {
    test('unbranded number field — whole type is hint-free (D5 divergence killed)', () => {
        let code = `codec.encode<{age: number; name: string}>({age: 25, name: 'Alice'})`;
        let result = transformCodec2(code);

        // A value-dependent-width field forces the WHOLE type hint-free — no schema injected.
        expect(result).not.toContain('"schema"');
        expect(result).toContain("codec.encode<{age: number; name: string}>({age: 25, name: 'Alice'})");
    });

    test('branded number types — uint8 brand maps to uint8', () => {
        let code = `
            type Uint8 = number & { __brand: 'uint8' };
            type Data = { value: Uint8 };
            codec.encode<Data>({value: 42 as Uint8});
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"type":"uint8"');
    });

    test('all-primitive type — string/boolean/bigint/date/uint8 emit a hint', () => {
        let code = `
            type Uint8 = number & { __brand: 'uint8' };
            type Data = { active: boolean; count: Uint8; name: string; stamp: Date; total: bigint };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"schema"');
        expect(result).toContain('"type":"boolean"');
        expect(result).toContain('"type":"uint8"');
        expect(result).toContain('"type":"string"');
        expect(result).toContain('"type":"date"');
        expect(result).toContain('"type":"int64"');
    });

    test('nullable field — string | null has nullable true', () => {
        let code = `
            type Data = { email: string | null; name: string };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"nullable":true');
        expect(result).toContain('"email"');
    });

    test('optional number field — whole type is hint-free', () => {
        let code = `
            type Data = { age?: number; name: string };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).not.toContain('"schema"');
    });

    test('array field — tags: string[] maps to array type', () => {
        let code = `
            type Data = { tags: string[] };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"type":"array"');
    });

    test('record field — Record<string, number> maps to object, never the retired map tag', () => {
        let code = `
            type Data = { scores: Record<string, number> };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"type":"object"');
        expect(result).not.toContain('"type":"map"');
    });

    test('nested object field — inline object maps to object type', () => {
        let code = `
            type Data = { address: { city: string } };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"type":"object"');
    });

    test('Uint8Array field — maps to bytes', () => {
        let code = `
            type Data = { data: Uint8Array };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"type":"bytes"');
        expect(result).not.toContain('"type":"object"');
    });

    test('Float32Array field — maps to typedarray', () => {
        let code = `
            type Data = { data: Float32Array };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"type":"typedarray"');
        expect(result).not.toContain('"type":"object"');
    });

    test('Map field — whole type is hint-free (Map retired as a value type)', () => {
        let code = `
            type Data = { m: Map<string, number> };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).not.toContain('"schema"');
    });

    test('Set field — whole type is hint-free (Set retired as a value type)', () => {
        let code = `
            type Data = { s: Set<number> };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).not.toContain('"schema"');
    });

    test('no type arg — codec.encode(obj) is unchanged', () => {
        let code = `
            declare let obj: {name: string};
            codec.encode(obj);
        `;
        let result = transformCodec2(code);

        // No schema injected — code should remain the same
        expect(result).not.toContain('"schema"');
        expect(result).toContain('codec.encode(obj)');
    });

    test('decode transformation — decode<T> injects schema', () => {
        let code = `
            declare let buf: Uint8Array;
            codec.decode<{name: string}>(buf);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"schema"');
        expect(result).toContain('"name"');
        expect(result).toContain('"string"');
    });

    test('existing boolean arg preserved — encode(obj, true) becomes view + schema', () => {
        let code = `
            declare let obj: {name: string};
            codec.encode<{name: string}>(obj, true);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"view":true');
        expect(result).toContain('"schema"');
    });
});


// Part 2: Runtime Round-Trip Tests
describe('codec2 schema hints runtime', () => {
    test('encode with hash hint matches normal encode', () => {
        let c = codec();
        let hash = c.defineSchema([
            { name: 'age', type: 'uint8' },
            { name: 'name', type: 'string' },
        ]);
        let obj = { age: 25, name: 'Alice' };
        let normal = c.encode(obj);
        let hinted = c.encode(obj, { schema: hash });

        expect(hinted).toEqual(normal);
        expect(c.decode(hinted)).toEqual(obj);
    });

    test('encode with FieldSpec[] auto-registers and matches', () => {
        let c = codec();
        let specs = [
            { name: 'age', type: 'uint8' },
            { name: 'name', type: 'string' },
        ];
        let obj = { age: 30, name: 'Bob' };
        let hinted = c.encode(obj, { schema: specs });
        let decoded = c.decode(hinted);

        expect(decoded).toEqual(obj);
    });

    test('decode with hash hint', () => {
        let c = codec();
        let hash = c.defineSchema([
            { name: 'active', type: 'boolean' },
            { name: 'score', type: 'float64' },
        ]);
        let obj = { active: true, score: 99.5 };
        let encoded = c.encode(obj, { schema: hash });
        let decoded = c.decode(encoded, { schema: hash });

        expect(decoded).toEqual(obj);
    });

    test('decode with wrong hash falls through to normal decode', () => {
        let c = codec();
        let hash1 = c.defineSchema([{ name: 'name', type: 'string' }]);
        let hash2 = c.defineSchema([{ name: 'age', type: 'uint8' }]);
        let obj = { name: 'test' };
        let encoded = c.encode(obj, { schema: hash1 });
        let decoded = c.decode(encoded, { schema: hash2 });

        expect(decoded).toEqual(obj);
    });

    test('decode with unknown hash throws', () => {
        let c = codec();

        expect(() => c.decode(
            new Uint8Array([8, 0, 0, 0, 0, 0, 0, 0, 0]),
            { schema: 99999 }
        )).toThrow('@esportsplus/data: codec unknown schema hash');
    });

    test('encode with unknown hash throws', () => {
        let c = codec();

        expect(() => c.encode({ name: 'test' }, { schema: 12345 })).toThrow('@esportsplus/data: codec unknown schema hash 12345');
    });

    test('encode with view option and schema hint', () => {
        let c = codec();
        let hash = c.defineSchema([{ name: 'x', type: 'uint8' }]);
        let obj = { x: 42 };
        let view = c.encode(obj, { schema: hash, view: true });

        expect(view).toBeInstanceOf(Uint8Array);
        expect(c.decode(view)).toEqual(obj);
    });

    test('backward compat: encode(value, true) still works', () => {
        let c = codec();
        let obj = { name: 'test' };
        let result = c.encode(obj, true);

        expect(result).toBeInstanceOf(Uint8Array);
        expect(c.decode(result)).toEqual(obj);
    });

    test('backward compat: decode(buffer, length) still works', () => {
        let c = codec();
        let obj = { name: 'test' };
        let encoded = c.encode(obj);
        let decoded = c.decode(encoded, encoded.length);

        expect(decoded).toEqual(obj);
    });

    test('nullable field round-trip with schema hint', () => {
        let c = codec();
        let hash = c.defineSchema([
            { name: 'email', nullable: true, type: 'string' },
            { name: 'name', type: 'string' },
        ]);
        let obj = { email: null, name: 'Carol' };
        let encoded = c.encode(obj, { schema: hash });
        let decoded = c.decode(encoded, { schema: hash });

        expect(decoded).toEqual(obj);
    });

    test('compressed schema hint', () => {
        let c = codec({ compress: true });
        let hash = c.defineSchema([
            { name: 'active', type: 'boolean' },
            { name: 'score', type: 'float64' },
        ]);
        let obj = { active: true, score: 42.5 };
        let encoded = c.encode(obj, { schema: hash });
        let decoded = c.decode(encoded, { schema: hash });

        expect(decoded).toEqual(obj);
    });
});


// Part 3: Compile + Run Parity — every emitted hint is byte-identical AND hash-identical to
// the pure-runtime inference path; every omitted hint leaves runtime inference untouched.
describe('codec2 compile + run parity', () => {
    test('unbranded number type — omitted hint stays byte-identical to runtime (11B, not float64 25B)', () => {
        let code = `codec.encode<{id: number; name: string}>({id: 25, name: 'Alice'})`;
        let transformed = transformCodec2(code);

        expect(transformed).not.toContain('"schema"');

        let value = { id: 25, name: 'Alice' },
            compiled = codec(),
            runtime = codec();

        // No hint emitted → the compiled call IS the runtime call.
        let encCompiled = compiled.encode(value),
            encRuntime = runtime.encode(value);

        expect(Array.from(encCompiled)).toEqual(Array.from(encRuntime));
        expect(compiled.decode(encCompiled)).toEqual(value);

        // The retired float64 hint bloated id=25 to 8 bytes; inference narrows it to uint8.
        let floatHinted = codec().encode(value, {
            schema: [{ name: 'id', type: 'float64' }, { name: 'name', type: 'string' }],
        });

        expect(encCompiled.length).toBeLessThan(floatHinted.length);
    });

    test('fully-branded type — emitted hint is byte + hash identical to runtime', () => {
        let code = `
            type Uint8 = number & { __brand: 'uint8' };
            type Packet = { flag: boolean; id: Uint8; label: string };
            declare let p: Packet;
            codec.encode<Packet>(p);
        `;
        let transformed = transformCodec2(code);
        let schema = extractSchema(transformed);

        expect(schema).not.toBeNull();

        let value = { flag: true, id: 42, label: 'hi' },
            compiled = codec(),
            runtime = codec();

        let encCompiled = compiled.encode(value, { schema: schema! }),
            encRuntime = runtime.encode(value);

        expect(Array.from(encCompiled)).toEqual(Array.from(encRuntime));
        expect(bufferHash(encCompiled)).toBe(bufferHash(encRuntime));
        expect(compiled.decode(encCompiled)).toEqual(value);
    });

    test('Uint8Array field — round-trips losslessly and byte-matches runtime', () => {
        let code = `
            type Data = { data: Uint8Array };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let transformed = transformCodec2(code);
        let schema = extractSchema(transformed);

        expect(schema).not.toBeNull();
        expect(transformed).toContain('"type":"bytes"');

        let value = { data: new Uint8Array([1, 2, 3, 4]) },
            compiled = codec(),
            runtime = codec();

        let encCompiled = compiled.encode(value, { schema: schema! }),
            encRuntime = runtime.encode(value);

        expect(Array.from(encCompiled)).toEqual(Array.from(encRuntime));
        expect(bufferHash(encCompiled)).toBe(bufferHash(encRuntime));

        let decoded = compiled.decode(encCompiled) as { data: Uint8Array };

        expect(decoded.data).toBeInstanceOf(Uint8Array);
        expect(Array.from(decoded.data)).toEqual([1, 2, 3, 4]);
    });

    test('Float32Array field — round-trips losslessly and byte-matches runtime', () => {
        let code = `
            type Data = { data: Float32Array };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let transformed = transformCodec2(code);
        let schema = extractSchema(transformed);

        expect(schema).not.toBeNull();
        expect(transformed).toContain('"type":"typedarray"');

        let value = { data: new Float32Array([1.5, 2.5, 3.5]) },
            compiled = codec(),
            runtime = codec();

        let encCompiled = compiled.encode(value, { schema: schema! }),
            encRuntime = runtime.encode(value);

        expect(Array.from(encCompiled)).toEqual(Array.from(encRuntime));
        expect(bufferHash(encCompiled)).toBe(bufferHash(encRuntime));
        expect(compiled.decode(encCompiled)).toEqual(value);
        expect((compiled.decode(encCompiled) as { data: Float32Array }).data).toBeInstanceOf(Float32Array);
    });

    test('Record field — compiled hint hash equals runtime-inferred hash', () => {
        let code = `
            type Data = { scores: Record<string, number> };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let transformed = transformCodec2(code);
        let schema = extractSchema(transformed);

        expect(schema).not.toBeNull();
        expect(transformed).toContain('"type":"object"');

        let value = { scores: { a: 1, b: 2 } },
            compiled = codec(),
            runtime = codec();

        let encCompiled = compiled.encode(value, { schema: schema! }),
            encRuntime = runtime.encode(value);

        // A compiled producer's hash must be one a runtime-only consumer registers.
        expect(bufferHash(encCompiled)).toBe(bufferHash(encRuntime));
        expect(Array.from(encCompiled)).toEqual(Array.from(encRuntime));
        expect(compiled.decode(encCompiled)).toEqual(value);
    });

    test('registry state after a compiled-hint encode matches the runtime-only registry', () => {
        let code = `
            type Uint8 = number & { __brand: 'uint8' };
            type P = { id: Uint8; name: string };
            declare let p: P;
            codec.encode<P>(p);
        `;
        let transformed = transformCodec2(code);
        let schema = extractSchema(transformed);

        expect(schema).not.toBeNull();

        let value = { id: 7, name: 'x' },
            compiled = codec(),
            runtime = codec();

        compiled.encode(value, { schema: schema! });
        runtime.encode(value);

        expect(Array.from(compiled.serializeRegistry())).toEqual(Array.from(runtime.serializeRegistry()));
    });

    test('compiled decode<T> schema works at runtime', () => {
        let code = `
            declare let buf: Uint8Array;
            codec.decode<{active: boolean; name: string}>(buf);
        `;
        let transformed = transformCodec2(code);
        let schema = extractSchema(transformed);

        expect(schema).not.toBeNull();

        let c = codec();
        let obj = { active: true, name: 'end' };
        let encoded = c.encode(obj, { schema: schema! });
        let decoded = c.decode(encoded, { schema: schema! });

        expect(decoded).toEqual(obj);
    });

    test('compiled nullable type round-trips correctly', () => {
        let code = `
            type User = { email: string | null; name: string };
            declare let u: User;
            codec.encode<User>(u);
        `;
        let transformed = transformCodec2(code);

        expect(transformed).toContain('"nullable":true');

        let schema = extractSchema(transformed);

        expect(schema).not.toBeNull();

        let c = codec();

        let obj1 = { email: null, name: 'Test' };
        let encoded1 = c.encode(obj1, { schema: schema! });
        let decoded1 = c.decode(encoded1, { schema: schema! });

        expect(decoded1).toEqual(obj1);

        let obj2 = { email: 'test@example.com', name: 'Test' };
        let encoded2 = c.encode(obj2, { schema: schema! });
        let decoded2 = c.decode(encoded2, { schema: schema! });

        expect(decoded2).toEqual(obj2);
    });

    test('compiled branded type uses correct field type at runtime', () => {
        let code = `
            type Uint8 = number & { __brand: 'uint8' };
            type Packet = { id: Uint8; label: string };
            declare let p: Packet;
            codec.encode<Packet>(p);
        `;
        let transformed = transformCodec2(code);

        expect(transformed).toContain('"type":"uint8"');

        let schema = extractSchema(transformed);

        expect(schema).not.toBeNull();

        let c = codec();
        let packet = { id: 42, label: 'hello' };
        let encoded = c.encode(packet, { schema: schema! });
        let decoded = c.decode(encoded, { schema: schema! });

        expect(decoded).toEqual(packet);
    });

    test('compiled view=true option preserved with schema', () => {
        let code = `
            declare let obj: {name: string};
            codec.encode<{name: string}>(obj, true);
        `;
        let transformed = transformCodec2(code);

        expect(transformed).toContain('"view":true');
        expect(transformed).toContain('"schema"');
    });
});
