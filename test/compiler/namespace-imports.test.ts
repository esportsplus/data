import { ts } from '@esportsplus/typescript';
import { describe, expect, it } from 'vitest';

import plugin from '../../src/compiler/index';
import { compile, transformRaw } from '../utils';


function visitValidatorBranch(node: ts.Node, state: { found: boolean }): void {
    if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
        let expr = node.expression;

        if (ts.isPropertyAccessExpression(expr)) {
            let methodName = expr.name.text;

            // ns.validator.build<T>() branch
            if (methodName === 'build' && ts.isPropertyAccessExpression(expr.expression)) {
                let inner = expr.expression;

                if (inner.name.text === 'validator' && ts.isIdentifier(inner.expression)) {
                    state.found = true;
                }
            }
        }
    }

    node.forEachChild((child) => visitValidatorBranch(child, state));
}


describe('Namespace Imports', () => {
    describe('pattern matching', () => {
        it('plugin has patterns for namespace-style access', () => {
            let patterns = plugin.patterns || [];

            expect(patterns).toContain('.build');
        });

        it('patterns match namespace validator call text', () => {
            let code = 'import * as data from "@esportsplus/data";\ndata.validator.build<{name: string}>();',
                matches = false,
                patterns = plugin.patterns || [];

            for (let i = 0, n = patterns.length; i < n; i++) {
                if (code.indexOf(patterns[i]) !== -1) {
                    matches = true;
                    break;
                }
            }

            expect(matches).toBe(true);
        });

    });

    describe('visit function detection branches', () => {
        it('ns.validator.build call matches nested PropertyAccessExpression', () => {
            // Verifies: data.validator.build<T>() has the correct AST shape
            // where expression is PAE with .name = 'build'
            // and .expression is PAE with .name = 'validator'
            // and inner .expression is Identifier
            let code = "import * as data from '@esportsplus/data';\ndata.validator.build<{name: string}>();",
                { sourceFile } = compile(code),
                state = { found: false };

            visitValidatorBranch(sourceFile, state);

            expect(state.found).toBe(true);
        });
    });

    describe('namespace-only import resolution', () => {
        it('namespace-only import IS transformed for validator', () => {
            // A namespace-qualified call carries its type argument, so it is compile-time
            // resolvable and must transform; the base identifier is matched against the
            // package's own namespace binding, resolved from the import declaration
            let code = transformRaw(
                "import * as data from '@esportsplus/data';\n" +
                'type User = { name: string };\n' +
                'data.validator.build<User>();\n'
            );

            expect(code).not.toContain('data.validator.build');
        });

        it('namespace import alongside named import transforms via the namespace binding, not text coincidence', () => {
            // Matching is keyed off the base identifier's own import binding, never off text
            // coincidence with another import's local name - `data` matches because it IS the
            // package's namespace binding, not because `validator` is separately imported
            let code = transformRaw(
                "import { validator } from '@esportsplus/data';\n" +
                "import * as data from '@esportsplus/data';\n" +
                'type User = { age: number; name: string };\n' +
                'data.validator.build<User>();\n'
            );

            expect(code).not.toContain('data.validator.build');
        });
    });

    describe('named import still works alongside namespace import', () => {
        it('named validator.build is still transformed', () => {
            let code = transformRaw(
                "import { validator } from '@esportsplus/data';\n" +
                "import * as data from '@esportsplus/data';\n" +
                'type User = { age: number; name: string };\n' +
                'validator.build<User>();\n'
            );

            expect(code).not.toContain('validator.build');
            expect(code).toContain('=>');
        });

    });
});
