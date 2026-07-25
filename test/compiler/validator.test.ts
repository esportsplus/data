import { describe, expect, it } from 'vitest';
import { min } from '../../src/validators';
import { createValidator, transformCode } from '../utils';


type Result = { data: any; errors?: Array<{ message: string; path: string }>; ok: boolean };


// Config suites reference hoisted `const v_… = min(…)` consts that createValidator strips,
// so execute the full emitted module with the factory injected (mirrors config.test.ts).
function build(source: string, injected: Record<string, unknown> = {}): (input: unknown) => Result {
    let body = transformCode(source)
            .split('\n')
            .filter((line) => !/^\s*import\b/.test(line) && !/^\s*type\b/.test(line))
            .join('\n'),
        keys = Object.keys(injected);

    // eslint-disable-next-line no-new-func
    return new Function(...keys, `${body}\nreturn validate.validate;`)(...keys.map((key) => injected[key])) as (input: unknown) => Result;
}


describe('Output construction never mutates input', () => {
    describe('frozen input (C5)', () => {
        let validate = createValidator(`
            type Data = { n: number };
            validator.build<Data>();
        `);

        it('validates a frozen object without throwing', () => {
            let input = Object.freeze({ n: 42 });

            expect(() => validate(input)).not.toThrow();
            expect(validate(input).ok).toBe(true);
        });

        it('coerces a frozen string field without throwing', () => {
            let input = Object.freeze({ n: '42' });
            let result = validate(input);

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ n: 42 });
            expect(input.n).toBe('42');
        });
    });

    describe('zero mutation of caller object (C5)', () => {
        let validate = createValidator(`
            type Data = { n: number };
            validator.build<Data>();
        `);

        it('leaves a coercible string field untouched', () => {
            let input = { n: '42' };
            let before = structuredClone(input);
            let result = validate(input);

            expect(result.ok).toBe(true);
            expect(input).toEqual(before);
            expect(input.n).toBe('42');
            expect(result.data.n).toBe(42);
        });

        it('leaves a rejected field untouched', () => {
            let input = { n: 'abc' };
            let before = structuredClone(input);
            let result = validate(input);

            expect(result.ok).toBe(false);
            expect(input).toEqual(before);
            expect(input.n).toBe('abc');
        });
    });

    describe('coercion lands in data, not input (C5/C15)', () => {
        let validate = createValidator(`
            type Data = { n: number };
            validator.build<Data>();
        `);

        it('coerces the numeric string in data while input keeps the string', () => {
            let input = { n: '42' };
            let result = validate(input);

            expect(result.data.n).toBe(42);
            expect(typeof result.data.n).toBe('number');
            expect(input.n).toBe('42');
            expect(typeof input.n).toBe('string');
        });
    });
});


describe('Strict number coercion (C15)', () => {
    let validate = createValidator(`
        type Data = { n: number };
        validator.build<Data>();
    `);

    it('accepts a decimal string', () => {
        expect(validate({ n: '42' }).ok).toBe(true);
        expect(validate({ n: '-3.14' }).ok).toBe(true);
        expect(validate({ n: '1e3' }).ok).toBe(true);
    });

    it('accepts a finite number', () => {
        expect(validate({ n: 0 }).ok).toBe(true);
        expect(validate({ n: -10.5 }).ok).toBe(true);
    });

    it('rejects the empty string', () => {
        let result = validate({ n: '' });

        expect(result.ok).toBe(false);
        expect(result.errors![0].message).toBe('must be a number');
    });

    it('rejects a boolean', () => {
        expect(validate({ n: true }).ok).toBe(false);
    });

    it('rejects an array', () => {
        expect(validate({ n: [] }).ok).toBe(false);
    });

    it('rejects a hex string', () => {
        expect(validate({ n: '0x10' }).ok).toBe(false);
    });

    it('still rejects a non-numeric string, NaN and Infinity', () => {
        expect(validate({ n: 'abc' }).ok).toBe(false);
        expect(validate({ n: NaN }).ok).toBe(false);
        expect(validate({ n: Infinity }).ok).toBe(false);
    });
});


describe('Union branch speculation is isolated (C6)', () => {
    let validate = createValidator(`
        type A = { a: number; kind: 'a' };
        type B = { b: string; kind: 'b' };
        type Data = { v: A | B };
        validator.build<Data>();
    `);

    it('does not invent keys on the caller object from a failed branch', () => {
        let input = { v: { b: 'x', kind: 'b' } };
        let result = validate(input);

        expect(result.ok).toBe(true);
        expect(Object.keys(input.v).sort()).toEqual(['b', 'kind']);
    });

    it('produces data without the failed branch keys', () => {
        let input = { v: { b: 'x', kind: 'b' } };
        let result = validate(input);

        expect(result.ok).toBe(true);
        expect(result.data.v).not.toHaveProperty('a');
        expect(result.data.v).toEqual({ b: 'x', kind: 'b' });
    });
});


describe('Root guard never throws (C7)', () => {
    let validate = createValidator(`
        type Data = { n: number };
        validator.build<Data>();
    `);

    it('returns ok:false for null', () => {
        let result = validate(null);

        expect(result.ok).toBe(false);
        expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('returns ok:false for undefined', () => {
        expect(validate(undefined).ok).toBe(false);
    });

    it('returns ok:false for a primitive', () => {
        expect(validate(42).ok).toBe(false);
    });

    it('returns ok:false for an array', () => {
        expect(validate([1, 2, 3]).ok).toBe(false);
    });
});


describe('__proto__ property lands as an own key (C16)', () => {
    let validate = createValidator(`
        type Data = { "__proto__": string };
        validator.build<Data>();
    `);

    it('sets __proto__ as an own enumerable property, not the prototype', () => {
        let result = validate({ ['__proto__']: 'value' });

        expect(result.ok).toBe(true);
        expect(Object.keys(result.data)).toContain('__proto__');
        expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    });
});


describe('Nullable non-union property short-circuits null (E-P1)', () => {
    it('accepts null without invoking the configured validator', () => {
        let calls = 0,
            counted = (...args: unknown[]) => {
                let inner = (min as (...a: unknown[]) => (value: unknown, errors: unknown) => void)(...args);

                return (value: unknown, errors: unknown) => {
                    calls++;

                    return inner(value, errors);
                };
            };

        let validate = build(
            `type Data = { value: number | null };
             const validate = validator.build<Data>({ value: counted(3) });`,
            { counted }
        );

        let result = validate({ value: null });

        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ value: null });
        expect(calls).toBe(0);
    });

    it('still runs the configured validator for a present value', () => {
        let validate = build(
            `type Data = { value: number | null };
             const validate = validator.build<Data>({ value: min(3, 'too small') });`,
            { min }
        );

        expect(validate({ value: 5 }).ok).toBe(true);
        expect(validate({ value: 1 }).ok).toBe(false);
    });
});
