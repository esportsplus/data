import { describe, expect, it } from 'vitest';
import { ts } from '@esportsplus/typescript';
import type { JsonSchema } from '../../src/types';
import { analyzeRootType } from '../../src/compiler/type-analyzer';
import { generateJsonSchema } from '../../src/json-schema';
import { compile, createValidator } from '../utils';


const DRAFT = 'https://json-schema.org/draft/2020-12/schema';


function findTypeArgument(node: ts.Node): ts.TypeNode | undefined {
    if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
        return node.typeArguments[0];
    }

    return node.forEachChild(findTypeArgument);
}

function getRoot(code: string) {
    let { checker, sourceFile } = compile(`declare function test<T>(): T;\n${code}`),
        typeNode = findTypeArgument(sourceFile);

    if (!typeNode) {
        throw new Error('JSON schema emitter test: no type argument found in source');
    }

    return analyzeRootType(typeNode, checker);
}

function schemaOf(code: string, constraints?: Map<string, JsonSchema>): JsonSchema {
    return JSON.parse(generateJsonSchema(getRoot(code), constraints));
}


describe('JSON Schema emitter: primitive rows', () => {
    it('emits {} for an any root (empty schema, $schema only)', () => {
        expect(schemaOf('test<any>();')).toEqual({ $schema: DRAFT });
    });

    it('emits {} for an unknown property', () => {
        expect(schemaOf('type T = { x: unknown }; test<T>();')).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { x: {} },
            required: ['x'],
            type: 'object'
        });
    });

    it('emits { not: {} } for a never root', () => {
        expect(schemaOf('test<never>();')).toEqual({ $schema: DRAFT, not: {} });
    });

    it('emits { type: null } for a null root', () => {
        expect(schemaOf('test<null>();')).toEqual({ $schema: DRAFT, type: 'null' });
    });

    it('emits { type: boolean } for a boolean root', () => {
        expect(schemaOf('test<boolean>();')).toEqual({ $schema: DRAFT, type: 'boolean' });
    });

    it('emits { type: number } for a plain number root', () => {
        expect(schemaOf('test<number>();')).toEqual({ $schema: DRAFT, type: 'number' });
    });

    it('emits { type: integer } for a branded integer', () => {
        expect(schemaOf(`
            type Brand<T, B extends string> = T & { __brand: B };
            type integer = Brand<number, 'integer'>;
            type T = { n: integer };
            test<T>();
        `)).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { n: { type: 'integer' } },
            required: ['n'],
            type: 'object'
        });
    });

    it('emits { type: number } for a branded float', () => {
        expect(schemaOf(`
            type Brand<T, B extends string> = T & { __brand: B };
            type float = Brand<number, 'float'>;
            type T = { n: float };
            test<T>();
        `)).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { n: { type: 'number' } },
            required: ['n'],
            type: 'object'
        });
    });

    it('emits { type: integer } for a bigint root', () => {
        expect(schemaOf('test<bigint>();')).toEqual({ $schema: DRAFT, type: 'integer' });
    });

    it('emits { type: string } for a string root', () => {
        expect(schemaOf('test<string>();')).toEqual({ $schema: DRAFT, type: 'string' });
    });

    it('emits { type: string } with no brand keyword for a template literal string', () => {
        expect(schemaOf('type T = `${string}@${string}`; test<T>();')).toEqual({
            $schema: DRAFT,
            type: 'string'
        });
    });

    it('emits date-time format for a Date root', () => {
        expect(schemaOf('test<Date>();')).toEqual({
            $schema: DRAFT,
            format: 'date-time',
            type: 'string'
        });
    });
});

describe('JSON Schema emitter: literal and enum rows', () => {
    it('emits { const } for a single literal', () => {
        expect(schemaOf("test<'hello'>();")).toEqual({ $schema: DRAFT, const: 'hello' });
    });

    it('emits a sorted { enum } for a pure literal union', () => {
        expect(schemaOf("test<'c' | 'a' | 'b'>();")).toEqual({
            $schema: DRAFT,
            enum: ['a', 'b', 'c']
        });
    });
});

describe('JSON Schema emitter: array, tuple, record rows', () => {
    it('emits array with item schema', () => {
        expect(schemaOf('test<string[]>();')).toEqual({
            $schema: DRAFT,
            items: { type: 'string' },
            type: 'array'
        });
    });

    it('emits tuple with prefixItems, items false and minItems for optional trailing element', () => {
        expect(schemaOf('test<[string, number?]>();')).toEqual({
            $schema: DRAFT,
            items: false,
            minItems: 1,
            prefixItems: [{ type: 'string' }, { type: 'number' }],
            type: 'array'
        });
    });

    it('emits record with additionalProperties schema', () => {
        expect(schemaOf('test<Record<string, number>>();')).toEqual({
            $schema: DRAFT,
            additionalProperties: { type: 'number' },
            type: 'object'
        });
    });
});

describe('JSON Schema emitter: object row', () => {
    it('emits the full User shape with sorted required', () => {
        expect(schemaOf(`
            type User = {
                active: boolean;
                age: number;
                id: string;
                tags: string[];
            };
            test<User>();
        `)).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: {
                active: { type: 'boolean' },
                age: { type: 'number' },
                id: { type: 'string' },
                tags: { items: { type: 'string' }, type: 'array' }
            },
            required: ['active', 'age', 'id', 'tags'],
            type: 'object'
        });
    });

    it('omits required entirely on an all-optional object', () => {
        let schema = schemaOf('type T = { a?: string; b?: number }; test<T>();');

        expect(schema.required).toBeUndefined();
        expect(schema).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            type: 'object'
        });
    });

    it('emits a root $ref for a self-referential property', () => {
        expect(schemaOf(`
            type Node = { next: Node; value: number };
            test<Node>();
        `)).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { next: { $ref: '#' }, value: { type: 'number' } },
            required: ['next', 'value'],
            type: 'object'
        });
    });

    it('places $schema on the root object only, never nested', () => {
        let schema = schemaOf('type T = { inner: { a: string } }; test<T>();');

        expect(schema.$schema).toBe(DRAFT);
        expect(schema.properties!.inner.$schema).toBeUndefined();
    });
});

describe('JSON Schema emitter: union row', () => {
    it('emits anyOf for a mixed primitive union', () => {
        let schema = schemaOf('test<string | number>();');

        expect(schema.$schema).toBe(DRAFT);
        expect(schema.anyOf).toHaveLength(2);
        expect(schema.anyOf).toEqual(
            expect.arrayContaining([{ type: 'string' }, { type: 'number' }])
        );
    });

    it('batches the literal members as one anyOf entry', () => {
        let schema = schemaOf("type T = { x: 'a' | number }; test<T>();"),
            inner = schema.properties!.x;

        expect(inner.anyOf).toHaveLength(2);
        expect(inner.anyOf).toEqual(
            expect.arrayContaining([{ const: 'a' }, { type: 'number' }])
        );
    });
});

describe('JSON Schema emitter: nullable wrap', () => {
    it('collapses a single-type schema to a type array', () => {
        expect(schemaOf('test<string | null>();')).toEqual({
            $schema: DRAFT,
            type: ['string', 'null']
        });
    });

    it('wraps a multi-key schema in anyOf with a null branch', () => {
        expect(schemaOf('test<string[] | null>();')).toEqual({
            $schema: DRAFT,
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }]
        });
    });
});

describe('JSON Schema emitter: constraint merge', () => {
    it('merges fragment keywords and overrides number with integer', () => {
        let constraints = new Map<string, JsonSchema>([
                ['age', { minimum: 0, type: 'integer' }],
                ['name', { maxLength: 10 }]
            ]),
            schema = schemaOf('type T = { age: number; name: string }; test<T>();', constraints);

        expect(schema).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: {
                age: { minimum: 0, type: 'integer' },
                name: { maxLength: 10, type: 'string' }
            },
            required: ['age', 'name'],
            type: 'object'
        });
    });
});

describe('JSON Schema emitter: determinism', () => {
    it('produces byte-identical output across repeated calls on the same IR', () => {
        let root = getRoot(`
            type User = {
                active: boolean;
                age: number;
                id: string;
                tags: string[];
            };
            test<User>();
        `);

        expect(generateJsonSchema(root)).toBe(generateJsonSchema(root));
    });

    it('serializes object keys in sorted order at every depth', () => {
        let text = generateJsonSchema(getRoot('type T = { b: string; a: number }; test<T>();'));

        expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
        expect(text.indexOf('"additionalProperties"')).toBeLessThan(text.indexOf('"properties"'));
    });
});

describe('JSON Schema emitter: intersection flattening', () => {
    it('flattens a nested all-object intersection into one merged property set', () => {
        expect(schemaOf(`
            type A = { a: string };
            type B = { b: number };
            type T = { both: A & B };
            test<T>();
        `)).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: {
                both: {
                    additionalProperties: false,
                    properties: { a: { type: 'string' }, b: { type: 'number' } },
                    required: ['a', 'b'],
                    type: 'object'
                }
            },
            required: ['both'],
            type: 'object'
        });
    });

    it('flattens a root all-object intersection into a full object schema', () => {
        expect(schemaOf(`
            type A = { a: string };
            type B = { b: number };
            type T = A & B;
            test<T>();
        `)).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            required: ['a', 'b'],
            type: 'object'
        });
    });

    it('reserves allOf for an intersection whose constituents are not all objects', () => {
        let schema = schemaOf('type T = string & { tag: number }; test<T>();');

        expect(schema.$schema).toBe(DRAFT);
        expect(schema.allOf).toHaveLength(2);
        expect(schema.allOf).toEqual(
            expect.arrayContaining([
                { type: 'string' },
                {
                    additionalProperties: false,
                    properties: { tag: { type: 'number' } },
                    required: ['tag'],
                    type: 'object'
                }
            ])
        );
    });

    it('validates both constituents of a flattened intersection at runtime', () => {
        let validate = createValidator(`
            type A = { a: string };
            type B = { b: number };
            type Data = { both: A & B };
            validator.build<Data>();
        `);

        expect(validate({ both: { a: 'x', b: 1 } }).ok).toBe(true);
        expect(validate({ both: { a: 'x' } }).ok).toBe(false);
        expect(validate({ both: { a: 1, b: 1 } }).ok).toBe(false);
    });
});

describe('JSON Schema emitter: recursion refs', () => {
    it('emits a root $ref at a self-referential recursion point', () => {
        expect(schemaOf(`
            type Cat = { kids: Cat[]; name: string };
            test<Cat>();
        `)).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: {
                kids: { items: { $ref: '#' }, type: 'array' },
                name: { type: 'string' }
            },
            required: ['kids', 'name'],
            type: 'object'
        });
    });

    it('emits a $defs entry and #/$defs ref for a non-root named cycle', () => {
        let branch = {
            additionalProperties: false,
            properties: {
                children: { items: { $ref: '#/$defs/Branch' }, type: 'array' },
                label: { type: 'string' }
            },
            required: ['children', 'label'],
            type: 'object'
        };

        expect(schemaOf(`
            type Tree = { root: Branch };
            type Branch = { children: Branch[]; label: string };
            test<Tree>();
        `)).toEqual({
            $defs: { Branch: branch },
            $schema: DRAFT,
            additionalProperties: false,
            properties: { root: branch },
            required: ['root'],
            type: 'object'
        });
    });
});

describe('JSON Schema emitter: readonly annotation', () => {
    it('emits readOnly: true for a readonly property', () => {
        expect(schemaOf('type T = { readonly id: string }; test<T>();')).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { id: { readOnly: true, type: 'string' } },
            required: ['id'],
            type: 'object'
        });
    });

    it('lands the readonly flag only on readonly properties in the IR', () => {
        let root = getRoot('type T = { readonly id: string; name: string }; test<T>();');

        expect(root.properties?.find((p) => p.name === 'id')?.readonly).toBe(true);
        expect(root.properties?.find((p) => p.name === 'name')?.readonly).toBeUndefined();
    });
});

describe('JSON Schema emitter: confirmed-correct emissions stay stable', () => {
    it('emits a discriminated union as anyOf of const-tagged object branches', () => {
        let schema = schemaOf(`
            type T = { kind: 'a'; x: number } | { kind: 'b'; y: string };
            test<T>();
        `);

        expect(schema.$schema).toBe(DRAFT);
        expect(schema.anyOf).toHaveLength(2);
        expect(schema.anyOf).toEqual(
            expect.arrayContaining([
                {
                    additionalProperties: false,
                    properties: { kind: { const: 'a' }, x: { type: 'number' } },
                    required: ['kind', 'x'],
                    type: 'object'
                },
                {
                    additionalProperties: false,
                    properties: { kind: { const: 'b' }, y: { type: 'string' } },
                    required: ['kind', 'y'],
                    type: 'object'
                }
            ])
        );
    });
});
