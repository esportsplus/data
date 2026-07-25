import { describe, expect, it } from 'vitest';
import { createValidator } from '../utils';


type Result = { data: unknown; errors?: Array<{ message: string; path: string }>; ok: boolean };


function keys(value: unknown): string[] {
    return Object.keys(value as object);
}

function messages(result: Result): string[] {
    return (result.errors ?? []).map((error) => error.message);
}

function prop(value: unknown, name: string): unknown {
    return (value as Record<string, unknown>)[name];
}


describe('output construction never mutates the caller input (C5)', () => {
    let validate = createValidator(`
        type Data = { value: number };
        validator.build<Data>();
    `);

    it('leaves a coercible input string untouched (deep-equal snapshot)', () => {
        let before = structuredClone({ value: '42' }),
            input = { value: '42' };

        validate(input);

        expect(input).toEqual(before);
        expect(input.value).toBe('42');
    });

    it('leaves an invalid input string untouched, writing no NaN back', () => {
        let before = structuredClone({ value: 'abc' }),
            input = { value: 'abc' },
            result = validate(input) as Result;

        expect(result.ok).toBe(false);
        expect(input).toEqual(before);
        expect(input.value).toBe('abc');
    });

    it('coerces the string into fresh data while the input keeps the string', () => {
        let input = { value: '42' },
            result = validate(input) as Result;

        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ value: 42 });
        expect(prop(result.data, 'value')).toBe(42);
        expect(input.value).toBe('42');
    });

    it('validates a frozen input without throwing and coerces into fresh data', () => {
        let input = Object.freeze({ value: '42' }),
            result!: Result;

        expect(() => {
            result = validate(input) as Result;
        }).not.toThrow();

        expect(result.ok).toBe(true);
        expect(prop(result.data, 'value')).toBe(42);
        expect(typeof prop(result.data, 'value')).toBe('number');
        expect(input.value).toBe('42');
    });
});


describe('union branch speculation writes into a throwaway container (C6)', () => {
    let validate = createValidator(`
        type A = { a: number; kind: 'a' };
        type B = { b: string; kind: 'b' };
        type Data = { v: A | B };
        validator.build<Data>();
    `);

    it('a matched branch invents no keys on the caller object', () => {
        let inner = { b: 'x', kind: 'b' },
            result = validate({ v: inner }) as Result;

        expect(result.ok).toBe(true);
        expect(keys(inner).sort()).toEqual(['b', 'kind']);
    });

    it('a matched branch invents no keys on the produced data', () => {
        let result = validate({ v: { b: 'x', kind: 'b' } }) as Result;

        expect(result.ok).toBe(true);
        expect(prop(result.data, 'v')).not.toHaveProperty('a');
        expect(prop(result.data, 'v')).toEqual({ b: 'x', kind: 'b' });
    });
});


describe('root guard returns instead of throwing (C7)', () => {
    let validate = createValidator(`
        type Data = { value: string };
        validator.build<Data>();
    `);

    it('validate(null) returns ok:false without throwing', () => {
        let result!: Result;

        expect(() => {
            result = validate(null) as Result;
        }).not.toThrow();

        expect(result.ok).toBe(false);
    });

    it('validate(undefined) returns ok:false without throwing', () => {
        let result!: Result;

        expect(() => {
            result = validate(undefined) as Result;
        }).not.toThrow();

        expect(result.ok).toBe(false);
    });

    it('validate(42) returns a single root-level error, not a per-field error', () => {
        let result = validate(42) as Result;

        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors![0].path).not.toBe('value');
    });
});


describe('strict number coercion (C15)', () => {
    let validate = createValidator(`
        type Data = { value: number };
        validator.build<Data>();
    `);

    it('rejects the empty string', () => {
        expect((validate({ value: '' }) as Result).ok).toBe(false);
    });

    it('rejects boolean true', () => {
        expect((validate({ value: true }) as Result).ok).toBe(false);
    });

    it('rejects an array', () => {
        expect((validate({ value: [] }) as Result).ok).toBe(false);
    });

    it('rejects a hexadecimal string', () => {
        expect((validate({ value: '0x10' }) as Result).ok).toBe(false);
    });

    it('accepts a scientific-notation string, coercing only into data', () => {
        let input = { value: '1e3' },
            result = validate(input) as Result;

        expect(result.ok).toBe(true);
        expect(prop(result.data, 'value')).toBe(1000);
        expect(input.value).toBe('1e3');
    });
});


describe('__proto__ key lands as an own property (C16)', () => {
    let validate = createValidator(`
        type Data = { __proto__: string };
        validator.build<Data>();
    `);

    it('writes __proto__ as an own key without polluting the prototype', () => {
        let input = JSON.parse('{"__proto__":"hello"}'),
            result = validate(input) as Result;

        expect(result.ok).toBe(true);
        expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
        expect(keys(result.data)).toContain('__proto__');
        expect(Object.prototype.hasOwnProperty.call(result.data, '__proto__')).toBe(true);
        expect(prop(result.data, '__proto__')).toBe('hello');
    });
});


describe('nullable non-union property short-circuits before configured validators (E-P1)', () => {
    let validate = createValidator(`
        type User = { age: number | null };
        validator.build<User>({ age: (value, errors) => { errors.push('invoked:' + String(value)); } });
    `);

    it('accepts null and never invokes the configured validator', () => {
        let result = validate({ age: null }) as Result;

        expect(result.ok).toBe(true);
        expect(messages(result).some((message) => message.startsWith('invoked'))).toBe(false);
    });

    it('still invokes the configured validator for a present value', () => {
        let result = validate({ age: 20 }) as Result;

        expect(messages(result)).toContain('invoked:20');
    });
});
