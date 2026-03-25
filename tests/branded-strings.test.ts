import { createValidator, transformCode } from './utils';
import { describe, expect, it } from 'vitest';


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

        it('accepts any string (runtime only checks typeof)', () => {
            let result = validate({ email: 'not-an-email', name: 'John' });

            expect(result.ok).toBe(true);
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
        let validate = createValidator(`
            type Brand<T, B extends string> = T & { __brand: B };
            type Slug = Brand<string, 'slug'>;
            type Post = { slug: Slug; title: string };
            validator.build<Post>();
        `);

        it('accepts valid string', () => {
            let result = validate({ slug: 'my-post', title: 'Hello' });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ slug: 'my-post', title: 'Hello' });
        });

        it('rejects non-string', () => {
            let result = validate({ slug: 123, title: 'Hello' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('slug');
            expect(result.errors![0].message).toBe('must be a string');
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
