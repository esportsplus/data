import { createValidator, transformCode } from '../utils';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';


type ValidationResult = { data: unknown; errors?: Array<{ message: string; path: string }>; ok: boolean };


const PRELUDE = `
    type Brand<T, B extends string> = T & { __brand: B };
    type Slug = Brand<string, 'slug'>;
    type ErrorType = { push(message: string): void };
    type Post = { slug: Slug };
`;

const VALIDATORS_SOURCE = readFileSync(new URL('../../src/compiler/validators.ts', import.meta.url), 'utf8');


// Assemble a single-brand set+build module around `body`, the statement list of a
// `validator.set((value: Slug, errors: ErrorType) => { ... })` callback - the exact shape
// branded-strings.test.ts exercises.
function source(body: string): string {
    return PRELUDE + 'validator.set((value: Slug, errors: ErrorType) => { ' + body + ' });\nvalidator.build<Post>();';
}

function validatorFor(body: string): (input: unknown) => ValidationResult {
    return createValidator(source(body)) as (input: unknown) => ValidationResult;
}


describe('validator body AST rewrite (validator-body-ast-rewrite)', () => {
    describe('clause 1: static string args keep their exact value', () => {
        it('reports an apostrophe string literal intact', () => {
            let result = validatorFor(`if (value.length < 3) { errors.push('it\\'s bad'); }`)({ slug: 'ab' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].message).toBe("it's bad");
            expect(result.errors![0].path).toBe('slug');
        });

        it('reports the interpolated template value, not the literal source', () => {
            let result = validatorFor(`if (value.length < 3) { errors.push(\`bad: \${value.length}\`); }`)({ slug: 'ab' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].message).toBe('bad: 2');
        });
    });

    describe('clause 2: non-static args push against the real binding', () => {
        it('reports a variable message instead of throwing ReferenceError', () => {
            let result = validatorFor(`let msg = 'x'; if (value.length < 3) { errors.push(msg); }`)({ slug: 'ab' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].message).toBe('x');
        });
    });

    describe('clause 3: an errors.push inside a string literal is data, not a call to rewrite', () => {
        it('keeps an embedded errors.push occurrence as data (AST value, never a textual rewrite)', () => {
            let plain = validatorFor(`errors.push("saw errors.push('a')");`)({ slug: 'x' });

            expect(plain.errors![0].message).toBe("saw errors.push('a')");

            // Escaped inner quotes: a purely textual regex reads the backslash-escaped quotes as
            // literal characters and corrupts the message; the AST reads the string literal's value.
            let escaped = validatorFor(`errors.push("saw \\"errors.push('a')\\" here");`)({ slug: 'x' });

            expect(escaped.errors![0].message).toBe('saw "errors.push(\'a\')" here');
        });
    });

    describe('clause 4: the documented single-quoted happy path is untouched', () => {
        it('still reports a simple single-quoted message with the right path', () => {
            let result = validatorFor(`if (value.length < 3) { errors.push('slug too short'); }`)({ slug: 'ab' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].message).toBe('slug too short');
            expect(result.errors![0].path).toBe('slug');

            expect(validatorFor(`if (value.length < 3) { errors.push('slug too short'); }`)({ slug: 'abcd' }).ok).toBe(true);
        });
    });

    describe('clause 5: the bypassable disallowed-body guard is gone', () => {
        it('compiles a body containing eval(...) instead of throwing a disallowed-pattern error', () => {
            expect(() => transformCode(source(`eval('1'); if (value.length < 3) { errors.push('bad'); }`))).not.toThrow();
        });

        it('no longer references DISALLOWED_BODY_REGEX or ERRORS_PUSH_REGEX in the source', () => {
            expect(VALIDATORS_SOURCE).not.toMatch(/DISALLOWED_BODY_REGEX/);
            expect(VALIDATORS_SOURCE).not.toMatch(/ERRORS_PUSH_REGEX/);
        });
    });
});
