import { describe, expect, it } from 'vitest';
import { ts } from '@esportsplus/typescript';
import { analyzeRootType, analyzeType } from '../../src/compiler/type-analyzer';
import { compile } from '../utils';


function findTypeArgument(node: ts.Node): ts.TypeNode | undefined {
    if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
        return node.typeArguments[0];
    }

    return node.forEachChild(findTypeArgument);
}

function getTypeNode(code: string): { checker: ts.Checker; typeNode: ts.TypeNode } {
    let { checker, sourceFile } = compile(`declare function test<T>(): T;\n${code}`),
        typeNode = findTypeArgument(sourceFile);

    if (!typeNode) {
        throw new Error('Type-analyzer-root test utils: no type argument found in source');
    }

    return { checker, typeNode };
}


describe('Type Analyzer: analyzeRootType', () => {
    it('matches analyzeType properties for an object root', () => {
        let { checker, typeNode } = getTypeNode(`
            type Data = { age: number; name: string };
            test<Data>();
        `);

        let root = analyzeRootType(typeNode, checker),
            legacy = analyzeType(typeNode, checker);

        expect(root.type).toBe('object');
        expect(root.properties).toEqual(legacy.properties);
    });

    it('returns array type with string itemType for a string[] root', () => {
        let { checker, typeNode } = getTypeNode('test<string[]>();');

        let root = analyzeRootType(typeNode, checker);

        expect(root.type).toBe('array');
        expect(root.itemType?.type).toBe('string');
    });

    it('returns literal type with both literals for a pure literal union root', () => {
        let { checker, typeNode } = getTypeNode("test<'a' | 'b'>();");

        let root = analyzeRootType(typeNode, checker);

        expect(root.type).toBe('literal');
        expect(root.literals).toEqual([
            { type: 'string', value: 'a' },
            { type: 'string', value: 'b' }
        ]);
    });

    it('returns record type with number indexType for a Record<string, number> root', () => {
        let { checker, typeNode } = getTypeNode('test<Record<string, number>>();');

        let root = analyzeRootType(typeNode, checker);

        expect(root.type).toBe('record');
        expect(root.indexType?.type).toBe('number');
    });

    it('returns the primitive type for a primitive root', () => {
        let { checker, typeNode } = getTypeNode('test<number>();');

        let root = analyzeRootType(typeNode, checker);

        expect(root.type).toBe('number');
    });

    it('marks a string | null root as nullable string', () => {
        let { checker, typeNode } = getTypeNode('test<string | null>();');

        let root = analyzeRootType(typeNode, checker);

        expect(root.type).toBe('string');
        expect(root.nullable).toBe(true);
    });

    it('returns tuple type for a tuple root', () => {
        let { checker, typeNode } = getTypeNode('test<[string, number]>();');

        let root = analyzeRootType(typeNode, checker);

        expect(root.type).toBe('tuple');
        expect(root.tupleTypes?.map((t) => t.type)).toEqual(['string', 'number']);
    });

    it('memoizes the result for the same TypeNode', () => {
        let { checker, typeNode } = getTypeNode('test<{ name: string }>();');

        let first = analyzeRootType(typeNode, checker),
            second = analyzeRootType(typeNode, checker);

        expect(second).toBe(first);
    });

    it('returns function kind for a bare arrow root', () => {
        let { checker, typeNode } = getTypeNode('test<() => void>();');

        expect(analyzeRootType(typeNode, checker).type).toBe('function');
    });

    it('returns function kind for a Function root', () => {
        let { checker, typeNode } = getTypeNode('test<Function>();');

        expect(analyzeRootType(typeNode, checker).type).toBe('function');
    });

    it('returns map kind with resolved key and value types', () => {
        let { checker, typeNode } = getTypeNode('test<Map<string, number>>();');

        let root = analyzeRootType(typeNode, checker);

        expect(root.type).toBe('map');
        expect(root.keyType?.type).toBe('string');
        expect(root.valueType?.type).toBe('number');
    });

    it('returns set kind with resolved value type', () => {
        let { checker, typeNode } = getTypeNode('test<Set<string>>();');

        let root = analyzeRootType(typeNode, checker);

        expect(root.type).toBe('set');
        expect(root.valueType?.type).toBe('string');
    });

    it('returns tuple kind with a fixed prefix and a rest type', () => {
        let { checker, typeNode } = getTypeNode('test<[number, ...string[]]>();');

        let root = analyzeRootType(typeNode, checker);

        expect(root.type).toBe('tuple');
        expect(root.tupleTypes?.map((t) => t.type)).toEqual(['number']);
        expect(root.restType?.type).toBe('string');
    });
});
