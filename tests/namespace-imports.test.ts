import { ts } from '@esportsplus/typescript';
import { coordinator } from '@esportsplus/typescript/compiler';
import { describe, expect, it } from 'vitest';

import plugin from '../src/compiler/index';


let compilerOptions: ts.CompilerOptions = {
    lib: ['lib.es2020.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    target: ts.ScriptTarget.ES2020
};


function transformRaw(code: string): string {
    let filename = 'test.ts',
        host = ts.createCompilerHost(compilerOptions),
        originalGetSourceFile = host.getSourceFile.bind(host);

    host.getSourceFile = (name, languageVersion) => {
        if (name === filename) {
            return ts.createSourceFile(name, code, languageVersion, true);
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
            return code;
        }

        return ts.sys.readFile(name);
    };

    let program = ts.createProgram([filename], compilerOptions, host),
        shared = new Map(),
        sourceFile = program.getSourceFile(filename)!;

    return coordinator.transform([plugin], code, sourceFile, program, shared).code;
}


function visitCodecBranch(node: ts.Node, state: { found: boolean }): void {
    if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
        let expr = node.expression;

        if (ts.isPropertyAccessExpression(expr)) {
            let methodName = expr.name.text;

            // ns.codec<T>() branch
            if (methodName === 'codec' && ts.isIdentifier(expr.expression)) {
                state.found = true;
            }
        }
    }

    ts.forEachChild(node, (child) => visitCodecBranch(child, state));
}

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

    ts.forEachChild(node, (child) => visitValidatorBranch(child, state));
}


describe('Namespace Imports', () => {
    describe('pattern matching', () => {
        it('plugin has patterns for namespace-style access', () => {
            let patterns = plugin.patterns || [];

            expect(patterns).toContain('.codec');
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

        it('patterns match namespace codec call text', () => {
            let code = 'import * as data from "@esportsplus/data";\ndata.codec<{name: string}>();',
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

    describe('visit function detection branches (index.ts:118-134)', () => {
        it('ns.codec call matches PropertyAccessExpression with identifier', () => {
            // Verifies the AST shape: data.codec<T>() is a CallExpression
            // where expression is PropertyAccessExpression with .name = 'codec'
            // and .expression is Identifier
            let code = "import * as data from '@esportsplus/data';\ndata.codec<{id: number}>();",
                sourceFile = ts.createSourceFile('test.ts', code, ts.ScriptTarget.ES2020, true),
                state = { found: false };

            visitCodecBranch(sourceFile, state);

            expect(state.found).toBe(true);
        });

        it('ns.validator.build call matches nested PropertyAccessExpression', () => {
            // Verifies: data.validator.build<T>() has the correct AST shape
            // where expression is PAE with .name = 'build'
            // and .expression is PAE with .name = 'validator'
            // and inner .expression is Identifier
            let code = "import * as data from '@esportsplus/data';\ndata.validator.build<{name: string}>();",
                sourceFile = ts.createSourceFile('test.ts', code, ts.ScriptTarget.ES2020, true),
                state = { found: false };

            visitValidatorBranch(sourceFile, state);

            expect(state.found).toBe(true);
        });
    });

    describe('namespace-only import resolution', () => {
        it('namespace-only import is not transformed for validator', () => {
            // imports.includes requires named imports to populate its cache;
            // namespace-only imports produce empty specifier sets
            let code = transformRaw(
                "import * as data from '@esportsplus/data';\n" +
                'type User = { name: string };\n' +
                'data.validator.build<User>();\n'
            );

            expect(code).toContain('data.validator.build');
        });

        it('namespace-only import is not transformed for codec', () => {
            let code = transformRaw(
                "import * as data from '@esportsplus/data';\n" +
                'type Item = { id: number };\n' +
                'data.codec<Item>();\n'
            );

            expect(code).toContain('data.codec');
        });

        it('namespace import alongside named import does not transform namespace access', () => {
            // Even with both import styles, the namespace-qualified access
            // is not resolved by imports.includes
            let code = transformRaw(
                "import { validator } from '@esportsplus/data';\n" +
                "import * as data from '@esportsplus/data';\n" +
                'type User = { age: number; name: string };\n' +
                'data.validator.build<User>();\n'
            );

            expect(code).toContain('data.validator.build');
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

        it('named codec is still transformed', () => {
            let code = transformRaw(
                "import { codec } from '@esportsplus/data';\n" +
                "import * as data from '@esportsplus/data';\n" +
                'type Msg = { text: string };\n' +
                'codec<Msg>();\n'
            );

            expect(code).not.toContain('codec<Msg>');
        });
    });
});
