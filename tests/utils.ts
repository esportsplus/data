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

function createValidator<T>(code: string): (input: unknown) => { ok: boolean; data: unknown; errors?: Array<{ message: string; path: string }> } {
    let transformed = transformCode(code);

    // Extract the validator function from the transformed code
    let match = transformed.match(/validator\.build<[^>]+>\([^)]*\)/);

    if (!match) {
        // Find the IIFE that replaced the call
        let iifeMatch = transformed.match(/(\([^)]*\)\s*=>\s*\{[\s\S]*?\})\s*$/);

        if (iifeMatch) {
            // eslint-disable-next-line no-new-func
            return new Function('return ' + iifeMatch[1])();
        }
    }

    // Find and extract the generated function
    let funcStart = transformed.indexOf('(_input) =>');

    if (funcStart === -1) {
        funcStart = transformed.indexOf('async (_input) =>');
    }

    if (funcStart !== -1) {
        let depth = 0,
            end = funcStart,
            inString = false,
            stringChar = '';

        for (let i = funcStart; i < transformed.length; i++) {
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

        let funcCode = transformed.substring(funcStart, end);

        // eslint-disable-next-line no-new-func
        return new Function('return ' + funcCode)();
    }

    throw new Error('Could not extract validator function from transformed code:\n' + transformed);
}

function createCodec<T>(code: string): { encode: (data: T) => Uint8Array; decode: (buffer: Uint8Array) => T } {
    let transformed = transformCode(code);

    // Find the IIFE that contains the codec
    let iifeStart = transformed.indexOf('(() => {');

    if (iifeStart !== -1) {
        let depth = 0,
            end = iifeStart,
            inString = false,
            stringChar = '';

        for (let i = iifeStart; i < transformed.length; i++) {
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
                    // Look for the closing ()
                    let remaining = transformed.substring(i + 1);
                    let closeMatch = remaining.match(/^\s*\)\s*\(\s*\)/);

                    if (closeMatch) {
                        end = i + 1 + closeMatch[0].length;
                    }
                    else {
                        end = i + 1;
                    }

                    break;
                }
            }
        }

        let codecCode = transformed.substring(iifeStart, end);

        // eslint-disable-next-line no-new-func
        return new Function('return ' + codecCode)();
    }

    throw new Error('Could not extract codec from transformed code:\n' + transformed);
}


export { createCodec, createProgram, createValidator, mightNeedTransform, transformCode };
