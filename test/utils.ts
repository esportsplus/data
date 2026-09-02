import type { Plugin, ScratchResult } from '@esportsplus/typescript/compiler';
import { coordinator, languageService } from '@esportsplus/typescript/compiler';
import plugin from '../src/compiler/index';


const EXPORT_PREFIX = /^\s*export\s+/;

const IMPORT_LINE = /^\s*import\b/;

const PACKAGE_IMPORT = "import { codec, validator } from '@esportsplus/data';\n";

const ROOT = process.cwd().replace(/\\/g, '/');

const FILE_NAME = ROOT + '/src/__compiler-fixture.ts';

const TYPE_LINE = /^\s*(export\s+)?type\b/;


// Fixtures must be modules so local type aliases such as Node do not merge with DOM globals.
function compile(code: string, fileName: string = FILE_NAME): ScratchResult {
    return languageService.scratch(fileName, code + '\nexport {};');
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
    return transformRaw(PACKAGE_IMPORT + code);
}

// Same pipeline as transformCode without the package-import prefix, for cases that supply their
// own imports (or deliberately omit them).
function transformRaw(code: string): string {
    return transformWith([plugin], code);
}

function transformWith(plugins: Plugin[], code: string): string {
    let { checker, program, sourceFile } = compile(code),
        shared = new Map();

    return coordinator.transform(plugins, code, sourceFile, { checker, program }, ROOT, shared).code;
}

// build<T>() now compiles to a hoisted plain object `{ toJsonSchema, validate }`, so unwrap
// the `.validate` member here — every pre-existing suite keeps its `v(input)` call shape. The
// hoisted validator body references sibling module-level consts (schema, config factories,
// default factories), so execute the emitted PRELUDE (imports dropped) up to and including the
// build POJO literal, then return that object's `validate`; user type declarations and the
// replaced call statement follow the POJO and are never evaluated.
function createValidator(code: string): (input: unknown) => { ok: boolean; data: Record<string, unknown>; errors?: Array<{ message: string; path: string }> } {
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

// Executes the WHOLE emitted module rather than extracting one binding, so a case can assert
// the behavior of every construct the pipeline emits (hoisted consts, config factories,
// stripped `validator.set` registrations, a build POJO and a toJsonSchema const side by side).
// `injected` supplies the runtime values the emitted module imports; `expression` names what
// to hand back.
function evaluateModule(code: string, injected: Record<string, unknown> = {}, expression: string = 'validate'): unknown {
    let body = transformCode(code)
            .split(String.fromCharCode(10))
            .filter((line) => !IMPORT_LINE.test(line) && !TYPE_LINE.test(line))
            .map((line) => line.replace(EXPORT_PREFIX, ''))
            .join(String.fromCharCode(10)),
        keys = Object.keys(injected);

    // eslint-disable-next-line no-new-func
    return new Function(...keys, body + String.fromCharCode(10) + 'return ' + expression + ';')(...keys.map((key) => injected[key]));
}


export { compile, createValidator, evaluateModule, mightNeedTransform, transformCode, transformRaw, transformWith };
