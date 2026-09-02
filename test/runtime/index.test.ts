import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../../src/types';
import { schema, toJsonSchema } from '../../src/runtime/index';
import { transformCode } from '../utils';


const DRAFT = 'https://json-schema.org/draft/2020-12/schema';


// The compile-time toJsonSchema<T>() hoists the emitted schema as a `const <name> = <json>;`;
// its body is pure JSON (the emitter's own stringify), so brace-match the first literal and parse.
function compileSchema(code: string): JsonSchema {
    let transformed = transformCode(code),
        match = transformed.match(/const\s+\w+\s*=\s*\{/);

    if (!match || match.index === undefined) {
        throw new Error('Runtime test: no schema literal in transformed output:\n' + transformed);
    }

    let depth = 0,
        end = 0,
        inString = false,
        open = transformed.indexOf('{', match.index),
        stringChar = '';

    for (let i = open, n = transformed.length; i < n; i++) {
        let char = transformed[i];

        if (inString) {
            if (char === stringChar && transformed[i - 1] !== '\\') {
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

    return JSON.parse(transformed.slice(open, end));
}


describe('runtime schema builder: enum (the driving case)', () => {
    it('emits an { enum } shape for a runtime string list', () => {
        expect(toJsonSchema(schema.enum(['a', 'b']))).toEqual({ $schema: DRAFT, enum: ['a', 'b'] });
    });

    it('sorts enum values, matching the compile-time literal-union emission', () => {
        expect(toJsonSchema(schema.enum(['c', 'a', 'b']))).toEqual(compileSchema("validator.toJsonSchema<'c' | 'a' | 'b'>();"));
    });

    it('builds z.enum-from-runtime-ids end to end (registry.ids() -> schema)', () => {
        let ids = ['plan', 'search'];

        expect(toJsonSchema(schema.enum(ids))).toEqual({ $schema: DRAFT, enum: ['plan', 'search'] });
    });

    it('emits { const } for a single-valued enum', () => {
        expect(toJsonSchema(schema.enum(['only']))).toEqual({ $schema: DRAFT, const: 'only' });
    });
});

describe('runtime schema builder: primitive and literal parity', () => {
    it('string root matches compile-time', () => {
        expect(toJsonSchema(schema.string())).toEqual(compileSchema('validator.toJsonSchema<string>();'));
    });

    it('number root matches compile-time', () => {
        expect(toJsonSchema(schema.number())).toEqual(compileSchema('validator.toJsonSchema<number>();'));
    });

    it('boolean root matches compile-time', () => {
        expect(toJsonSchema(schema.boolean())).toEqual(compileSchema('validator.toJsonSchema<boolean>();'));
    });

    it('literal root matches compile-time', () => {
        expect(toJsonSchema(schema.literal('hello'))).toEqual(compileSchema("validator.toJsonSchema<'hello'>();"));
    });

    it('unknown root emits the empty schema', () => {
        expect(toJsonSchema(schema.unknown())).toEqual({ $schema: DRAFT });
    });
});

describe('runtime schema builder: composition parity', () => {
    it('matches the compile-time path for an object/array/record/union composition with default and optional', () => {
        let node = schema.object({
            count: schema.number({ default: 0 }),
            id: schema.string(),
            kind: schema.union([schema.string(), schema.number()]),
            meta: schema.record(schema.number()),
            tags: schema.array(schema.string(), { optional: true })
        });

        expect(toJsonSchema(node)).toEqual(compileSchema(`
            type Cfg = {
                count: number;
                id: string;
                kind: string | number;
                meta: Record<string, number>;
                tags?: string[];
            };
            validator.toJsonSchema<Cfg>({ count: ((_v, _e) => {}).default(0) });
        `));
    });

    it('emits default onto the property schema', () => {
        expect(toJsonSchema(schema.object({ count: schema.number({ default: 0 }) }))).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { count: { default: 0, type: 'number' } },
            required: ['count'],
            type: 'object'
        });
    });

    it('carries description through the constraint channel', () => {
        expect(toJsonSchema(schema.object({ id: schema.string({ description: 'the id' }) }))).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { id: { description: 'the id', type: 'string' } },
            required: ['id'],
            type: 'object'
        });
    });

    it('emits each property when they share a schema node', () => {
        let value = schema.string();

        expect(toJsonSchema(schema.object({ a: value, b: value }))).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { a: { type: 'string' }, b: { type: 'string' } },
            required: ['a', 'b'],
            type: 'object'
        });
    });
});

describe('runtime schema builder: nullable behavior', () => {
    it('collapses a nullable primitive to a type array', () => {
        expect(toJsonSchema(schema.string({ nullable: true }))).toEqual({ $schema: DRAFT, type: ['string', 'null'] });
    });

    it('wraps a nested nullable primitive property in a type array', () => {
        expect(toJsonSchema(schema.object({ name: schema.string({ nullable: true }) }))).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { name: { type: ['string', 'null'] } },
            required: ['name'],
            type: 'object'
        });
    });

    it('wraps a nested nullable multi-key schema in anyOf with a null branch', () => {
        expect(toJsonSchema(schema.array(schema.string(), { nullable: true }))).toEqual({
            $schema: DRAFT,
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }]
        });
    });
});

describe('runtime schema builder: misuse throws loudly', () => {
    it('throws on an empty enum', () => {
        expect(() => schema.enum([])).toThrow('Runtime: schema.enum requires a non-empty array of string values');
    });

    it('throws on a non-string enum value', () => {
        expect(() => schema.enum([1 as unknown as string])).toThrow('Runtime: schema.enum values must all be strings');
    });

    it('throws on a non-primitive literal', () => {
        expect(() => schema.literal({} as unknown as string)).toThrow('Runtime: schema.literal requires a boolean, number, or string value');
    });

    it('throws on an empty union', () => {
        expect(() => schema.union([])).toThrow('Runtime: schema.union requires a non-empty array of branch schema nodes');
    });

    it('throws on a non-node array element', () => {
        expect(() => schema.array(null as unknown as ReturnType<typeof schema.string>)).toThrow('Runtime: schema.array requires an element schema node');
    });

    it('throws on a non-object properties argument', () => {
        expect(() => schema.object(null as unknown as Record<string, ReturnType<typeof schema.string>>)).toThrow('Runtime: schema.object requires a properties record');
    });
});
