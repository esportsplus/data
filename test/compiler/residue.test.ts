import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { assertNoResidue, scanBuildOutput } from '../../src/compiler/residue';


let fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));

let residueSourcePath = fileURLToPath(new URL('../../src/compiler/residue.ts', import.meta.url));


function withDir(files: Record<string, string>, run: (dir: string) => void): void {
    let dir = mkdtempSync(join(tmpdir(), 'residue-test-'));

    try {
        for (let name of Object.keys(files)) {
            writeFileSync(join(dir, name), files[name]);
        }

        run(dir);
    }
    finally {
        rmSync(dir, { force: true, recursive: true });
    }
}


describe('codec import from the package root', () => {
    it('produces zero findings and assertNoResidue does not throw', () => {
        let codecFixture = readFileSync(join(fixturesDir, 'residue-codec-root.js'), 'utf8');

        withDir({ 'codec-root.js': codecFixture }, (dir) => {
            expect(scanBuildOutput(dir)).toHaveLength(0);
            expect(() => assertNoResidue(dir)).not.toThrow();
        });
    });
});

describe('validator import from the package root', () => {
    it('still produces an import finding and assertNoResidue still throws', () => {
        withDir(
            { 'validator-root.js': "import { validator } from '@esportsplus/data';\nconst noop = 1;\n" },
            (dir) => {
                let findings = scanBuildOutput(dir);

                expect(findings).toHaveLength(1);
                expect(findings[0].kind).toBe('import');
                expect(findings[0].text).toContain('validator');

                expect(() => assertNoResidue(dir)).toThrow(/build output residue detected/);
            }
        );
    });
});

describe('codec and validator imported together', () => {
    it('reports the validator import and nothing attributable to codec', () => {
        withDir(
            {
                'both.js': "import { codec, validator } from '@esportsplus/data';\nconst c = codec({});\n"
            },
            (dir) => {
                let findings = scanBuildOutput(dir);

                expect(findings).toHaveLength(1);
                expect(findings[0].kind).toBe('import');
                expect(findings[0].text).toContain('validator');
            }
        );
    });
});

describe('call-site scanning is unaffected', () => {
    it('detects a direct validator.build(...) call site', () => {
        withDir(
            {
                'direct-call.js': "import { validator } from '@esportsplus/data';\nconst v = validator.build();\n"
            },
            (dir) => {
                let findings = scanBuildOutput(dir),
                    callFindings = findings.filter(f => f.kind === 'call');

                expect(callFindings).toHaveLength(1);
                expect(callFindings[0].text).toContain('validator.build(');
            }
        );
    });

    it('detects a namespace-form ns.validator.build(...) call site', () => {
        withDir(
            {
                'namespace-call.js': "import * as ns from '@esportsplus/data';\nconst v = ns.validator.build();\n"
            },
            (dir) => {
                let findings = scanBuildOutput(dir),
                    callFindings = findings.filter(f => f.kind === 'call');

                expect(callFindings).toHaveLength(1);
                expect(callFindings[0].text).toContain('ns.validator.build(');
            }
        );
    });
});

describe('COMPILE_TIME_SYMBOLS', () => {
    it('contains exactly validator', () => {
        let source = readFileSync(residueSourcePath, 'utf8'),
            match = source.match(/COMPILE_TIME_SYMBOLS\s*=\s*new Set\(\[([^\]]*)\]\)/);

        expect(match).not.toBeNull();

        let symbols = (match as RegExpMatchArray)[1]
            .split(',')
            .map(entry => entry.trim().replace(/^['"]|['"]$/g, ''))
            .filter(entry => entry.length > 0);

        expect(symbols).toEqual(['validator']);
    });
});
