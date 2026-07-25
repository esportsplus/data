import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_NAME } from '../constants';


type ResidueFinding = {
    column: number;
    file: string;
    kind: 'call' | 'import';
    line: number;
    text: string;
};

type Position = {
    column: number;
    line: number;
};


// Root exports that only ever resolve at compile time - the runtime stub for each throws when reached,
// so their presence in emitted output is the signature of a plugin that never ran.
const COMPILE_TIME_SYMBOLS = new Set(['codec', 'validator']);

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

const IMPORT_REGEX = /import\s+(?:\*\s+as\s+(\w+)|(\{[^}]*\}))\s+from\s+(['"])([^'"]+)\3/g;


function escapeRegExp(value: string): string {
    return value.replace(ESCAPE_REGEX, '\\$&');
}

function positionOf(text: string, index: number): Position {
    let column = 1,
        line = 1;

    for (let i = 0; i < index; i++) {
        if (text.charCodeAt(i) === 10) {
            column = 1;
            line++;
        }
        else {
            column++;
        }
    }

    return { column, line };
}

function scanCalls(file: string, text: string, regex: RegExp, findings: ResidueFinding[]): void {
    let match: RegExpExecArray | null;

    regex.lastIndex = 0;

    while ((match = regex.exec(text)) !== null) {
        let position = positionOf(text, match.index);

        findings.push({
            column: position.column,
            file,
            kind: 'call',
            line: position.line,
            text: match[0]
        });
    }
}

function scanFile(file: string, text: string, findings: ResidueFinding[]): void {
    let match: RegExpExecArray | null,
        namespaces: string[] = [],
        validatorLocals: string[] = [];

    IMPORT_REGEX.lastIndex = 0;

    while ((match = IMPORT_REGEX.exec(text)) !== null) {
        if (match[4] !== PACKAGE_NAME) {
            continue;
        }

        if (match[1] !== undefined) {
            namespaces.push(match[1]);
            continue;
        }

        let bound = false,
            parts = match[2].slice(1, -1).split(',');

        for (let i = 0, n = parts.length; i < n; i++) {
            let part = parts[i].trim();

            if (part.length === 0) {
                continue;
            }

            let segments = part.split(/\s+as\s+/),
                imported = segments[0].trim(),
                local = (segments[1] ?? segments[0]).trim();

            if (COMPILE_TIME_SYMBOLS.has(imported)) {
                bound = true;

                if (imported === 'validator') {
                    validatorLocals.push(local);
                }
            }
        }

        if (bound) {
            let position = positionOf(text, match.index);

            findings.push({
                column: position.column,
                file,
                kind: 'import',
                line: position.line,
                text: match[0].trim()
            });
        }
    }

    for (let i = 0, n = validatorLocals.length; i < n; i++) {
        scanCalls(file, text, new RegExp(`(?<![\\w$])${escapeRegExp(validatorLocals[i])}\\.(build|set|toJsonSchema)\\s*\\(`, 'g'), findings);
    }

    for (let i = 0, n = namespaces.length; i < n; i++) {
        scanCalls(file, text, new RegExp(`(?<![\\w$])${escapeRegExp(namespaces[i])}\\.validator\\.(build|set|toJsonSchema)\\s*\\(`, 'g'), findings);
    }
}

function walk(dir: string, files: string[]): void {
    let entries = readdirSync(dir, { withFileTypes: true });

    for (let i = 0, n = entries.length; i < n; i++) {
        let entry = entries[i],
            full = join(dir, entry.name);

        if (entry.isDirectory()) {
            walk(full, files);
        }
        else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(full);
        }
    }
}


// Walks emitted `.js` under `dir` and reports (a) surviving validator.<method>( call sites reached via
// a `@esportsplus/data` root import and (b) root imports binding a compile-time-only symbol. A findings
// array is returned (never process.exit) so callers choose how to react; assertNoResidue is the throwing
// wrapper consumers wire into `build`/`prepublishOnly`.
const scanBuildOutput = (dir: string): ResidueFinding[] => {
    let files: string[] = [];

    walk(dir, files);
    files.sort();

    let findings: ResidueFinding[] = [];

    for (let i = 0, n = files.length; i < n; i++) {
        scanFile(files[i], readFileSync(files[i], 'utf8'), findings);
    }

    return findings;
};

const assertNoResidue = (dir: string): void => {
    let findings = scanBuildOutput(dir);

    if (findings.length === 0) {
        return;
    }

    let lines = findings.map(finding => `  ${finding.kind} ${finding.file}:${finding.line}:${finding.column} — ${finding.text}`);

    throw new Error(
        `${PACKAGE_NAME}: build output residue detected — ${findings.length} finding(s):\n${lines.join('\n')}`
    );
};


export { assertNoResidue, scanBuildOutput };
export type { ResidueFinding };
