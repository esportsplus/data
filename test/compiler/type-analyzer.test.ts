import { describe, expect, it } from 'vitest';
import { createValidator, transformCode } from '../utils';


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

    describe('callable types', () => {
        it('accepts a function for a Function-typed field', () => {
            let validate = createValidator(`
                type Data = { fn: Function; name: string };
                validator.build<Data>();
            `);

            let result = validate({ fn: () => {}, name: 'test' });

            expect(result.ok).toBe(true);
            expect(result.data).toHaveProperty('name', 'test');
        });

        it('rejects a non-function for a Function-typed field', () => {
            let validate = createValidator(`
                type Data = { fn: Function; name: string };
                validator.build<Data>();
            `);

            let result = validate({ fn: 42, name: 'test' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('fn');
        });

        it('accepts a function for a bare arrow-typed field', () => {
            let validate = createValidator(`
                type Data = { fn: () => void; name: string };
                validator.build<Data>();
            `);

            expect(validate({ fn: () => {}, name: 'test' }).ok).toBe(true);
        });

        it('rejects a string for a bare arrow-typed field', () => {
            let validate = createValidator(`
                type Data = { fn: () => void; name: string };
                validator.build<Data>();
            `);

            let result = validate({ fn: 'nope', name: 'test' });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('fn');
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

    describe('Promise mapped to unknown', () => {
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

            expect(validate({ name: 'test', task: 42 }).ok).toBe(true);
        });
    });

    describe('Map and Set', () => {
        it('accepts a valid Map and Set', () => {
            let validate = createValidator(`
                type Data = { m: Map<string, number>; s: Set<string> };
                validator.build<Data>();
            `);

            let result = validate({
                m: new Map([['a', 1]]),
                s: new Set(['x'])
            });

            expect(result.ok).toBe(true);
        });

        it('rejects a plain object for a Map-typed field', () => {
            let validate = createValidator(`
                type Data = { m: Map<string, number> };
                validator.build<Data>();
            `);

            let result = validate({ m: { a: 1 } });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('m');
        });

        it('rejects a plain object for a Set-typed field', () => {
            let validate = createValidator(`
                type Data = { s: Set<string> };
                validator.build<Data>();
            `);

            let result = validate({ s: ['x'] });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('s');
        });

        it('rejects wrong entry types in a Map', () => {
            let validate = createValidator(`
                type Data = { m: Map<string, number> };
                validator.build<Data>();
            `);

            let result = validate({ m: new Map([['a', 'not-a-number']]) as unknown as Map<string, number> });

            expect(result.ok).toBe(false);
        });

        it('rejects wrong entry types in a Set', () => {
            let validate = createValidator(`
                type Data = { s: Set<string> };
                validator.build<Data>();
            `);

            let result = validate({ s: new Set([1]) as unknown as Set<string> });

            expect(result.ok).toBe(false);
        });
    });

    describe('tuple with rest element', () => {
        it('accepts a tuple with only the required prefix', () => {
            let validate = createValidator(`
                type Data = { t: [number, ...string[]] };
                validator.build<Data>();
            `);

            expect(validate({ t: [1] }).ok).toBe(true);
        });

        it('accepts a tuple with rest elements', () => {
            let validate = createValidator(`
                type Data = { t: [number, ...string[]] };
                validator.build<Data>();
            `);

            expect(validate({ t: [1, 'a', 'b'] }).ok).toBe(true);
        });

        it('rejects a rest element of the wrong type', () => {
            let validate = createValidator(`
                type Data = { t: [number, ...string[]] };
                validator.build<Data>();
            `);

            expect(validate({ t: [1, 2] }).ok).toBe(false);
        });

        it('rejects a tuple missing the required prefix', () => {
            let validate = createValidator(`
                type Data = { t: [number, ...string[]] };
                validator.build<Data>();
            `);

            expect(validate({ t: [] }).ok).toBe(false);
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

    describe('non-object root types', () => {
        it('accepts a valid element for a string[] root', () => {
            let validate = createValidator('validator.build<string[]>();');

            expect(validate(['a']).ok).toBe(true);
        });

        it('rejects a wrong element type for a string[] root', () => {
            let validate = createValidator('validator.build<string[]>();');

            expect(validate([1]).ok).toBe(false);
        });

        it('accepts a string for a string root', () => {
            let validate = createValidator('validator.build<string>();');

            expect(validate('x').ok).toBe(true);
        });

        it('rejects a non-string for a string root', () => {
            let validate = createValidator('validator.build<string>();');

            expect(validate(42).ok).toBe(false);
        });

        it('accepts a number for a number root', () => {
            let validate = createValidator('validator.build<number>();');

            expect(validate(3).ok).toBe(true);
        });

        it('validates each branch of a union root without an empty validator', () => {
            let validate = createValidator('validator.build<{ a: number } | { b: string }>();');

            expect(validate({ a: 1 }).ok).toBe(true);
            expect(validate({ b: 'x' }).ok).toBe(true);
            expect(validate({ a: 'nope' }).ok).toBe(false);
            expect(validate(42).ok).toBe(false);
        });

        it('validates numeric and string enums via the literal path', () => {
            let stringEnum = createValidator("validator.build<'a' | 'b'>();");
            let numericEnum = createValidator('validator.build<1 | 2>();');

            expect(stringEnum('a').ok).toBe(true);
            expect(stringEnum('c').ok).toBe(false);
            expect(numericEnum(1).ok).toBe(true);
            expect(numericEnum(3).ok).toBe(false);
        });
    });
});
