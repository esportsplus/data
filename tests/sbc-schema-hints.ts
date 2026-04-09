import { coordinator } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';
import { describe, expect, test } from 'vitest';

import { createCodec } from '../src/sbc';
import sbcPlugin from '../src/compiler/sbc';


let compilerOptions: ts.CompilerOptions = {
    lib: ['lib.es2020.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    target: ts.ScriptTarget.ES2020
};

let preamble = `
    type FieldSpec = { name: string; nullable?: boolean; type: string; };
    declare const codec: {
        decode<T>(buffer: Uint8Array, options?: { schema?: number | FieldSpec[] }): T;
        defineSchema(fields: FieldSpec[]): number;
        encode<T>(value: T, options?: boolean | { schema?: number | FieldSpec[]; view?: boolean }): Uint8Array;
    };
`;


function transformCodec2(code: string): string {
    let filename = 'test.ts',
        fullCode = preamble + code,
        host = ts.createCompilerHost(compilerOptions),
        originalGetSourceFile = host.getSourceFile.bind(host);

    host.getSourceFile = (name, languageVersion) => {
        if (name === filename) {
            return ts.createSourceFile(name, fullCode, languageVersion, true);
        }

        return originalGetSourceFile(name, languageVersion);
    };

    host.fileExists = (name) => {
        if (name === filename) {
            return true;
        }

        return ts.sys.fileExists(name);
    };

    host.readFile = (name) => {
        if (name === filename) {
            return fullCode;
        }

        return ts.sys.readFile(name);
    };

    let program = ts.createProgram([filename], compilerOptions, host),
        shared = new Map(),
        sourceFile = program.getSourceFile(filename)!;

    return coordinator.transform([sbcPlugin], fullCode, sourceFile, program, shared).code;
}


// Part 1: Compiler Transformation Tests
describe('codec2 compiler plugin transformations', () => {
    test('simple type — encode injects schema with float64 and string', () => {
        let code = `codec.encode<{age: number; name: string}>({age: 25, name: 'Alice'})`;
        let result = transformCodec2(code);

        expect(result).toContain('"schema"');
        expect(result).toContain('"float64"');
        expect(result).toContain('"string"');
        expect(result).toContain('"age"');
        expect(result).toContain('"name"');
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

    test('optional field — age?: number has nullable true', () => {
        let code = `
            type Data = { age?: number; name: string };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"nullable":true');
        expect(result).toContain('"age"');
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

    test('record field — Record<string, number> maps to map type', () => {
        let code = `
            type Data = { scores: Record<string, number> };
            declare let d: Data;
            codec.encode<Data>(d);
        `;
        let result = transformCodec2(code);

        expect(result).toContain('"type":"map"');
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
        let codec = createCodec();
        let hash = codec.defineSchema([
            { name: 'age', type: 'uint8' },
            { name: 'name', type: 'string' },
        ]);
        let obj = { age: 25, name: 'Alice' };
        let normal = codec.encode(obj);
        let hinted = codec.encode(obj, { schema: hash });

        expect(hinted).toEqual(normal);
        expect(codec.decode(hinted)).toEqual(obj);
    });

    test('encode with FieldSpec[] auto-registers and matches', () => {
        let codec = createCodec();
        let specs = [
            { name: 'age', type: 'uint8' },
            { name: 'name', type: 'string' },
        ];
        let obj = { age: 30, name: 'Bob' };
        let hinted = codec.encode(obj, { schema: specs });
        let decoded = codec.decode(hinted);

        expect(decoded).toEqual(obj);
    });

    test('decode with hash hint', () => {
        let codec = createCodec();
        let hash = codec.defineSchema([
            { name: 'active', type: 'boolean' },
            { name: 'score', type: 'float64' },
        ]);
        let obj = { active: true, score: 99.5 };
        let encoded = codec.encode(obj, { schema: hash });
        let decoded = codec.decode(encoded, { schema: hash });

        expect(decoded).toEqual(obj);
    });

    test('decode with wrong hash falls through to normal decode', () => {
        let codec = createCodec();
        let hash1 = codec.defineSchema([{ name: 'name', type: 'string' }]);
        let hash2 = codec.defineSchema([{ name: 'age', type: 'uint8' }]);
        let obj = { name: 'test' };
        let encoded = codec.encode(obj, { schema: hash1 });
        let decoded = codec.decode(encoded, { schema: hash2 });

        expect(decoded).toEqual(obj);
    });

    test('decode with unknown hash throws', () => {
        let codec = createCodec();

        expect(() => codec.decode(
            new Uint8Array([8, 0, 0, 0, 0, 0, 0, 0, 0]),
            { schema: 99999 }
        )).toThrow('Codec2: unknown schema hash');
    });

    test('encode with unknown hash falls through to inference', () => {
        let codec = createCodec();
        let obj = { name: 'test' };
        let encoded = codec.encode(obj, { schema: 12345 });
        let decoded = codec.decode(encoded);

        expect(decoded).toEqual(obj);
    });

    test('encode with view option and schema hint', () => {
        let codec = createCodec();
        let hash = codec.defineSchema([{ name: 'x', type: 'uint8' }]);
        let obj = { x: 42 };
        let view = codec.encode(obj, { schema: hash, view: true });

        expect(view).toBeInstanceOf(Uint8Array);
        expect(codec.decode(view)).toEqual(obj);
    });

    test('backward compat: encode(value, true) still works', () => {
        let codec = createCodec();
        let obj = { name: 'test' };
        let result = codec.encode(obj, true);

        expect(result).toBeInstanceOf(Uint8Array);
        expect(codec.decode(result)).toEqual(obj);
    });

    test('backward compat: decode(buffer, length) still works', () => {
        let codec = createCodec();
        let obj = { name: 'test' };
        let encoded = codec.encode(obj);
        let decoded = codec.decode(encoded, encoded.length);

        expect(decoded).toEqual(obj);
    });

    test('nullable field round-trip with schema hint', () => {
        let codec = createCodec();
        let hash = codec.defineSchema([
            { name: 'email', nullable: true, type: 'string' },
            { name: 'name', type: 'string' },
        ]);
        let obj = { email: null, name: 'Carol' };
        let encoded = codec.encode(obj, { schema: hash });
        let decoded = codec.decode(encoded, { schema: hash });

        expect(decoded).toEqual(obj);
    });

    test('compressed schema hint', () => {
        let codec = createCodec({ compress: true });
        let hash = codec.defineSchema([
            { name: 'active', type: 'boolean' },
            { name: 'score', type: 'float64' },
        ]);
        let obj = { active: true, score: 42.5 };
        let encoded = codec.encode(obj, { schema: hash });
        let decoded = codec.decode(encoded, { schema: hash });

        expect(decoded).toEqual(obj);
    });
});


// Part 3: Compile + Run Round-Trip (true end-to-end)
describe('codec2 compile + run round-trip', () => {
    test('compiled encode<T> produces valid schema that works at runtime', () => {
        let code = `codec.encode<{age: number; name: string}>({age: 25, name: 'Alice'})`;
        let transformed = transformCodec2(code);

        // Verify the transformation happened
        expect(transformed).toContain('"schema"');
        expect(transformed).toContain('"float64"');
        expect(transformed).toContain('"string"');

        // Extract the schema from the transformed output and run it with real codec
        let schemaMatch = transformed.match(/"schema":(\[.*?\])/);

        expect(schemaMatch).not.toBeNull();

        let schema = JSON.parse(schemaMatch![1]);
        let codec = createCodec();
        let user = { age: 25, name: 'Alice' };
        let encoded = codec.encode(user, { schema });
        let decoded = codec.decode(encoded, { schema });

        expect(decoded).toEqual(user);
    });

    test('compiled decode<T> schema works at runtime', () => {
        let code = `
            declare let buf: Uint8Array;
            codec.decode<{active: boolean; score: number}>(buf);
        `;
        let transformed = transformCodec2(code);

        expect(transformed).toContain('"schema"');

        let schemaMatch = transformed.match(/"schema":(\[.*?\])/);

        expect(schemaMatch).not.toBeNull();

        let schema = JSON.parse(schemaMatch![1]);
        let codec = createCodec();
        let obj = { active: true, score: 99.5 };
        let encoded = codec.encode(obj, { schema });
        let decoded = codec.decode(encoded, { schema });

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

        let schemaMatch = transformed.match(/"schema":(\[.*?\])/);

        expect(schemaMatch).not.toBeNull();

        let schema = JSON.parse(schemaMatch![1]);
        let codec = createCodec();

        // With null value
        let obj1 = { email: null, name: 'Test' };
        let encoded1 = codec.encode(obj1, { schema });
        let decoded1 = codec.decode(encoded1, { schema });

        expect(decoded1).toEqual(obj1);

        // With non-null value
        let obj2 = { email: 'test@example.com', name: 'Test' };
        let encoded2 = codec.encode(obj2, { schema });
        let decoded2 = codec.decode(encoded2, { schema });

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

        let schemaMatch = transformed.match(/"schema":(\[.*?\])/);

        expect(schemaMatch).not.toBeNull();

        let schema = JSON.parse(schemaMatch![1]);
        let codec = createCodec();
        let packet = { id: 42, label: 'hello' };
        let encoded = codec.encode(packet, { schema });
        let decoded = codec.decode(encoded, { schema });

        expect(decoded).toEqual(packet);
    });

    test('compiled view=true option preserved with schema', () => {
        let code = `
            declare let obj: {name: string};
            codec.encode<{name: string}>(obj, true);
        `;
        let transformed = transformCodec2(code);

        // Should have both view:true and schema
        expect(transformed).toContain('"view":true');
        expect(transformed).toContain('"schema"');
    });

    test('compiled schema matches defineSchema hash for same fields', () => {
        let code = `codec.encode<{age: number; name: string}>({age: 25, name: 'Alice'})`;
        let transformed = transformCodec2(code);
        let schemaMatch = transformed.match(/"schema":(\[.*?\])/);

        expect(schemaMatch).not.toBeNull();

        let schema = JSON.parse(schemaMatch![1]);
        let codec = createCodec();

        // Register via defineSchema
        let hash = codec.defineSchema([
            { name: 'age', type: 'float64' },
            { name: 'name', type: 'string' },
        ]);

        // Encode with compiler-generated schema
        let encoded = codec.encode({ age: 25, name: 'Alice' }, { schema });

        // Decode with defineSchema hash — should work since same fields
        let decoded = codec.decode(encoded, { schema: hash });

        expect(decoded).toEqual({ age: 25, name: 'Alice' });
    });
});
