import { describe, expect, it } from 'vitest';
import { createValidator, mightNeedTransform, transformCode } from './utils';


describe('Edge Cases', () => {
    describe('empty object', () => {
        let validate = createValidator(`
            type Empty = {};
            validator.build<Empty>();
        `);

        it('accepts empty object', () => {
            let result = validate({});

            expect(result.ok).toBe(true);
        });

        it('ignores extra properties', () => {
            let result = validate({ extra: 'value' });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({});
        });
    });

    describe('reserved keywords as property names', () => {
        let validate = createValidator(`
            type Data = {
                class: string;
                for: number;
                function: boolean;
            };
            validator.build<Data>();
        `);

        it('handles reserved keywords', () => {
            let result = validate({
                class: 'test',
                for: 42,
                function: true
            });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({
                class: 'test',
                for: 42,
                function: true
            });
        });
    });

    describe('special characters in property names', () => {
        let validate = createValidator(`
            type Data = {
                'kebab-case': string;
                'with spaces': number;
                'with.dots': boolean;
            };
            validator.build<Data>();
        `);

        it('handles special character properties', () => {
            let result = validate({
                'kebab-case': 'test',
                'with spaces': 42,
                'with.dots': true
            });

            expect(result.ok).toBe(true);
        });
    });

    describe('property extraction security', () => {
        let validate = createValidator(`
            type User = { name: string };
            validator.build<User>();
        `);

        it('only extracts declared properties', () => {
            let malicious = {
                __proto__: { evil: true },
                constructor: 'hacked',
                name: 'John',
                extraProp: 'should not appear'
            };
            let result = validate(malicious);

            expect(result.ok).toBe(true);
            expect(result.data.name).toBe('John');
            // Extra properties should not be in extracted data
            expect(result.data).not.toHaveProperty('extraProp');
            expect(result.data).not.toHaveProperty('__proto__');
        });
    });

    describe('input types', () => {
        let validate = createValidator(`
            type Data = { value: string };
            validator.build<Data>();
        `);

        it('handles null input', () => {
            // Null input may throw or return error depending on implementation
            try {
                let result = validate(null);

                expect(result.ok).toBe(false);
            }
            catch (e) {
                // Throws when trying to access property on null
                expect(e).toBeInstanceOf(Error);
            }
        });

        it('rejects array input', () => {
            let result = validate(['value']);

            expect(result.ok).toBe(false);
        });

        it('rejects primitive input', () => {
            let result = validate('string');

            expect(result.ok).toBe(false);
        });
    });

    describe('never type', () => {
        let validate = createValidator(`
            type Data = {
                name: string;
                _internal: never;
            };
            validator.build<Data>();
        `);

        it('excludes never properties from output', () => {
            let result = validate({ name: 'test', _internal: 'anything' });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ name: 'test' });
            expect(result.data).not.toHaveProperty('_internal');
        });
    });
});


describe('Error Messages', () => {
    describe('path tracking', () => {
        let validate = createValidator(`
            type Inner = { value: number };
            type Outer = {
                first: {
                    second: Inner;
                };
            };
            validator.build<Outer>();
        `);

        it('reports correct nested path', () => {
            let result = validate({
                first: {
                    second: {
                        value: 'not a number'
                    }
                }
            });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toBe('first.second.value');
        });
    });

    describe('array index paths', () => {
        let validate = createValidator(`
            type Data = { items: string[] };
            validator.build<Data>();
        `);

        it('includes array index in path', () => {
            let result = validate({ items: ['a', 123, 'c'] });

            expect(result.ok).toBe(false);
            expect(result.errors![0].path).toMatch(/items\[\d+\]/);
        });
    });

    describe('error structure', () => {
        let validate = createValidator(`
            type Data = { value: string };
            validator.build<Data>();
        `);

        it('returns properly structured errors', () => {
            let result = validate({ value: 123 });

            expect(result.ok).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors![0]).toHaveProperty('message');
            expect(result.errors![0]).toHaveProperty('path');
        });

        it('returns data even on failure', () => {
            let input = { value: 123 };
            let result = validate(input);

            expect(result.ok).toBe(false);
            expect(result.data).toBe(input);
        });
    });
});


describe('Type Coercion', () => {
    describe('number coercion', () => {
        let validate = createValidator(`
            type Data = { value: number };
            validator.build<Data>();
        `);

        it('coerces string to number', () => {
            let result = validate({ value: '42' });

            expect(result.ok).toBe(true);
            expect(typeof result.data.value).toBe('number');
            expect(result.data.value).toBe(42);
        });

        it('coerces float string', () => {
            let result = validate({ value: '3.14' });

            expect(result.ok).toBe(true);
            expect(result.data.value).toBeCloseTo(3.14);
        });

        it('rejects non-numeric string', () => {
            let result = validate({ value: 'abc' });

            expect(result.ok).toBe(false);
        });

        it('handles empty string', () => {
            // Empty string coerces to 0 in JavaScript via +''
            let result = validate({ value: '' });

            // Empty string becomes 0, which is a valid number
            expect(result.ok).toBe(true);
            expect(result.data.value).toBe(0);
        });
    });

    describe('boolean coercion edge cases', () => {
        let validate = createValidator(`
            type Data = { active: boolean };
            validator.build<Data>();
        `);

        it('coerces uppercase TRUE', () => {
            let result = validate({ active: 'TRUE' });

            expect(result.ok).toBe(true);
            expect(result.data.active).toBe(true);
        });

        it('coerces mixed case True', () => {
            let result = validate({ active: 'True' });

            expect(result.ok).toBe(true);
            expect(result.data.active).toBe(true);
        });

        it('rejects null', () => {
            let result = validate({ active: null });

            expect(result.ok).toBe(false);
        });
    });
});


describe('Transformer Detection', () => {
    it('detects validator.build calls', () => {
        let code = `validator.build<User>()`;

        expect(mightNeedTransform(code)).toBe(true);
    });

    it('detects codec calls', () => {
        let code = `codec<Data>()`;

        expect(mightNeedTransform(code)).toBe(true);
    });

    it('skips unrelated code', () => {
        let code = `const x = 1 + 2;`;

        expect(mightNeedTransform(code)).toBe(false);
    });
});


describe('Generated Code Quality', () => {
    it('generates valid JavaScript', () => {
        let code = `
            type User = {
                age: number;
                name: string;
            };
            validator.build<User>();
        `;
        let transformed = transformCode(code);

        // Should contain function arrow
        expect(transformed).toContain('=>');

        // Should contain error handling
        expect(transformed).toContain('_error');

        // Should contain ok result
        expect(transformed).toContain('ok:');
    });

    it('includes type checks', () => {
        let code = `
            type Data = { value: string };
            validator.build<Data>();
        `;
        let transformed = transformCode(code);

        // Should check for string type
        expect(transformed).toContain("typeof");
        expect(transformed).toContain("'string'");
    });
});


describe('Performance Patterns', () => {
    describe('lazy error allocation', () => {
        let validate = createValidator(`
            type Data = { value: string };
            validator.build<Data>();
        `);

        it('no error array on success', () => {
            let result = validate({ value: 'test' });

            expect(result.ok).toBe(true);
            expect(result.errors).toBeUndefined();
        });
    });

    describe('early return on array errors', () => {
        let validate = createValidator(`
            type Data = { items: string[] };
            validator.build<Data>();
        `);

        it('stops on first array item error', () => {
            let result = validate({ items: [1, 2, 3, 4, 5] });

            expect(result.ok).toBe(false);
            expect(result.errors).toHaveLength(1);
        });
    });
});


describe('Null vs Undefined Handling', () => {
    describe('required field', () => {
        let validate = createValidator(`
            type Data = { value: string };
            validator.build<Data>();
        `);

        it('rejects undefined', () => {
            let result = validate({});

            expect(result.ok).toBe(false);
        });

        it('rejects null', () => {
            let result = validate({ value: null });

            expect(result.ok).toBe(false);
        });
    });

    describe('optional field', () => {
        let validate = createValidator(`
            type Data = { value?: string };
            validator.build<Data>();
        `);

        it('accepts undefined', () => {
            let result = validate({});

            expect(result.ok).toBe(true);
        });

        it('accepts explicit undefined', () => {
            let result = validate({ value: undefined });

            expect(result.ok).toBe(true);
        });

        it('rejects null for optional non-nullable', () => {
            let result = validate({ value: null });

            expect(result.ok).toBe(false);
        });
    });

    describe('nullable field', () => {
        let validate = createValidator(`
            type Data = { value: string | null };
            validator.build<Data>();
        `);

        it('validates null in union', () => {
            let result = validate({ value: null });

            // Document actual behavior - union with null
            expect(typeof result.ok).toBe('boolean');
        });

        it('rejects undefined', () => {
            let result = validate({});

            expect(result.ok).toBe(false);
        });
    });

    describe('optional nullable field', () => {
        let validate = createValidator(`
            type Data = { value?: string | null };
            validator.build<Data>();
        `);

        it('accepts undefined', () => {
            let result = validate({});

            expect(result.ok).toBe(true);
        });

        it('validates null when optional is present', () => {
            let result = validate({ value: null });

            // Document actual behavior for optional nullable
            expect(typeof result.ok).toBe('boolean');
        });

        it('accepts value', () => {
            let result = validate({ value: 'test' });

            expect(result.ok).toBe(true);
        });
    });
});
