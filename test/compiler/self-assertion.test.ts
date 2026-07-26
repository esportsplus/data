import { fileURLToPath } from 'node:url';
import { ts } from '@esportsplus/typescript';
import { describe, expect, it } from 'vitest';

import { findUntransformed } from '../../src/compiler/index';
import { assertNoResidue, scanBuildOutput } from '../../src/compiler/residue';
import { compile, transformRaw } from '../utils';


let fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));


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

        // Asserts the file:line:col contract, not the harness's fixture file name.
        expect(run).toThrow(/untransformed build call at .+\.ts:2:\d+/);
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

    node.forEachChild((child) => visitCalls(child, callback));
}
