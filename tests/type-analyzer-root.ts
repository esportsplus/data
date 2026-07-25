import { describe, expect, it } from 'vitest';
import { ts } from '@esportsplus/typescript';
import { analyzeRootType, analyzeType } from '../src/compiler/type-analyzer';
import { createProgram } from './utils';


function findTypeArgument(node: ts.Node): ts.TypeNode | undefined {
    if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
        return node.typeArguments[0];
    }

    return ts.forEachChild(node, findTypeArgument);
}

function getTypeNode(code: string): { checker: ts.TypeChecker; typeNode: ts.TypeNode } {
    let program = createProgram(`declare function test<T>(): T;\n${code}`),
        sourceFile = program.getSourceFile('test.ts')!,
        checker = program.getTypeChecker(),
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
});
