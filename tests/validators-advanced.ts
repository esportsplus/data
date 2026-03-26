import { describe, expect, it } from 'vitest';
import min from '../src/validators/min';
import max from '../src/validators/max';
import range from '../src/validators/range';


// --- Helper to collect errors ---

function validate(fn: ReturnType<typeof min>, value: unknown): string[] {
    let errors: string[] = [];

    fn(value, { push: (msg: string) => errors.push(msg) });

    return errors;
}


// --- min validator ---

describe('Validators: min (direct)', () => {
    describe('numbers', () => {
        it('passes when value equals min', () => {
            expect(validate(min(5), 5)).toEqual([]);
        });

        it('passes when value exceeds min', () => {
            expect(validate(min(5), 10)).toEqual([]);
        });

        it('fails when value is below min', () => {
            expect(validate(min(5), 3)).toHaveLength(1);
        });

        it('handles zero min', () => {
            expect(validate(min(0), 0)).toEqual([]);
            expect(validate(min(0), -1)).toHaveLength(1);
        });

        it('handles negative min', () => {
            expect(validate(min(-10), -5)).toEqual([]);
            expect(validate(min(-10), -15)).toHaveLength(1);
        });

        it('handles decimal values', () => {
            expect(validate(min(1.5), 1.5)).toEqual([]);
            expect(validate(min(1.5), 1.4)).toHaveLength(1);
        });
    });

    describe('strings', () => {
        it('passes when string length equals min', () => {
            expect(validate(min(3), 'abc')).toEqual([]);
        });

        it('passes when string length exceeds min', () => {
            expect(validate(min(3), 'abcd')).toEqual([]);
        });

        it('fails when string length is below min', () => {
            expect(validate(min(3), 'ab')).toHaveLength(1);
        });

        it('handles empty string with min 0', () => {
            expect(validate(min(0), '')).toEqual([]);
        });

        it('handles empty string with min 1', () => {
            expect(validate(min(1), '')).toHaveLength(1);
        });
    });

    describe('arrays', () => {
        it('passes when array length equals min', () => {
            expect(validate(min(2), [1, 2])).toEqual([]);
        });

        it('passes when array length exceeds min', () => {
            expect(validate(min(2), [1, 2, 3])).toEqual([]);
        });

        it('fails when array length is below min', () => {
            expect(validate(min(2), [1])).toHaveLength(1);
        });

        it('handles empty array with min 0', () => {
            expect(validate(min(0), [])).toEqual([]);
        });
    });

    describe('error messages', () => {
        it('uses default number message', () => {
            let errors = validate(min(5), 3);

            expect(errors[0]).toBe('must be at least 5');
        });

        it('uses default string message', () => {
            let errors = validate(min(5), 'ab');

            expect(errors[0]).toBe('must be at least 5 characters');
        });

        it('uses default array message', () => {
            let errors = validate(min(5), [1]);

            expect(errors[0]).toBe('must be at least 5 items');
        });

        it('uses custom message for all types', () => {
            let fn = min(5, 'too small');

            expect(validate(fn, 3)[0]).toBe('too small');
            expect(validate(fn, 'ab')[0]).toBe('too small');
            expect(validate(fn, [1])[0]).toBe('too small');
        });
    });

    describe('unsupported types', () => {
        it('throws for boolean', () => {
            expect(() => validate(min(1), true)).toThrow();
        });

        it('throws for object', () => {
            expect(() => validate(min(1), {})).toThrow();
        });

        it('throws for null', () => {
            expect(() => validate(min(1), null)).toThrow();
        });

        it('throws for undefined', () => {
            expect(() => validate(min(1), undefined)).toThrow();
        });
    });
});


// --- max validator ---

describe('Validators: max (direct)', () => {
    describe('numbers', () => {
        it('passes when value equals max', () => {
            expect(validate(max(10), 10)).toEqual([]);
        });

        it('passes when value is below max', () => {
            expect(validate(max(10), 5)).toEqual([]);
        });

        it('fails when value exceeds max', () => {
            expect(validate(max(10), 15)).toHaveLength(1);
        });

        it('handles zero max', () => {
            expect(validate(max(0), 0)).toEqual([]);
            expect(validate(max(0), 1)).toHaveLength(1);
        });

        it('handles negative max', () => {
            expect(validate(max(-5), -10)).toEqual([]);
            expect(validate(max(-5), -3)).toHaveLength(1);
        });
    });

    describe('strings', () => {
        it('passes when string length equals max', () => {
            expect(validate(max(3), 'abc')).toEqual([]);
        });

        it('fails when string length exceeds max', () => {
            expect(validate(max(3), 'abcd')).toHaveLength(1);
        });

        it('handles empty string', () => {
            expect(validate(max(0), '')).toEqual([]);
        });
    });

    describe('arrays', () => {
        it('passes when array length equals max', () => {
            expect(validate(max(2), [1, 2])).toEqual([]);
        });

        it('fails when array length exceeds max', () => {
            expect(validate(max(2), [1, 2, 3])).toHaveLength(1);
        });
    });

    describe('error messages', () => {
        it('uses default number message', () => {
            expect(validate(max(10), 15)[0]).toBe('must be at most 10');
        });

        it('uses default string message', () => {
            expect(validate(max(3), 'abcd')[0]).toBe('must be at most 3 characters');
        });

        it('uses default array message', () => {
            expect(validate(max(2), [1, 2, 3])[0]).toBe('must be at most 2 items');
        });

        it('uses custom message', () => {
            expect(validate(max(10, 'too big'), 15)[0]).toBe('too big');
        });
    });

    describe('unsupported types', () => {
        it('throws for boolean', () => {
            expect(() => validate(max(1), true)).toThrow();
        });

        it('throws for object', () => {
            expect(() => validate(max(1), {})).toThrow();
        });
    });
});


// --- range validator ---

describe('Validators: range (direct)', () => {
    describe('numbers', () => {
        it('passes when value is within range', () => {
            expect(validate(range(1, 10), 5)).toEqual([]);
        });

        it('passes when value equals min', () => {
            expect(validate(range(1, 10), 1)).toEqual([]);
        });

        it('passes when value equals max', () => {
            expect(validate(range(1, 10), 10)).toEqual([]);
        });

        it('fails when value is below min', () => {
            expect(validate(range(1, 10), 0)).toHaveLength(1);
        });

        it('fails when value exceeds max', () => {
            expect(validate(range(1, 10), 11)).toHaveLength(1);
        });

        it('handles same min and max', () => {
            expect(validate(range(5, 5), 5)).toEqual([]);
            expect(validate(range(5, 5), 4)).toHaveLength(1);
            expect(validate(range(5, 5), 6)).toHaveLength(1);
        });

        it('handles negative range', () => {
            expect(validate(range(-10, -1), -5)).toEqual([]);
            expect(validate(range(-10, -1), -11)).toHaveLength(1);
            expect(validate(range(-10, -1), 0)).toHaveLength(1);
        });
    });

    describe('strings', () => {
        it('passes when string length is within range', () => {
            expect(validate(range(2, 5), 'abc')).toEqual([]);
        });

        it('fails when string is too short', () => {
            expect(validate(range(2, 5), 'a')).toHaveLength(1);
        });

        it('fails when string is too long', () => {
            expect(validate(range(2, 5), 'abcdef')).toHaveLength(1);
        });
    });

    describe('arrays', () => {
        it('passes when array length is within range', () => {
            expect(validate(range(1, 3), [1, 2])).toEqual([]);
        });

        it('fails when array is too short', () => {
            expect(validate(range(2, 5), [1])).toHaveLength(1);
        });

        it('fails when array is too long', () => {
            expect(validate(range(1, 2), [1, 2, 3])).toHaveLength(1);
        });
    });

    describe('error messages', () => {
        it('uses default number message', () => {
            expect(validate(range(1, 10), 0)[0]).toBe('must be between 1 and 10');
        });

        it('uses default string message', () => {
            expect(validate(range(2, 5), 'a')[0]).toBe('must be between 2 and 5 characters');
        });

        it('uses default array message', () => {
            expect(validate(range(2, 5), [1])[0]).toBe('must be between 2 and 5 items');
        });

        it('uses custom message', () => {
            expect(validate(range(1, 10, 'out of range'), 0)[0]).toBe('out of range');
        });
    });

    describe('unsupported types', () => {
        it('throws for boolean', () => {
            expect(() => validate(range(1, 10), true)).toThrow();
        });

        it('throws for object', () => {
            expect(() => validate(range(1, 10), {})).toThrow();
        });

        it('throws for null', () => {
            expect(() => validate(range(1, 10), null)).toThrow();
        });
    });
});


// --- Edge cases across all validators ---

describe('Validators: Cross-cutting edge cases', () => {
    it('min(0) allows zero-length string', () => {
        expect(validate(min(0), '')).toEqual([]);
    });

    it('max(0) allows empty string', () => {
        expect(validate(max(0), '')).toEqual([]);
    });

    it('max(0) rejects non-empty string', () => {
        expect(validate(max(0), 'a')).toHaveLength(1);
    });

    it('range(0, 0) allows only empty', () => {
        expect(validate(range(0, 0), '')).toEqual([]);
        expect(validate(range(0, 0), 'a')).toHaveLength(1);
        expect(validate(range(0, 0), 0)).toEqual([]);
        expect(validate(range(0, 0), 1)).toHaveLength(1);
    });

    it('validators are reusable', () => {
        let fn = min(3);

        expect(validate(fn, 5)).toEqual([]);
        expect(validate(fn, 1)).toHaveLength(1);
        expect(validate(fn, 5)).toEqual([]);
    });

    it('multiple errors do not accumulate across calls', () => {
        let fn = min(5);

        let errors1 = validate(fn, 1);
        let errors2 = validate(fn, 2);

        expect(errors1).toHaveLength(1);
        expect(errors2).toHaveLength(1);
    });
});
