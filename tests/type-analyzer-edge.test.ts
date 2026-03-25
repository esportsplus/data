import { describe, expect, it } from 'vitest';
import { createValidator, transformCode } from './utils';


describe('Type Analyzer: Edge Cases', () => {
    describe('template literal types', () => {
        it('treats template literal as string validation', () => {
            let code = transformCode(`
                type Email = \`\${string}@\${string}\`;
                type Data = { email: Email };
                validator.build<Data>();
            `);

            expect(code).toContain('typeof');
            expect(code).toContain('string');
        });
    });

    describe('Function/Promise mapped to unknown', () => {
        it('skips validation for Function-typed fields', () => {
            let validate = createValidator(`
                type Data = { fn: Function; name: string };
                validator.build<Data>();
            `);

            let result = validate({ fn: () => {}, name: 'test' });

            expect(result.ok).toBe(true);
            expect(result.data).toHaveProperty('name', 'test');
        });

        it('accepts any value for Function field while validating other fields', () => {
            let validate = createValidator(`
                type Data = { fn: Function; name: string };
                validator.build<Data>();
            `);

            // fn should accept any value since it maps to 'unknown'
            let result = validate({ fn: 42, name: 'test' });

            expect(result.ok).toBe(true);
        });

        it('skips validation for Promise-typed fields', () => {
            let validate = createValidator(`
                type Data = { name: string; task: Promise<string> };
                validator.build<Data>();
            `);

            let result = validate({ name: 'test', task: Promise.resolve('x') });

            expect(result.ok).toBe(true);
        });

        it('accepts any value for Promise field', () => {
            let validate = createValidator(`
                type Data = { name: string; task: Promise<string> };
                validator.build<Data>();
            `);

            let result = validate({ name: 'test', task: 42 });

            expect(result.ok).toBe(true);
        });

        it('still validates non-Function fields', () => {
            let validate = createValidator(`
                type Data = { fn: Function; name: string };
                validator.build<Data>();
            `);

            let result = validate({ fn: () => {}, name: 123 });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('name');
        });
    });

    describe('circular references', () => {
        it('does not throw during transformation of circular type', () => {
            expect(() => {
                transformCode(`
                    type Node = { child?: Node; value: string };
                    validator.build<Node>();
                `);
            }).not.toThrow();
        });

        it('generates a working validator for circular type', () => {
            let validate = createValidator(`
                type Node = { child?: Node; value: string };
                validator.build<Node>();
            `);

            let result = validate({ value: 'root' });

            expect(result.ok).toBe(true);
        });

        it('validates top-level properties of circular type', () => {
            let validate = createValidator(`
                type Node = { child?: Node; value: string };
                validator.build<Node>();
            `);

            let result = validate({ value: 123 });

            expect(result.ok).toBe(false);
        });
    });

    describe('record with explicit properties', () => {
        it('treats type with index signature and explicit props as object', () => {
            let code = transformCode(`
                type Data = { name: string; [key: string]: string };
                validator.build<Data>();
            `);

            // Should validate the 'name' property explicitly
            expect(code).toContain('name');
        });

        it('validates explicit properties on indexed type', () => {
            let validate = createValidator(`
                type Data = { name: string; [key: string]: string };
                validator.build<Data>();
            `);

            let result = validate({ name: 'test' });

            expect(result.ok).toBe(true);
        });

        it('rejects invalid explicit property on indexed type', () => {
            let validate = createValidator(`
                type Data = { name: string; [key: string]: string };
                validator.build<Data>();
            `);

            let result = validate({ name: 42 });

            expect(result.ok).toBe(false);
        });
    });
});
