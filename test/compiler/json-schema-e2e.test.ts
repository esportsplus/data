import { describe, expect, it } from 'vitest';
import { transformCode } from '../utils';
import { validator } from '../../src/index';


const DRAFT = 'https://json-schema.org/draft/2020-12/schema';


describe('toJsonSchema transform wiring', () => {
    describe('E15 hoisted-const shape', () => {
        it('emits one hoisted const whose initializer parses to the expected schema', () => {
            let code = transformCode(
                "import { email, max, min } from '@esportsplus/data/validators';\n" +
                'type User = { email: string; name: string };\n' +
                'validator.toJsonSchema<User>({ email: email(), name: [min(3), max(20)] });\n'
            );

            expect(consts(code)).toBe(1);
            expect(firstSchema(code)).toEqual({
                '$schema': DRAFT,
                additionalProperties: false,
                properties: {
                    email: { format: 'email', type: 'string' },
                    name: { maxLength: 20, minLength: 3, type: 'string' }
                },
                required: ['email', 'name'],
                type: 'object'
            });
        });

        it('replaces the call site with the hoisted identifier', () => {
            let code = transformCode(
                'type User = { name: string };\n' +
                'validator.toJsonSchema<User>();\n'
            );

            let name = code.match(/const (schema_\w+) =/)![1];

            expect(code).not.toContain('toJsonSchema');
            expect(code).toContain(name + ';');
        });
    });

    describe('per-file dedup', () => {
        it('two identical calls share one const and one identifier', () => {
            let code = transformCode(
                'type User = { name: string };\n' +
                'validator.toJsonSchema<User>();\n' +
                'validator.toJsonSchema<User>();\n'
            );

            let name = code.match(/const (schema_\w+) =/)![1];

            expect(consts(code)).toBe(1);
            expect(code.split(name).length - 1).toBe(3);
        });

        it('two different types produce two consts', () => {
            let code = transformCode(
                'type A = { a: string };\n' +
                'type B = { b: number };\n' +
                'validator.toJsonSchema<A>();\n' +
                'validator.toJsonSchema<B>();\n'
            );

            expect(consts(code)).toBe(2);
        });
    });

    describe('optional and nullable mapping', () => {
        it('drops optional from required and unions null into the type', () => {
            let code = transformCode(
                'type Data = { age?: number; nickname: string | null };\n' +
                'validator.toJsonSchema<Data>();\n'
            );

            let schema = firstSchema(code),
                properties = schema.properties as Record<string, Record<string, unknown>>;

            expect(schema.required).toEqual(['nickname']);
            expect(properties.age).toEqual({ type: 'number' });
            expect(properties.nickname.type).toEqual(['string', 'null']);
        });
    });

    describe('namespace form', () => {
        it('transforms data.validator.toJsonSchema<T>()', () => {
            let code = transformCode(
                "import * as data from '@esportsplus/data';\n" +
                'type User = { name: string };\n' +
                'data.validator.toJsonSchema<User>();\n'
            );

            expect(code).not.toContain('data.validator.toJsonSchema');
            expect(consts(code)).toBe(1);
            expect((firstSchema(code) as { '$schema': string })['$schema']).toBe(DRAFT);
        });
    });

    describe('mixed build and toJsonSchema file', () => {
        it('transforms both, leaving a build function and a hoisted schema', () => {
            let code = transformCode(
                'type User = { name: string };\n' +
                'validator.build<User>();\n' +
                'validator.toJsonSchema<User>();\n'
            );

            expect(code).not.toContain('.build<');
            expect(code).not.toContain('.toJsonSchema<');
            expect(code).toContain('=>');
            expect(consts(code)).toBe(1);
        });
    });

    describe('non-static config argument', () => {
        it('hoists the structural schema but emits no constraint keywords', () => {
            let code = transformCode(
                "import { min } from '@esportsplus/data/validators';\n" +
                'type User = { name: string };\n' +
                'const cfg = { name: [min(3)] };\n' +
                'validator.toJsonSchema<User>(cfg);\n'
            );

            let schema = firstSchema(code),
                properties = schema.properties as Record<string, Record<string, unknown>>;

            expect(code).not.toContain('minLength');
            expect(properties.name).toEqual({ type: 'string' });
        });
    });

    describe('runtime stub', () => {
        it('throws the must-be-transformed error', () => {
            expect(() => validator.toJsonSchema<{ a: string }>()).toThrow(
                'validator.toJsonSchema<T>() must be transformed at compile-time'
            );
        });
    });
});


function consts(code: string): number {
    let matches = code.match(/const schema_\w+ = \{/g);

    return matches ? matches.length : 0;
}

function firstSchema(code: string): Record<string, unknown> {
    return schemas(code)[0] as Record<string, unknown>;
}

function schemas(code: string): unknown[] {
    let match: RegExpExecArray | null,
        out: unknown[] = [],
        pattern = /const schema_\w+ = (\{.*\});/g;

    while ((match = pattern.exec(code)) !== null) {
        out.push(JSON.parse(match[1]));
    }

    return out;
}
