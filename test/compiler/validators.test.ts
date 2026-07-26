import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { transformCode } from '../utils';


type Validate = (input: unknown) => ValidationResult | Promise<ValidationResult>;

type ValidationResult = { data: unknown; errors?: Array<{ message: string; path: string }>; ok: boolean };


const PREFIX = `
    type Brand<T, B extends string> = T & { __brand: B };
    type Slug = Brand<string, 'slug'>;
    type ErrorType = { push(message: string): void };
    type Post = { slug: Slug };
`;

const SOURCE_PATH = fileURLToPath(new URL('../../src/compiler/validators.ts', import.meta.url));


// Evaluate the FULL transformed module (imports/types stripped) and hand back the build POJO's
// validate closure - a brand body inlined into the closure can reference outer-scope symbols the
// prelude-only slice drops. Mirrors the harness in branded-strings.test.ts.
function build(body: string): Validate {
    let code = transformCode(`${PREFIX}
            validator.set((value: Slug, errors: ErrorType) => { ${body} });
            validator.build<Post>();
        `),
        match = code.match(/const\s+(\w+)\s*=\s*\{\s*toJsonSchema:/);

    if (!match) {
        throw new Error('test: build POJO not found in transformed code:\n' + code);
    }

    let module = code
        .replace(/^\s*import\b.*$/gm, '')
        .replace(/^\s*type\b.*$/gm, '');

    return new Function(`${module}\nreturn ${match[1]}.validate;`)() as Validate;
}

function emit(body: string): string {
    return transformCode(`${PREFIX}
            validator.set((value: Slug, errors: ErrorType) => { ${body} });
            validator.build<Post>();
        `);
}


describe('validator body AST rewrite (F: error pushes rewritten through the AST, not a regex)', () => {
    it('preserves an escaped apostrophe in a static message', () => {
        let validate = build(`if (value.length < 3) { errors.push('it\\'s bad'); }`) as (input: unknown) => ValidationResult,
            bad = validate({ slug: 'ab' });

        expect(bad.ok).toBe(false);
        expect(bad.errors![0]!.message).toBe("it's bad");
        expect(bad.errors![0]!.path).toBe('slug');
    });

    it('reports the interpolated runtime value from a template-literal message', () => {
        let validate = build(`if (value.length < 3) { errors.push(\`bad: \${value.length}\`); }`) as (input: unknown) => ValidationResult,
            bad = validate({ slug: 'ab' });

        expect(bad.ok).toBe(false);
        expect(bad.errors![0]!.message).toBe('bad: 2');
    });

    it('reports a non-literal argument value instead of throwing ReferenceError', () => {
        let validate = build(`let msg = 'x'; if (value.length < 3) { errors.push(msg); }`) as (input: unknown) => ValidationResult,
            bad = validate({ slug: 'ab' });

        expect(bad.ok).toBe(false);
        expect(bad.errors![0]!.message).toBe('x');
    });

    it('does not rewrite errors.push text living inside a string literal (AST vs text)', () => {
        let body = `let note = "errors.push('ghost')"; if (value.length < 3) { errors.push('real'); }`,
            code = emit(body);

        // The ghost is data inside another string, not a call - a textual rewrite would consume it.
        expect(code).toContain("errors.push('ghost')");

        let validate = build(body) as (input: unknown) => ValidationResult,
            bad = validate({ slug: 'ab' });

        expect(bad.ok).toBe(false);
        expect(bad.errors![0]!.message).toBe('real');
    });

    it('emits the static push against the generated binding, not a raw errors.push', () => {
        let code = emit(`if (value.length < 3) { errors.push('slug too short'); }`);

        expect(code).not.toContain('errors.push');
        expect(code).toContain('slug too short');
        expect(code).toContain('_errors');
    });

    it('compiles a body containing eval(...) rather than throwing on a disallowed pattern', () => {
        expect(() => emit(`let x = eval('1'); if (value.length < x) { errors.push('short'); }`)).not.toThrow();
    });

    it('has removed DISALLOWED_BODY_REGEX from the module source', () => {
        let source = readFileSync(SOURCE_PATH, 'utf8');

        expect(source).not.toContain('DISALLOWED_BODY_REGEX');
    });
});
