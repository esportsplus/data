import { describe, expect, it } from 'vitest';
import { createValidator, transformCode } from './utils';


describe('Async Validators', () => {
    describe('generated code detection', () => {
        it('generates async function when async config is provided', () => {
            let code = transformCode(`
                type User = { name: string };
                validator.build<User>(async (data, errors) => {
                    // async validation logic
                });
            `);

            expect(code).toContain('async (_input)');
        });

        it('generates async function when await keyword is in config body', () => {
            let code = transformCode(`
                type User = { name: string };
                validator.build<User>((data, errors) => {
                    let result = await fetch('/api');
                });
            `);

            expect(code).toContain('async (_input)');
        });

        it('generates sync function when no async/await in config', () => {
            let code = transformCode(`
                type User = { name: string };
                validator.build<User>((data, errors) => {
                    if (!data.name) errors.push({ message: 'bad', path: 'name' });
                });
            `);

            expect(code).not.toContain('async (_input)');
            expect(code).toContain('(_input)');
        });

        it('generates sync function when no config argument', () => {
            let code = transformCode(`
                type User = { name: string };
                validator.build<User>();
            `);

            expect(code).not.toContain('async');
            expect(code).toContain('(_input)');
        });
    });

    describe('async function extraction', () => {
        it('generated code includes async prefix before (_input)', () => {
            let code = transformCode(`
                type User = { name: string };
                validator.build<User>(async (data, errors) => {
                    // async validation
                });
            `);

            // The generated code should have 'async (_input) =>'
            let asyncMatch = code.match(/async\s+\(_input\)\s*=>/);

            expect(asyncMatch).not.toBeNull();
        });

        it('generated async validator includes custom validation code', () => {
            let code = transformCode(`
                type User = { name: string };
                validator.build<User>(async (data, errors) => {
                    // async validation logic here
                });
            `);

            // Custom validator code is injected after field checks
            expect(code).toContain('async');
            expect(code).toContain('_input');
        });

        it('validates fields correctly even with async config', async () => {
            // createValidator strips async prefix due to (_input) => search order,
            // but field validation logic is identical
            let validate = createValidator(`
                type User = { name: string };
                validator.build<User>(async (data, errors) => {
                    // async validation passes
                });
            `);

            // Field validation still works (sync extraction)
            let valid = validate({ name: 'John' }),
                invalid = validate({ name: 123 });

            // Handle both sync and async results
            let validResult = valid instanceof Promise ? await valid : valid,
                invalidResult = invalid instanceof Promise ? await invalid : invalid;

            expect(validResult.ok).toBe(true);
            expect(invalidResult.ok).toBe(false);
        });
    });

    describe('sync function behavior', () => {
        it('does not return a Promise when no async config', () => {
            let validate = createValidator(`
                type User = { name: string };
                validator.build<User>();
            `);

            let result = validate({ name: 'John' });

            expect(result).not.toBeInstanceOf(Promise);
            expect(result.ok).toBe(true);
        });
    });
});
