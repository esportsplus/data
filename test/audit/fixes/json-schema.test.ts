/**
 * Proof-of-fix for audit findings M5a-c.
 *
 * These assert the CORRECTED behavior (the opposite of test/audit/validators-jsonschema.test.ts,
 * which is kept red on purpose and reconciled centrally).
 *
 *   M5a — a property literally named `__proto__` survives as an own key in `properties`.
 *   M5b — a tuple with a rest element emits the rest element as `items` (not `items: false`).
 *   M5c — nested runtime `default`/`description` annotations reach the emitted schema.
 */
import { ts } from '@esportsplus/typescript';
import { describe, expect, it } from 'vitest';

import { analyzeRootType } from '../../../src/compiler/type-analyzer';
import { generateJsonSchema } from '../../../src/json-schema';
import { schema, toJsonSchema } from '../../../src/runtime/index';
import type { JsonSchema } from '../../../src/types';
import { compile } from '../../utils';


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
        throw new Error('Proof-of-fix: no type argument found in source');
    }

    return analyzeRootType(typeNode, checker);
}

function schemaOf(code: string): JsonSchema {
    return JSON.parse(generateJsonSchema(getRoot(code)));
}


describe('M5a — __proto__ property is preserved in generated schema', () => {
    it('emits __proto__ as a real own key in properties', () => {
        let generated = schemaOf('type T = { __proto__: string; a: number }; test<T>();');

        expect(Object.prototype.hasOwnProperty.call(generated.properties, '__proto__')).toBe(true);
        expect(generated.properties!['__proto__']).toEqual({ type: 'string' });
        expect(generated.required).toEqual(['__proto__', 'a']);
    });

    it('serializes the literal "__proto__" key into the emitted JSON text', () => {
        expect(generateJsonSchema(getRoot('type T = { __proto__: string }; test<T>();'))).toContain('"__proto__"');
    });

    it('keeps the sibling properties and their schemas intact', () => {
        let generated = schemaOf('type T = { __proto__: string; a: number }; test<T>();');

        expect(generated.properties).toEqual(
            expect.objectContaining({ a: { type: 'number' } })
        );
        expect(generated.additionalProperties).toBe(false);
    });
});


describe('M5b — tuple with a rest element carries the tail schema', () => {
    it('emits items as the rest element schema with a prefixItems head', () => {
        let generated = schemaOf('test<[string, ...number[]]>();');

        expect(generated.items).toEqual({ type: 'number' });
        expect(generated.prefixItems).toEqual([{ type: 'string' }]);
        expect(generated.minItems).toBe(1);
    });

    it('retains the rest type in the serialized schema', () => {
        expect(JSON.stringify(schemaOf('test<[string, ...number[]]>();'))).toContain('"number"');
    });

    it('handles a longer fixed head and an optional fixed element before the rest', () => {
        let generated = schemaOf('test<[string, number?, ...boolean[]]>();');

        expect(generated.prefixItems).toEqual([{ type: 'string' }, { type: 'number' }]);
        expect(generated.items).toEqual({ type: 'boolean' });
        expect(generated.minItems).toBe(1);
    });

    it('still closes a tuple that has no rest element (items: false)', () => {
        let generated = schemaOf('test<[string, number?]>();');

        expect(generated.items).toBe(false);
        expect(generated.prefixItems).toEqual([{ type: 'string' }, { type: 'number' }]);
    });
});


describe('M5c — nested runtime annotations are emitted', () => {
    it('emits a nested object property default and description', () => {
        let generated = toJsonSchema(
                schema.object({
                    nested: schema.object({
                        id: schema.string({ default: 'abc', description: 'the id' })
                    })
                })
            ) as any;

        expect(generated.properties.nested.properties.id).toEqual({
            default: 'abc',
            description: 'the id',
            type: 'string'
        });
    });

    it('emits annotations on array items and record values', () => {
        let generated = toJsonSchema(
                schema.object({
                    meta: schema.record(schema.string({ default: 'x' })),
                    tags: schema.array(schema.string({ description: 'a tag' }))
                })
            ) as any;

        expect(generated.properties.tags.items).toEqual({ description: 'a tag', type: 'string' });
        expect(generated.properties.meta.additionalProperties).toEqual({ default: 'x', type: 'string' });
    });

    it('reaches arbitrarily deep object nesting', () => {
        let generated = toJsonSchema(
                schema.object({
                    a: schema.object({
                        b: schema.object({
                            c: schema.string({ default: 'deep' })
                        })
                    })
                })
            ) as any;

        expect(generated.properties.a.properties.b.properties.c).toEqual({
            default: 'deep',
            type: 'string'
        });
    });

    it('still carries the root-level property annotation (no regression)', () => {
        let generated = toJsonSchema(
                schema.object({ id: schema.string({ default: 'abc', description: 'the id' }) })
            ) as any;

        expect(generated.properties.id).toEqual({ default: 'abc', description: 'the id', type: 'string' });
    });

    it('leaves an unannotated nested object property structurally intact', () => {
        let generated = toJsonSchema(
                schema.object({
                    nested: schema.object({ id: schema.string() })
                })
            ) as any;

        expect(generated.properties.nested).toEqual({
            additionalProperties: false,
            properties: { id: { type: 'string' } },
            required: ['id'],
            type: 'object'
        });
        expect(generated.$schema).toBe(DRAFT);
    });
});
