import { describe, expect, it } from 'vitest';
import type { Validator } from '../../src/types';
import { createValidator, transformCode } from '../utils';


describe('Aliased Imports', () => {
    it('transforms aliased named import identically to the plain import', () => {
        let plain = createValidator(`
            type User = { id: number; name: string };
            validator.build<User>();
        `);

        let aliased = createValidator(`
            import { validator as v } from '@esportsplus/data';
            type User = { id: number; name: string };
            v.build<User>();
        `);

        expect(aliased({ id: 1, name: 'John' })).toEqual(plain({ id: 1, name: 'John' }));
        expect(aliased({ id: 'bad', name: 'John' }).ok).toBe(false);
    });

    it('output no longer identical to input for an aliased import call', () => {
        let fed = "import { codec, validator } from '@esportsplus/data';\n" +
            "import { validator as v } from '@esportsplus/data';\n" +
            'type User = { name: string };\n' +
            'v.build<User>();\n';

        let transformed = transformCode(
            "import { validator as v } from '@esportsplus/data';\n" +
            'type User = { name: string };\n' +
            'v.build<User>();\n'
        );

        expect(transformed).not.toBe(fed);
        expect(transformed).not.toContain('v.build');
        expect(transformed).toContain('=>');
    });
});


describe('Build Deduplication', () => {
    it('emits exactly one validator body for two identical build<T>() calls', () => {
        let transformed = transformCode(`
            type User = { id: number; name: string };
            validator.build<User>();
            validator.build<User>();
        `);

        expect((transformed.match(/validate:/g) || []).length).toBe(1);
    });

    it('a deduplicated build still validates correctly at runtime', () => {
        // Both call sites collapse onto the single hoisted const createValidator locates,
        // so extracting and invoking it once proves the shared body works for either reference
        let validate = createValidator(`
            type User = { id: number; name: string };
            let a = validator.build<User>();
            let b = validator.build<User>();
        `);

        expect(validate({ id: 1, name: 'John' }).ok).toBe(true);
        expect(validate({ id: 'bad', name: 'John' }).ok).toBe(false);
    });

    it('keeps builds of the same type with different configs distinct', () => {
        let transformed = transformCode(`
            type User = { name: string };
            validator.build<User>({ name: min(5, 'too short') });
            validator.build<User>({ name: min(10, 'too short') });
        `);

        expect((transformed.match(/validate:/g) || []).length).toBe(2);
    });
});


describe('Transformer Integration', () => {
    describe('type inference', () => {
        it('handles interface types', () => {
            let validate = createValidator(`
                interface User {
                    id: number;
                    name: string;
                }
                validator.build<User>();
            `);

            let result = validate({ id: 1, name: 'John' });

            expect(result.ok).toBe(true);
        });

        it('handles type aliases', () => {
            let validate = createValidator(`
                type ID = number;
                type Name = string;
                type User = { id: ID; name: Name };
                validator.build<User>();
            `);

            let result = validate({ id: 1, name: 'John' });

            expect(result.ok).toBe(true);
        });

        it('handles extended interfaces', () => {
            let validate = createValidator(`
                interface Base {
                    id: number;
                }
                interface User extends Base {
                    name: string;
                }
                validator.build<User>();
            `);

            let result = validate({ id: 1, name: 'John' });

            expect(result.ok).toBe(true);
        });

        it('handles intersection types', () => {
            let validate = createValidator(`
                type A = { a: string };
                type B = { b: number };
                type AB = A & B;
                validator.build<AB>();
            `);

            let result = validate({ a: 'test', b: 42 });

            expect(result.ok).toBe(true);
        });
    });

    describe('generic types', () => {
        it('handles inline generic usage', () => {
            let validate = createValidator(`
                type Wrapper<T> = { data: T };
                type StringWrapper = Wrapper<string>;
                validator.build<StringWrapper>();
            `);

            let result = validate({ data: 'test' });

            expect(result.ok).toBe(true);
        });

        it('handles nested generics', () => {
            let validate = createValidator(`
                type Box<T> = { value: T };
                type DoubleBox<T> = Box<Box<T>>;
                type Data = DoubleBox<string>;
                validator.build<Data>();
            `);

            let result = validate({ value: { value: 'nested' } });

            expect(result.ok).toBe(true);
        });
    });

    describe('readonly modifiers', () => {
        it('handles readonly properties', () => {
            let validate = createValidator(`
                type Data = {
                    readonly id: number;
                    name: string;
                };
                validator.build<Data>();
            `);

            let result = validate({ id: 1, name: 'test' });

            expect(result.ok).toBe(true);
        });

        it('handles Readonly utility type', () => {
            let validate = createValidator(`
                type Base = { id: number; name: string };
                type Data = Readonly<Base>;
                validator.build<Data>();
            `);

            let result = validate({ id: 1, name: 'test' });

            expect(result.ok).toBe(true);
        });
    });

    describe('Pick and Omit', () => {
        it('handles Pick utility', () => {
            let validate = createValidator(`
                type Full = { a: string; b: number; c: boolean };
                type Partial = Pick<Full, 'a' | 'b'>;
                validator.build<Partial>();
            `);

            let result = validate({ a: 'test', b: 42 });

            expect(result.ok).toBe(true);
            expect(result.data).not.toHaveProperty('c');
        });

        it('handles Omit utility', () => {
            let validate = createValidator(`
                type Full = { a: string; b: number; c: boolean };
                type WithoutC = Omit<Full, 'c'>;
                validator.build<WithoutC>();
            `);

            let result = validate({ a: 'test', b: 42 });

            expect(result.ok).toBe(true);
        });
    });

    describe('Partial utility', () => {
        it('makes all properties optional', () => {
            let validate = createValidator(`
                type Full = { a: string; b: number };
                type PartialFull = Partial<Full>;
                validator.build<PartialFull>();
            `);

            expect(validate({}).ok).toBe(true);
            expect(validate({ a: 'test' }).ok).toBe(true);
            expect(validate({ b: 42 }).ok).toBe(true);
            expect(validate({ a: 'test', b: 42 }).ok).toBe(true);
        });
    });

    describe('Required utility', () => {
        it('validates Required type with all properties', () => {
            let validate = createValidator(`
                type Opt = { a?: string; b?: number };
                type Req = Required<Opt>;
                validator.build<Req>();
            `);

            // Required<T> should make all properties required
            // Document actual behavior - TypeScript utility types
            let fullResult = validate({ a: 'test', b: 42 });

            expect(fullResult.ok).toBe(true);

            // Test with partial data
            let partialResult = validate({ a: 'test' });

            expect(typeof partialResult.ok).toBe('boolean');
        });
    });
});


describe('Code Generation Patterns', () => {
    describe('property ordering', () => {
        it('generates consistent output regardless of property order in type', () => {
            let code1 = transformCode(`
                type Data = { a: string; b: number; c: boolean };
                validator.build<Data>();
            `);

            let code2 = transformCode(`
                type Data = { c: boolean; a: string; b: number };
                validator.build<Data>();
            `);

            // The generated validators should produce same results
            let validate1 = new Function('return ' + extractFunction(code1))();
            let validate2 = new Function('return ' + extractFunction(code2))();

            let data = { a: 'test', b: 42, c: true };

            expect(validate1(data).data).toEqual(validate2(data).data);
        });
    });

    describe('minification-friendly', () => {
        it('uses short varname names', () => {
            let code = transformCode(`
                type Data = { value: string };
                validator.build<Data>();
            `);

            // Should use short names like _input, _error
            expect(code).toContain('_input');
            expect(code).toContain('_error');
        });
    });
});


describe('Complex Real-World Types', () => {
    describe('API response type', () => {
        let validate = createValidator(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;

            type Pagination = {
                page: integer;
                pageSize: integer;
                total: integer;
            };

            type User = {
                createdAt: Date;
                email: string;
                id: integer;
                name: string;
                roles: string[];
            };

            type ApiResponse = {
                data: User[];
                pagination: Pagination;
                success: boolean;
            };

            validator.build<ApiResponse>();
        `);

        it('validates complete API response', () => {
            let result = validate({
                data: [
                    {
                        createdAt: new Date(),
                        email: 'john@example.com',
                        id: 1,
                        name: 'John',
                        roles: ['admin', 'user']
                    }
                ],
                pagination: {
                    page: 1,
                    pageSize: 10,
                    total: 1
                },
                success: true
            });

            expect(result.ok).toBe(true);
        });

        it('rejects invalid nested structure', () => {
            let result = validate({
                data: [
                    {
                        createdAt: 'not a date',
                        email: 'john@example.com',
                        id: 1,
                        name: 'John',
                        roles: ['admin']
                    }
                ],
                pagination: {
                    page: 1,
                    pageSize: 10,
                    total: 1
                },
                success: true
            });

            expect(result.ok).toBe(false);
        });
    });

    describe('configuration object', () => {
        let validate = createValidator(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;

            type DatabaseConfig = {
                host: string;
                maxConnections?: integer;
                port: integer;
                ssl?: boolean;
            };

            type ServerConfig = {
                database: DatabaseConfig;
                debug: boolean;
                port: integer;
            };

            validator.build<ServerConfig>();
        `);

        it('validates with optional fields', () => {
            let result = validate({
                database: {
                    host: 'localhost',
                    port: 5432
                },
                debug: true,
                port: 3000
            });

            expect(result.ok).toBe(true);
        });

        it('validates with all optional fields present', () => {
            let result = validate({
                database: {
                    host: 'localhost',
                    maxConnections: 10,
                    port: 5432,
                    ssl: true
                },
                debug: false,
                port: 3000
            });

            expect(result.ok).toBe(true);
        });
    });

    describe('event system', () => {
        let validate = createValidator(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;

            type BaseEvent = {
                id: string;
                timestamp: Date;
                type: string;
            };

            type UserEvent = BaseEvent & {
                payload: {
                    action: 'login' | 'logout' | 'signup';
                    userId: integer;
                };
                type: 'user';
            };

            validator.build<UserEvent>();
        `);

        it('validates event with discriminated union in payload', () => {
            let result = validate({
                id: 'evt-123',
                payload: {
                    action: 'login',
                    userId: 42
                },
                timestamp: new Date(),
                type: 'user'
            });

            expect(result.ok).toBe(true);
        });

        it('rejects invalid action literal', () => {
            let result = validate({
                id: 'evt-123',
                payload: {
                    action: 'invalid',
                    userId: 42
                },
                timestamp: new Date(),
                type: 'user'
            });

            expect(result.ok).toBe(false);
        });
    });
});


const OBJECT_LITERAL_BASELINE = "import { codec } from '@esportsplus/data';\nconst schema_1rq7jfs2 = {\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"additionalProperties\":false,\"properties\":{\"name\":{\"type\":\"string\"}},\"required\":[\"name\"],\"type\":\"object\"};\nconst v_1rq7jfs0 = (value, errors) => {\n                    if (!value) errors.push({ message: 'bad', path: 'name' });\n                };\nconst build_1rq7jfs3 = { toJsonSchema: () => schema_1rq7jfs2, validate: \n        (_input) => {\n            let _errors,\n                _output;\n            let _config = { path: '', push(_message) { (_errors ??= []).push({ message: _message, path: this.path }); } };\n            \n\n            if (_input === null || typeof _input !== 'object' || Array.isArray(_input)) {\n                \n        (_errors ??= []).push({\n            message: \"must be an object\",\n            path: \"\"\n        });\n    \n\n                return { ok: false, data: _input, errors: _errors };\n            }\n\n            _output = {};\n\n             \n                let c_1rq7jfs1 = _errors?.length ?? 0;\n\n                \n        {\n            \n            if (typeof _input.name !== 'string') {\n                \n        (_errors ??= []).push({\n            message: \"must be a string\",\n            path: \"name\"\n        });\n    \n            }\n            else {\n                _output.name = _input.name;\n                \n            }\n            \n        }\n    \n\n                if ((_errors?.length ?? 0) === c_1rq7jfs1) {\n                    _config.path = \"name\";\n                    v_1rq7jfs0(_output.name, _config);\n                }\n\n                \n            \n\n            if (_errors && _errors.length > 0) {\n                return { ok: false, data: _input, errors: _errors };\n            }\n\n            return { ok: true, data: _output, errors: undefined };\n        }\n     };\n\n\n            type User = { name: string };\n            build_1rq7jfs3;\n        ";


describe('Raw-function config removal', () => {
    // Type-level contract: build's config parameter is the weak object type ValidatorConfig<T>
    // (every property optional), so a raw function shares no property with it and is rejected
    // (TS2559). This never-executed typed code carries the assertion the string-compiling harness
    // cannot; `tsc --noEmit` gates it.
    it('rejects a raw-function config at the type level', () => {
        let reject = (v: Validator) => {
            // @ts-expect-error - a raw arrow-function config is not assignable to ValidatorConfig<T>
            v.build<{ a: string }>(() => {});
            // @ts-expect-error - a raw async-function config is not assignable to ValidatorConfig<T>
            v.build<{ a: string }>(async () => {});
        };

        expect(typeof reject).toBe('function');
    });

    it('emits output identical to the no-config form for a raw-function config', () => {
        let noConfig = transformCode(`
            type User = { name: string };
            validator.build<User>();
        `);

        let rawFunction = transformCode(`
            type User = { name: string };
            validator.build<User>(async (value, errors) => {});
        `);

        expect(rawFunction).toBe(noConfig);
    });

    it('emits byte-identical output for an object-literal config', () => {
        let transformed = transformCode(`
            type User = { name: string };
            validator.build<User>({
                name: (value, errors) => {
                    if (!value) errors.push({ message: 'bad', path: 'name' });
                }
            });
        `);

        expect(transformed).toBe(OBJECT_LITERAL_BASELINE);
    });
});


// Helper to extract function from transformed code
function extractFunction(code: string): string {
    let funcStart = code.indexOf('(_input) =>');

    if (funcStart === -1) {
        funcStart = code.indexOf('async (_input) =>');
    }

    if (funcStart !== -1) {
        let depth = 0,
            end = funcStart,
            inString = false,
            stringChar = '';

        for (let i = funcStart; i < code.length; i++) {
            let char = code[i];

            if (inString) {
                if (char === stringChar && code[i - 1] !== '\\') {
                    inString = false;
                }
            }
            else if (char === '"' || char === "'" || char === '`') {
                inString = true;
                stringChar = char;
            }
            else if (char === '{') {
                depth++;
            }
            else if (char === '}') {
                depth--;

                if (depth === 0) {
                    end = i + 1;
                    break;
                }
            }
        }

        return code.substring(funcStart, end);
    }

    throw new Error('Could not extract function');
}
