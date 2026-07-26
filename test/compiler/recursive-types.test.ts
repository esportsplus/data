import { describe, expect, it } from 'vitest';
import { ts } from '@esportsplus/typescript';
import type { JsonSchema } from '../../src/types';
import { analyzeRootType } from '../../src/compiler/type-analyzer';
import { generateJsonSchema } from '../../src/json-schema';
import { compile, createValidator } from '../utils';


const DRAFT = 'https://json-schema.org/draft/2020-12/schema';


// Recursive fixture aliases avoid DOM-global names (Node/Document/Range): a scratch file
// is a script, so those names collide with the global type instead of shadowing it.
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
        throw new Error('Recursive types test: no type argument found in source');
    }

    return analyzeRootType(typeNode, checker);
}

function schemaOf(code: string): JsonSchema {
    return JSON.parse(generateJsonSchema(getRoot(code)));
}


describe('Recursive validator: root self-reference round-trips (repro)', () => {
    let validate = createValidator(`
        type Chain = { value: number; next?: Chain };
        validator.build<Chain>();
    `);

    it('returns ok:true with data DEEP-EQUAL to the input (not {value:1,next:{}})', () => {
        let input = { next: { value: 2 }, value: 1 };
        let result = validate(input);

        expect(result.ok).toBe(true);
        expect(result.data).toEqual(input);
    });

    it('preserves every level of a three-deep nesting', () => {
        let input = { next: { next: { value: 3 }, value: 2 }, value: 1 };
        let result = validate(input);

        expect(result.ok).toBe(true);
        expect(result.data).toEqual(input);
    });

    it('rejects an invalid recursive leaf with the error path at next.value', () => {
        let result = validate({ next: { value: 'x' }, value: 1 });

        expect(result.ok).toBe(false);
        expect(result.errors?.some((e) => e.path === 'next.value')).toBe(true);
    });

    it('reports the error path deep in the chain (next.next.value)', () => {
        let result = validate({ next: { next: { value: 'x' }, value: 2 }, value: 1 });

        expect(result.ok).toBe(false);
        expect(result.errors?.some((e) => e.path === 'next.next.value')).toBe(true);
    });
});

describe('Recursive validator: mutual recursion through the root (# path)', () => {
    let validate = createValidator(`
        type Ping = { id: number; pong?: Pong };
        type Pong = { id: number; ping?: Ping };
        validator.build<Ping>();
    `);

    it('round-trips Ping -> Pong -> Ping in both directions', () => {
        let input = { id: 1, pong: { id: 2, ping: { id: 3, pong: { id: 4 } } } };
        let result = validate(input);

        expect(result.ok).toBe(true);
        expect(result.data).toEqual(input);
    });

    it('rejects an invalid leaf across the mutual back-edge (pong.ping.id)', () => {
        let result = validate({ id: 1, pong: { id: 2, ping: { id: 'x' } } });

        expect(result.ok).toBe(false);
        expect(result.errors?.some((e) => e.path === 'pong.ping.id')).toBe(true);
    });
});

describe('Recursive validator: non-root recursion through a $defs function', () => {
    let validate = createValidator(`
        type Wrap = { id: number; inner?: Cell };
        type Cell = { id: number; child?: Cell };
        validator.build<Wrap>();
    `);

    it('round-trips a Wrap wrapping a self-recursive Cell chain', () => {
        let input = { id: 1, inner: { child: { child: { id: 4 }, id: 3 }, id: 2 } };
        let result = validate(input);

        expect(result.ok).toBe(true);
        expect(result.data).toEqual(input);
    });

    it('rejects an invalid leaf inside the $defs chain (inner.child.id)', () => {
        let result = validate({ id: 1, inner: { child: { id: 'x' }, id: 2 } });

        expect(result.ok).toBe(false);
        expect(result.errors?.some((e) => e.path === 'inner.child.id')).toBe(true);
    });
});

describe('Recursive validator: cyclic INPUT terminates with a depth error', () => {
    let validate = createValidator(`
        type Cyc = { value: number; next?: Cyc };
        validator.build<Cyc>();
    `);

    it('does not hang and reports a named depth error', () => {
        let input: Record<string, unknown> = { value: 1 };

        input.next = input;

        let result = validate(input);

        expect(result.ok).toBe(false);
        expect(result.errors?.some((e) => /depth/i.test(e.message))).toBe(true);
    }, 2000);
});

describe('Recursive types: emitted JSON Schema is unchanged from baseline', () => {
    it('emits $ref "#" for a root self-recursive type', () => {
        expect(schemaOf('type Chain = { value: number; next?: Chain }; test<Chain>();')).toEqual({
            $schema: DRAFT,
            additionalProperties: false,
            properties: { next: { $ref: '#' }, value: { type: 'number' } },
            required: ['value'],
            type: 'object'
        });
    });

    it('emits a $defs entry with a self-ref for a non-root recursive type', () => {
        let schema = schemaOf('type Wrap = { id: number; inner?: Cell }; type Cell = { id: number; child?: Cell }; test<Wrap>();') as {
            $defs?: Record<string, { properties?: Record<string, { $ref?: string }> }>;
        };

        expect(schema.$defs?.Cell).toBeDefined();
        expect(schema.$defs?.Cell.properties?.child).toEqual({ $ref: '#/$defs/Cell' });
    });
});
