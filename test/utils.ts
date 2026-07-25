import { coordinator } from '@esportsplus/typescript/compiler';
import { ts } from '@esportsplus/typescript';
import plugin from '../src/compiler/index';


const PACKAGE_IMPORT = "import { codec, validator } from '@esportsplus/data';\n";

let compilerOptions: ts.CompilerOptions = {
    lib: ['lib.es2020.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    target: ts.ScriptTarget.ES2020
};


function createProgram(code: string, filename: string = 'test.ts'): ts.Program {
    let host = ts.createCompilerHost(compilerOptions),
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

    return ts.createProgram([filename], compilerOptions, host);
}

function mightNeedTransform(code: string): boolean {
    let patterns = plugin.patterns || [];

    for (let i = 0, n = patterns.length; i < n; i++) {
        if (code.indexOf(patterns[i]) !== -1) {
            return true;
        }
    }

    return false;
}

function transformCode(code: string): string {
    let fullCode = PACKAGE_IMPORT + code,
        program = createProgram(fullCode),
        shared = new Map(),
        sourceFile = program.getSourceFile('test.ts')!;

    let result = coordinator.transform([plugin], fullCode, sourceFile, program, shared);

    return result.code;
}

// build<T>() now compiles to a hoisted plain object `{ toJsonSchema, validate }`, so unwrap
// the `.validate` member here — every pre-existing suite keeps its `v(input)` call shape. The
// hoisted validator body references sibling module-level consts (schema, config factories,
// default factories), so execute the emitted PRELUDE (imports dropped) up to and including the
// build POJO literal, then return that object's `validate`; user type declarations and the
// replaced call statement follow the POJO and are never evaluated.
function createValidator<T>(code: string): (input: unknown) => { ok: boolean; data: unknown; errors?: Array<{ message: string; path: string }> } {
    let transformed = transformCode(code),
        match = transformed.match(/const\s+(\w+)\s*=\s*\{\s*toJsonSchema:/);

    if (!match || match.index === undefined) {
        throw new Error('Utils: could not locate build POJO in transformed code:\n' + transformed);
    }

    let depth = 0,
        end = 0,
        inString = false,
        name = match[1],
        open = transformed.indexOf('{', match.index),
        stringChar = '';

    for (let i = open, n = transformed.length; i < n; i++) {
        let char = transformed[i];

        if (inString) {
            if (char === stringChar && transformed[i - 1] !== '\\') {
                inString = false;
            }
        }
        else if (char === '"' || char === "'" || char === '`') {
            inString = true;
            stringChar = char;
        }
        else if (char === '{') {
            depth++;
        }
        else if (char === '}') {
            depth--;

            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }

    let prelude = transformed.slice(0, end).replace(/^\s*import\b.*$/gm, '');

    // eslint-disable-next-line no-new-func
    return new Function(`${prelude}\nreturn ${name}.validate;`)();
}

export { createProgram, createValidator, mightNeedTransform, transformCode };
