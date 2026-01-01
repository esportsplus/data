import { describe, expect, it } from 'vitest';
import { max, min, range } from '../src/validators';


describe('min Validator', () => {
    describe('number validation', () => {
        let validator = min(5);
        let errors: string[] = [];

        beforeEach(() => {
            errors = [];
        });

        it('passes when value >= min', () => {
            validator(5, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('passes when value > min', () => {
            validator(10, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('fails when value < min', () => {
            validator(3, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be at least 5');
        });

        it('uses custom error message', () => {
            let customValidator = min(5, 'Value too small');

            customValidator(3, { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Value too small');
        });
    });

    describe('string length validation', () => {
        let validator = min(3);
        let errors: string[] = [];

        beforeEach(() => {
            errors = [];
        });

        it('passes when length >= min', () => {
            validator('abc', { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('fails when length < min', () => {
            validator('ab', { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be at least 3 characters');
        });
    });

    describe('array length validation', () => {
        let validator = min(2);
        let errors: string[] = [];

        beforeEach(() => {
            errors = [];
        });

        it('passes when length >= min', () => {
            validator([1, 2], { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('fails when length < min', () => {
            validator([1], { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be at least 2 items');
        });
    });

    describe('invalid type handling', () => {
        let validator = min(5);

        it('throws for unsupported type', () => {
            expect(() => {
                validator({} as any, { push: () => {} });
            }).toThrow('@esportsplus/data: min validator can only be applied to number, string, or array types');
        });
    });
});


describe('max Validator', () => {
    describe('number validation', () => {
        let validator = max(10);
        let errors: string[] = [];

        beforeEach(() => {
            errors = [];
        });

        it('passes when value <= max', () => {
            validator(10, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('passes when value < max', () => {
            validator(5, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('fails when value > max', () => {
            validator(15, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be at most 10');
        });

        it('uses custom error message', () => {
            let customValidator = max(10, 'Value too large');

            customValidator(15, { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Value too large');
        });
    });

    describe('string length validation', () => {
        let validator = max(5);
        let errors: string[] = [];

        beforeEach(() => {
            errors = [];
        });

        it('passes when length <= max', () => {
            validator('hello', { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('fails when length > max', () => {
            validator('hello world', { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be at most 5 characters');
        });
    });

    describe('array length validation', () => {
        let validator = max(3);
        let errors: string[] = [];

        beforeEach(() => {
            errors = [];
        });

        it('passes when length <= max', () => {
            validator([1, 2, 3], { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('fails when length > max', () => {
            validator([1, 2, 3, 4], { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be at most 3 items');
        });
    });

    describe('invalid type handling', () => {
        let validator = max(10);

        it('throws for unsupported type', () => {
            expect(() => {
                validator({} as any, { push: () => {} });
            }).toThrow('@esportsplus/data: max validator can only be applied to number, string, or array types');
        });
    });
});


describe('range Validator', () => {
    describe('number validation', () => {
        let validator = range(5, 10);
        let errors: string[] = [];

        beforeEach(() => {
            errors = [];
        });

        it('passes when value in range', () => {
            validator(7, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('passes at minimum', () => {
            validator(5, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('passes at maximum', () => {
            validator(10, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('fails when value < min', () => {
            validator(3, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be between 5 and 10');
        });

        it('fails when value > max', () => {
            validator(15, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be between 5 and 10');
        });

        it('uses custom error message', () => {
            let customValidator = range(5, 10, 'Out of range');

            customValidator(3, { push: (m) => errors.push(m) });

            expect(errors[0]).toBe('Out of range');
        });
    });

    describe('string length validation', () => {
        let validator = range(3, 10);
        let errors: string[] = [];

        beforeEach(() => {
            errors = [];
        });

        it('passes when length in range', () => {
            validator('hello', { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('fails when length < min', () => {
            validator('ab', { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be between 3 and 10 characters');
        });

        it('fails when length > max', () => {
            validator('this is too long', { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be between 3 and 10 characters');
        });
    });

    describe('array length validation', () => {
        let validator = range(2, 4);
        let errors: string[] = [];

        beforeEach(() => {
            errors = [];
        });

        it('passes when length in range', () => {
            validator([1, 2, 3], { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('fails when length < min', () => {
            validator([1], { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be between 2 and 4 items');
        });

        it('fails when length > max', () => {
            validator([1, 2, 3, 4, 5], { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('must be between 2 and 4 items');
        });
    });

    describe('invalid type handling', () => {
        let validator = range(5, 10);

        it('throws for unsupported type', () => {
            expect(() => {
                validator({} as any, { push: () => {} });
            }).toThrow('@esportsplus/data: range validator can only be applied to number, string, or array types');
        });
    });
});


describe('Edge Cases', () => {
    describe('boundary values', () => {
        it('min with zero', () => {
            let validator = min(0);
            let errors: string[] = [];

            validator(0, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('max with zero', () => {
            let validator = max(0);
            let errors: string[] = [];

            validator(0, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('range with same min and max', () => {
            let validator = range(5, 5);
            let errors: string[] = [];

            validator(5, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('negative numbers', () => {
            let validator = min(-10);
            let errors: string[] = [];

            validator(-5, { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });
    });

    describe('empty values', () => {
        it('empty string with min 0', () => {
            let validator = min(0);
            let errors: string[] = [];

            validator('', { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });

        it('empty array with min 0', () => {
            let validator = min(0);
            let errors: string[] = [];

            validator([], { push: (m) => errors.push(m) });

            expect(errors).toHaveLength(0);
        });
    });
});
