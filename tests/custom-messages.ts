import { describe, expect, it } from 'vitest';
import { createValidator, transformCode } from './utils';


describe('Custom Error Messages', () => {
    describe('generated code', () => {
        it('includes custom message strings in generated output', () => {
            let code = transformCode(`
                type User = { age: number; name: string };
                type UserErrors = { age: 'Age must be valid'; name: 'Name is required' };
                validator.build<User, UserErrors>();
            `);

            expect(code).toContain('Name is required');
            expect(code).toContain('Age must be valid');
        });

        it('does not include custom messages when no error type provided', () => {
            let code = transformCode(`
                type User = { age: number; name: string };
                validator.build<User>();
            `);

            expect(code).not.toContain('Name is required');
        });
    });

    describe('flat properties', () => {
        it('uses custom message for invalid string field', () => {
            let validate = createValidator(`
                type User = { age: number; name: string };
                type UserErrors = { age: 'Age must be a valid number'; name: 'Name is required' };
                validator.build<User, UserErrors>();
            `);

            let result = validate({ age: 25, name: 123 });

            expect(result.ok).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors![0].message).toBe('Name is required');
            expect(result.errors![0].path).toBe('name');
        });

        it('uses custom message for invalid number field', () => {
            let validate = createValidator(`
                type User = { age: number; name: string };
                type UserErrors = { age: 'Age must be a valid number'; name: 'Name is required' };
                validator.build<User, UserErrors>();
            `);

            let result = validate({ age: 'not-a-number', name: 'John' });

            expect(result.ok).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors![0].message).toBe('Age must be a valid number');
            expect(result.errors![0].path).toBe('age');
        });

        it('passes validation with valid data and custom messages defined', () => {
            let validate = createValidator(`
                type User = { age: number; name: string };
                type UserErrors = { age: 'Age must be a valid number'; name: 'Name is required' };
                validator.build<User, UserErrors>();
            `);

            let result = validate({ age: 25, name: 'John' });

            expect(result.ok).toBe(true);
            expect(result.errors).toBeUndefined();
        });

        it('reports multiple custom error messages', () => {
            let validate = createValidator(`
                type User = { age: number; name: string };
                type UserErrors = { age: 'Age must be a valid number'; name: 'Name is required' };
                validator.build<User, UserErrors>();
            `);

            let result = validate({ age: 'bad', name: 456 });

            expect(result.ok).toBe(false);
            expect(result.errors!.length).toBe(2);

            let messages = result.errors!.map((e: { message: string }) => e.message);

            expect(messages).toContain('Age must be a valid number');
            expect(messages).toContain('Name is required');
        });
    });

    describe('nested properties', () => {
        it('uses custom message for nested field', () => {
            let validate = createValidator(`
                type Data = { address: { city: string } };
                type DataErrors = { address: { city: 'City name required' } };
                validator.build<Data, DataErrors>();
            `);

            let result = validate({ address: { city: 123 } });

            expect(result.ok).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors![0].message).toBe('City name required');
            expect(result.errors![0].path).toBe('address.city');
        });
    });

    describe('boolean field custom messages', () => {
        it('uses custom message for invalid boolean', () => {
            let validate = createValidator(`
                type Settings = { active: boolean; name: string };
                type SettingsErrors = { active: 'Must be true or false'; name: 'Name required' };
                validator.build<Settings, SettingsErrors>();
            `);

            let result = validate({ active: 'invalid', name: 'test' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].message).toBe('Must be true or false');
        });
    });
});
