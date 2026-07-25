import { fileURLToPath } from 'node:url';
import { ts } from '@esportsplus/typescript';
import { coordinator } from '@esportsplus/typescript/compiler';
import { describe, expect, it } from 'vitest';

import plugin, { findUntransformed } from '../../src/compiler/index';
import { assertNoResidue, scanBuildOutput } from '../../src/compiler/residue';


let compilerOptions: ts.CompilerOptions = {
    lib: ['lib.es2020.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    target: ts.ScriptTarget.ES2020
};

let fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));


function buildHost(code: string): ts.CompilerHost {
    let filename = 'test.ts',
        host = ts.createCompilerHost(compilerOptions),
        originalGetSourceFile = host.getSourceFile.bind(host);

    host.getSourceFile = (name, languageVersion) => {
        if (name === filename) {
            return ts.createSourceFile(name, code, languageVersion, true);
        }

        return originalGetSourceFile(name, languageVersion);
    };

    host.fileExists = (name) => name === filename || ts.sys.fileExists(name);
    host.readFile = (name) => name === filename ? code : ts.sys.readFile(name);

    return host;
}

function compile(code: string): { checker: ts.TypeChecker; sourceFile: ts.SourceFile } {
    let program = ts.createProgram(['test.ts'], compilerOptions, buildHost(code));

    return { checker: program.getTypeChecker(), sourceFile: program.getSourceFile('test.ts')! };
}

function transformRaw(code: string): string {
    let program = ts.createProgram(['test.ts'], compilerOptions, buildHost(code)),
        shared = new Map(),
        sourceFile = program.getSourceFile('test.ts')!;

    return coordinator.transform([plugin], code, sourceFile, program, process.cwd(), shared).code;
}


describe('Plugin self-assertion', () => {
    it('passes silently when the detected call is consumed', () => {
        let code = transformRaw(
            "import { validator } from '@esportsplus/data';\n" +
            'type User = { name: string };\n' +
            'const validate = validator.build<User>();\n'
        );

        expect(code).not.toContain('validator.build');
        expect(code).toContain('=>');
    });

    it('throws a named build-time error on a surviving aliased build call', () => {
        let run = () => transformRaw(
            "import { validator as v } from '@esportsplus/data';\n" +
            'const built = v.build();\n'
        );

        expect(run).toThrow(/untransformed build call at test\.ts:2:/);
        expect(run).toThrow(/@esportsplus\/data:/);
    });

    it('drives the scanner directly and reports file:line:col of the survivor', () => {
        let { checker, sourceFile } = compile(
            "import { validator as v } from '@esportsplus/data';\n" +
            'const built = v.build();\n'
        );

        let survivors = findUntransformed(sourceFile, checker, 'v', undefined, new Set());

        expect(survivors).toHaveLength(1);
        expect(survivors[0].method).toBe('build');
        expect(survivors[0].line).toBe(2);
        expect(survivors[0].column).toBeGreaterThan(0);
    });

    it('reports no survivors when every consumable site was consumed', () => {
        let code =
                "import { validator } from '@esportsplus/data';\n" +
                'type User = { name: string };\n' +
                'const validate = validator.build<User>();\n',
            { checker, sourceFile } = compile(code),
            consumed = new Set<ts.Node>();

        visitCalls(sourceFile, (node) => {
            if (ts.isCallExpression(node) && node.typeArguments && node.typeArguments.length > 0) {
                consumed.add(node);
            }
        });

        expect(findUntransformed(sourceFile, checker, 'validator', undefined, consumed)).toHaveLength(0);
    });
});

describe('Post-build residue scan', () => {
    it('classifies the dirty fixture: surviving-call and stub-import classes', () => {
        let findings = scanBuildOutput(fixturesDir).filter(f => f.file.includes('residue-dirty'));

        expect(findings.some(f => f.kind === 'call')).toBe(true);
        expect(findings.some(f => f.kind === 'import')).toBe(true);
    });

    it('returns empty for the clean fixture', () => {
        let findings = scanBuildOutput(fixturesDir).filter(f => f.file.includes('residue-clean'));

        expect(findings).toHaveLength(0);
    });

    it('assertNoResidue throws listing every finding', () => {
        let all = scanBuildOutput(fixturesDir);

        expect(() => assertNoResidue(fixturesDir)).toThrow(/build output residue detected/);
        expect(() => assertNoResidue(fixturesDir)).toThrow(new RegExp(`${all.length} finding`));
    });
});


function visitCalls(node: ts.Node, callback: (node: ts.Node) => void): void {
    callback(node);

    ts.forEachChild(node, (child) => visitCalls(child, callback));
}
