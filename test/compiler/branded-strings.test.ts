import { createValidator, transformCode } from '../utils';
import { describe, expect, it } from 'vitest';


type Validate = (input: unknown) => ValidationResult | Promise<ValidationResult>;

type ValidationResult = { data: unknown; errors?: Array<{ message: string; path: string }>; ok: boolean };


// Evaluate the FULL transformed module (types + imports stripped), not just the build prelude:
// a brand body inlined into the validate closure can reference outer-scope module symbols
// (e.g. a regex const) that createValidator's prelude slice drops, and a surviving
// `validator.set(...)` statement throws ReferenceError here once the import is removed.
function build(source: string): Validate {
    let code = transformCode(source),
        match = code.match(/const\s+(\w+)\s*=\s*\{\s*toJsonSchema:/);

    if (!match) {
        throw new Error('test: build POJO not found in transformed code:\n' + code);
    }

    let body = code
        .replace(/^\s*import\b.*$/gm, '')
        .replace(/^\s*type\b.*$/gm, '');

    return new Function(`${body}\nreturn ${match[1]}.validate;`)() as Validate;
}

function run(source: string): void {
    let body = transformCode(source)
        .replace(/^\s*import\b.*$/gm, '')
        .replace(/^\s*type\b.*$/gm, '');

    new Function(body)();
}


describe('Branded Strings (Template Literal Types)', () => {
    describe('template literal type', () => {
        let validate = createValidator(`
            type Email = \`\${string}@\${string}\`;
            type User = { email: Email; name: string };
            validator.build<User>();
        `);

        it('accepts valid string for template literal', () => {
            let result = validate({ email: 'test@example.com', name: 'John' });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ email: 'test@example.com', name: 'John' });
        });

        it('rejects a string that does not match the template pattern', () => {
            let result = validate({ email: 'not-an-email', name: 'John' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('email');
        });

        it('rejects non-string value', () => {
            let result = validate({ email: 123, name: 'John' });

            expect(result.ok).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors![0].path).toBe('email');
            expect(result.errors![0].message).toBe('must be a string');
        });

        it('rejects null', () => {
            let result = validate({ email: null, name: 'John' });

            expect(result.ok).toBe(false);
        });

        it('rejects undefined for required field', () => {
            let result = validate({ name: 'John' });

            expect(result.ok).toBe(false);
        });
    });

    describe('multiple template literal types', () => {
        let validate = createValidator(`
            type Email = \`\${string}@\${string}\`;
            type URL = \`https://\${string}\`;
            type Contact = { email: Email; website: URL };
            validator.build<Contact>();
        `);

        it('accepts valid strings for both fields', () => {
            let result = validate({ email: 'a@b', website: 'https://example.com' });

            expect(result.ok).toBe(true);
        });

        it('rejects non-string for template literal field', () => {
            let result = validate({ email: 'a@b', website: 42 });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('website');
        });
    });

    describe('branded string without custom validator', () => {
        it('fails the build: nothing would prove the brand', () => {
            expect(() => transformCode(`
                type Brand<T, B extends string> = T & { __brand: B };
                type Slug = Brand<string, 'slug'>;
                type Post = { slug: Slug; title: string };
                validator.build<Post>();
            `)).toThrow(/brand 'slug' \(at 'slug'\) has no validator\.set\(\) registration/);
        });
    });

    describe('generated code', () => {
        it('produces typeof string check for template literal type', () => {
            let code = transformCode(`
                type Email = \`\${string}@\${string}\`;
                type User = { email: Email };
                validator.build<User>();
            `);

            expect(code).toContain('typeof');
            expect(code).toContain('string');
        });

        it('does not contain validator.build in output', () => {
            let code = transformCode(`
                type Email = \`\${string}@\${string}\`;
                type User = { email: Email };
                validator.build<User>();
            `);

            expect(code).not.toContain('validator.build');
        });

        it('produces a function in output', () => {
            let code = transformCode(`
                type Email = \`\${string}@\${string}\`;
                type User = { email: Email };
                validator.build<User>();
            `);

            expect(code).toContain('=>');
        });
    });
});

describe('Brand registration and consumption', () => {
    describe('emitted code (C1: registration reads real source)', () => {
        let code = transformCode(`
            type Brand<T, B extends string> = T & { __brand: B };
            type Slug = Brand<string, 'slug'>;
            type ErrorType = { push(message: string): void };
            type Post = { slug: Slug };
            validator.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('slug too short'); } });
            validator.build<Post>();
        `);

        it('inlines the brand check against the generated input variable', () => {
            expect(code).toContain('_input');
            expect(code).toContain('.length < 3');
        });

        it('emits the brand error message', () => {
            expect(code).toContain('slug too short');
        });

        it('does NOT leave validator.set in the output (C2: consumed calls stripped)', () => {
            expect(code).not.toContain('validator.set');
            expect(code).not.toContain('.set(');
        });

        it('drops the now-dead validator import', () => {
            expect(code).not.toMatch(/import\s*\{[^}]*\bvalidator\b[^}]*\}/);
        });
    });

    describe('runtime behavior (C1: brands actually applied)', () => {
        it('rejects invalid input for a string brand', () => {
            let validate = build(`
                type Brand<T, B extends string> = T & { __brand: B };
                type Slug = Brand<string, 'slug'>;
                type ErrorType = { push(message: string): void };
                type Post = { slug: Slug };
                validator.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('slug too short'); } });
                validator.build<Post>();
            `) as (input: unknown) => ValidationResult;

            expect(validate({ slug: 'abcd' }).ok).toBe(true);

            let bad = validate({ slug: 'ab' });

            expect(bad.ok).toBe(false);
            expect(bad.errors![0].message).toBe('slug too short');
            expect(bad.errors![0].path).toBe('slug');
        });

        it('rejects invalid input for a number brand', () => {
            let validate = build(`
                type Brand<T, B extends string> = T & { __brand: B };
                type Positive = Brand<number, 'positive'>;
                type ErrorType = { push(message: string): void };
                type Amount = { amount: Positive };
                validator.set((value: Positive, errors: ErrorType) => { if (value <= 0) { errors.push('must be positive'); } });
                validator.build<Amount>();
            `) as (input: unknown) => ValidationResult;

            expect(validate({ amount: 5 }).ok).toBe(true);

            let bad = validate({ amount: -1 });

            expect(bad.ok).toBe(false);
            expect(bad.errors![0].message).toBe('must be positive');
        });

        it('promotes to async and rejects invalid input for an async brand', async () => {
            let validate = build(`
                type Brand<T, B extends string> = T & { __brand: B };
                type Handle = Brand<string, 'handle'>;
                type ErrorType = { push(message: string): void };
                type Account = { handle: Handle };
                validator.set(async (value: Handle, errors: ErrorType) => { await Promise.resolve(); if (value.length === 0) { errors.push('handle required'); } });
                validator.build<Account>();
            `);

            let pending = validate({ handle: '' });

            expect(pending).toBeInstanceOf(Promise);

            let bad = await pending;

            expect(bad.ok).toBe(false);
            expect(bad.errors![0].message).toBe('handle required');

            let good = await validate({ handle: 'x' });

            expect(good.ok).toBe(true);
        });

        it('applies two brands registered in one file', () => {
            let validate = build(`
                type Brand<T, B extends string> = T & { __brand: B };
                type Slug = Brand<string, 'slug'>;
                type Positive = Brand<number, 'positive'>;
                type ErrorType = { push(message: string): void };
                type Rec = { slug: Slug; amount: Positive };
                validator.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('slug too short'); } });
                validator.set((value: Positive, errors: ErrorType) => { if (value <= 0) { errors.push('must be positive'); } });
                validator.build<Rec>();
            `) as (input: unknown) => ValidationResult;

            expect(validate({ slug: 'abcd', amount: 5 }).ok).toBe(true);
            expect(validate({ slug: 'ab', amount: 5 }).ok).toBe(false);
            expect(validate({ slug: 'abcd', amount: -1 }).ok).toBe(false);
        });

        it('applies a brand whose body references an outer-scope const', () => {
            let validate = build(`
                type Brand<T, B extends string> = T & { __brand: B };
                type Email = Brand<string, 'email'>;
                type ErrorType = { push(message: string): void };
                type Contact = { email: Email };
                const EMAIL_RE = /^[^@\\s]+@[^@\\s]+$/;
                validator.set((value: Email, errors: ErrorType) => { if (!EMAIL_RE.test(value)) { errors.push('invalid email'); } });
                validator.build<Contact>();
            `) as (input: unknown) => ValidationResult;

            expect(validate({ email: 'a@b' }).ok).toBe(true);

            let bad = validate({ email: 'nope' });

            expect(bad.ok).toBe(false);
            expect(bad.errors![0].message).toBe('invalid email');
        });
    });

    describe('brands on every base type', () => {
        let prelude = `
            type Brand<T, B extends string> = T & { __brand: B };
            type ErrorType = { push(message: string): void };
        `;

        it('validates a branded object structurally, then against its registration', () => {
            let validate = build(`${prelude}
                type Money = Brand<{ amount: number; currency: string }, 'money'>;
                type Order = { price: Money };
                validator.set((value: Money, errors: ErrorType) => { if (value.amount < 0) { errors.push('negative'); } });
                validator.build<Order>();
            `) as (input: unknown) => ValidationResult;

            expect(validate({ price: { amount: 1, currency: 'usd' } })).toEqual({ data: { price: { amount: 1, currency: 'usd' } }, errors: undefined, ok: true });
            expect(validate({ price: 'garbage' }).errors).toEqual([{ message: 'must be an object', path: 'price' }]);
            expect(validate({ price: { amount: 1 } }).ok).toBe(false);
            expect(validate({ price: { amount: -1, currency: 'usd' } }).errors).toEqual([{ message: 'negative', path: 'price' }]);
        });

        it('accepts both values of a branded boolean and applies its registration', () => {
            let validate = build(`${prelude}
                type Flag = Brand<boolean, 'flag'>;
                type Settings = { on: Flag };
                validator.set((value: Flag, errors: ErrorType) => { if (value !== true) { errors.push('must be set'); } });
                validator.build<Settings>();
            `) as (input: unknown) => ValidationResult;

            expect(validate({ on: true }).ok).toBe(true);
            expect(validate({ on: false }).errors).toEqual([{ message: 'must be set', path: 'on' }]);
            expect(validate({ on: 'x' }).errors).toEqual([{ message: 'must be true or false', path: 'on' }]);
        });

        it('checks a branded literal union against its literals, then its registration', () => {
            let validate = build(`${prelude}
                type Level = Brand<'high' | 'low', 'level'>;
                type Alarm = { level: Level };
                validator.set((value: Level, errors: ErrorType) => { if (value === 'high') { errors.push('too loud'); } });
                validator.build<Alarm>();
            `) as (input: unknown) => ValidationResult;

            expect(validate({ level: 'low' }).ok).toBe(true);
            expect(validate({ level: 'high' }).errors).toEqual([{ message: 'too loud', path: 'level' }]);
            expect(validate({ level: 'medium' }).errors).toEqual([{ message: 'invalid literal type', path: 'level' }]);
        });

        it('skips the registration for null on a nullable brand', () => {
            let validate = build(`${prelude}
                type Slug = Brand<string, 'slug'>;
                type Post = { slug: Slug | null };
                validator.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('slug too short'); } });
                validator.build<Post>();
            `) as (input: unknown) => ValidationResult;

            expect(validate({ slug: null }).ok).toBe(true);
            expect(validate({ slug: 'ab' }).errors).toEqual([{ message: 'slug too short', path: 'slug' }]);
        });

        it('applies a brand on a union member', () => {
            let validate = build(`${prelude}
                type Flag = Brand<boolean, 'flag'>;
                type Settings = { on: Flag | number };
                validator.set((value: Flag, errors: ErrorType) => { if (value !== true) { errors.push('must be set'); } });
                validator.build<Settings>();
            `) as (input: unknown) => ValidationResult;

            expect(validate({ on: true }).ok).toBe(true);
            expect(validate({ on: 3 }).ok).toBe(true);
            expect(validate({ on: false }).ok).toBe(false);
        });

        it('fails the build for an unregistered brand nested anywhere', () => {
            expect(() => transformCode(`${prelude}
                type Money = Brand<{ amount: number }, 'money'>;
                type Cart = { items: { price: Money }[] };
                validator.build<Cart>();
            `)).toThrow(/brand 'money' .* has no validator\.set\(\) registration[\s\S]*:\d+:\d+/);
        });

        it('fails the build for a primitive intersected with an object, which no value can prove', () => {
            expect(() => transformCode(`
                type Tagged = string & { tag: number };
                type Data = { t: Tagged };
                validator.build<Data>();
            `)).toThrow(/cannot validate 't'/);
        });

        it('still emits a JSON Schema for an unregistered brand', () => {
            expect(() => transformCode(`${prelude}
                type Slug = Brand<string, 'slug'>;
                type Post = { slug: Slug };
                validator.toJsonSchema<Post>();
            `)).not.toThrow();
        });
    });

    describe('module transformation (C2: no ReferenceError, no stub throw)', () => {
        it('transforms and runs a set+build file without ReferenceError', () => {
            expect(() => build(`
                type Brand<T, B extends string> = T & { __brand: B };
                type Slug = Brand<string, 'slug'>;
                type ErrorType = { push(message: string): void };
                type Post = { slug: Slug };
                validator.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('slug too short'); } });
                validator.build<Post>();
            `)).not.toThrow();
        });

        it('transforms and runs a set-only file cleanly (no early return, no stub throw)', () => {
            let code = transformCode(`
                type Brand<T, B extends string> = T & { __brand: B };
                type Slug = Brand<string, 'slug'>;
                type ErrorType = { push(message: string): void };
                validator.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('too short'); } });
                const marker = 42;
            `);

            expect(code).not.toContain('validator.set');
            expect(code).not.toMatch(/import\s*\{[^}]*\bvalidator\b[^}]*\}/);

            expect(() => run(`
                type Brand<T, B extends string> = T & { __brand: B };
                type Slug = Brand<string, 'slug'>;
                type ErrorType = { push(message: string): void };
                validator.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('too short'); } });
                const marker = 42;
            `)).not.toThrow();
        });
    });

    describe('F-009: branded validator body preserves strings and property names', () => {
        let code = transformCode(`
            type Brand<T, B extends string> = T & { __brand: B };
            type Slug = Brand<string, 'slug'>;
            type ErrorType = { push(message: string): void };
            type Post = { slug: Slug };

            validator.set((value: Slug, errors: ErrorType) => {
                let opts = { value: 1 };

                if (opts.value !== value.length) {
                    errors.push('invalid value length');
                }
            });

            validator.build<Post>();
        `);

        it('inlines the check rather than leaving the raw set call', () => {
            expect(code).not.toContain('validator.set');
        });

        it('preserves the word "value" inside a string literal message', () => {
            expect(code).toContain('invalid value length');
        });

        it('preserves a ".value" property access', () => {
            expect(code).toContain('opts.value');
        });

        it('preserves a "value:" object literal key', () => {
            expect(code).toContain('value: 1');
        });
    });
});
