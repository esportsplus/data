import { describe, expect, it } from 'vitest';

import date from '../src/validators/date-constraint';
import finite from '../src/validators/finite';
import integer from '../src/validators/integer';
import max from '../src/validators/max';
import min from '../src/validators/min';
import multipleOf from '../src/validators/multiple-of';
import negative from '../src/validators/negative';
import nonNegative from '../src/validators/non-negative';
import nonPositive from '../src/validators/non-positive';
import positive from '../src/validators/positive';
import range from '../src/validators/range';
import safeInteger from '../src/validators/safe-integer';
import unique from '../src/validators/unique';


function expectPass(fn: (value: unknown, errors: { push(msg: string): void }) => void, value: unknown) {
    let errors: string[] = [];

    fn(value, { push: (m) => errors.push(m) });

    expect(errors).toHaveLength(0);
}

function expectFail(fn: (value: unknown, errors: { push(msg: string): void }) => void, value: unknown, msg?: string) {
    let errors: string[] = [];

    fn(value, { push: (m) => errors.push(m) });

    expect(errors.length).toBeGreaterThan(0);

    if (msg) {
        expect(errors[0]).toBe(msg);
    }
}


// ─── positive ──────────────────────────────────────────────────────────────


describe('positive', () => {
    it('passes for positive number', () => {
        expectPass(positive(), 1);
        expectPass(positive(), 0.001);
        expectPass(positive(), Number.MAX_SAFE_INTEGER);
    });

    it('fails for zero', () => {
        expectFail(positive(), 0, 'must be positive');
    });

    it('fails for negative number', () => {
        expectFail(positive(), -1);
        expectFail(positive(), -0.001);
    });

    it('fails for non-number types', () => {
        expectFail(positive(), '5');
        expectFail(positive(), null);
        expectFail(positive(), undefined);
        expectFail(positive(), true);
    });

    it('does not reject NaN (typeof check passes, comparison yields false)', () => {
        expectPass(positive(), NaN);
    });

    it('passes for Infinity', () => {
        expectPass(positive(), Infinity);
    });

    it('fails for -Infinity', () => {
        expectFail(positive(), -Infinity);
    });

    it('uses custom error message', () => {
        expectFail(positive('Custom error'), 0, 'Custom error');
    });
});


// ─── negative ──────────────────────────────────────────────────────────────


describe('negative', () => {
    it('passes for negative number', () => {
        expectPass(negative(), -1);
        expectPass(negative(), -0.001);
        expectPass(negative(), Number.MIN_SAFE_INTEGER);
    });

    it('fails for zero', () => {
        expectFail(negative(), 0, 'must be negative');
    });

    it('fails for positive number', () => {
        expectFail(negative(), 1);
        expectFail(negative(), 0.001);
    });

    it('fails for non-number types', () => {
        expectFail(negative(), '-5');
        expectFail(negative(), null);
    });

    it('does not reject NaN (typeof check passes, comparison yields false)', () => {
        expectPass(negative(), NaN);
    });

    it('passes for -Infinity', () => {
        expectPass(negative(), -Infinity);
    });

    it('fails for Infinity', () => {
        expectFail(negative(), Infinity);
    });

    it('uses custom error message', () => {
        expectFail(negative('Custom error'), 0, 'Custom error');
    });
});


// ─── nonNegative ───────────────────────────────────────────────────────────


describe('nonNegative', () => {
    it('passes for positive number', () => {
        expectPass(nonNegative(), 1);
        expectPass(nonNegative(), 0.001);
    });

    it('passes for zero', () => {
        expectPass(nonNegative(), 0);
    });

    it('fails for negative number', () => {
        expectFail(nonNegative(), -1, 'must be non-negative');
        expectFail(nonNegative(), -0.001);
    });

    it('fails for non-number types', () => {
        expectFail(nonNegative(), '0');
        expectFail(nonNegative(), null);
    });

    it('does not reject NaN (typeof check passes, comparison yields false)', () => {
        expectPass(nonNegative(), NaN);
    });

    it('handles -0 as zero (passes)', () => {
        expectPass(nonNegative(), -0);
    });

    it('uses custom error message', () => {
        expectFail(nonNegative('Custom error'), -1, 'Custom error');
    });
});


// ─── nonPositive ───────────────────────────────────────────────────────────


describe('nonPositive', () => {
    it('passes for negative number', () => {
        expectPass(nonPositive(), -1);
        expectPass(nonPositive(), -0.001);
    });

    it('passes for zero', () => {
        expectPass(nonPositive(), 0);
    });

    it('fails for positive number', () => {
        expectFail(nonPositive(), 1, 'must be non-positive');
        expectFail(nonPositive(), 0.001);
    });

    it('fails for non-number types', () => {
        expectFail(nonPositive(), '0');
        expectFail(nonPositive(), null);
    });

    it('does not reject NaN (typeof check passes, comparison yields false)', () => {
        expectPass(nonPositive(), NaN);
    });

    it('handles -0 as zero (passes)', () => {
        expectPass(nonPositive(), -0);
    });

    it('uses custom error message', () => {
        expectFail(nonPositive('Custom error'), 1, 'Custom error');
    });
});


// ─── integer ───────────────────────────────────────────────────────────────


describe('integer', () => {
    it('passes for integer values', () => {
        expectPass(integer(), 0);
        expectPass(integer(), 1);
        expectPass(integer(), -1);
        expectPass(integer(), 42);
        expectPass(integer(), Number.MAX_SAFE_INTEGER);
    });

    it('fails for floating point values', () => {
        expectFail(integer(), 1.5, 'must be an integer');
        expectFail(integer(), 0.1);
        expectFail(integer(), -3.14);
    });

    it('fails for NaN', () => {
        expectFail(integer(), NaN);
    });

    it('fails for Infinity', () => {
        expectFail(integer(), Infinity);
        expectFail(integer(), -Infinity);
    });

    it('fails for non-number types', () => {
        expectFail(integer(), '42');
        expectFail(integer(), null);
        expectFail(integer(), true);
    });

    it('uses custom error message', () => {
        expectFail(integer('Custom error'), 1.5, 'Custom error');
    });
});


// ─── safeInteger ───────────────────────────────────────────────────────────


describe('safeInteger', () => {
    it('passes for safe integer values', () => {
        expectPass(safeInteger(), 0);
        expectPass(safeInteger(), 1);
        expectPass(safeInteger(), -1);
        expectPass(safeInteger(), Number.MAX_SAFE_INTEGER);
        expectPass(safeInteger(), Number.MIN_SAFE_INTEGER);
    });

    it('fails for unsafe integer values', () => {
        expectFail(safeInteger(), Number.MAX_SAFE_INTEGER + 1, 'must be a safe integer');
        expectFail(safeInteger(), Number.MIN_SAFE_INTEGER - 1);
    });

    it('fails for floating point values', () => {
        expectFail(safeInteger(), 1.5);
    });

    it('fails for NaN and Infinity', () => {
        expectFail(safeInteger(), NaN);
        expectFail(safeInteger(), Infinity);
    });

    it('fails for non-number types', () => {
        expectFail(safeInteger(), '42');
        expectFail(safeInteger(), null);
    });

    it('uses custom error message', () => {
        expectFail(safeInteger('Custom error'), 1.5, 'Custom error');
    });
});


// ─── finite ────────────────────────────────────────────────────────────────


describe('finite', () => {
    it('passes for finite numbers', () => {
        expectPass(finite(), 0);
        expectPass(finite(), 1);
        expectPass(finite(), -1);
        expectPass(finite(), 3.14);
        expectPass(finite(), Number.MAX_SAFE_INTEGER);
    });

    it('fails for Infinity', () => {
        expectFail(finite(), Infinity, 'must be finite');
        expectFail(finite(), -Infinity);
    });

    it('fails for NaN', () => {
        expectFail(finite(), NaN);
    });

    it('fails for non-number types', () => {
        expectFail(finite(), '0');
        expectFail(finite(), null);
        expectFail(finite(), true);
    });

    it('uses custom error message', () => {
        expectFail(finite('Custom error'), Infinity, 'Custom error');
    });
});


// ─── multipleOf ────────────────────────────────────────────────────────────


describe('multipleOf', () => {
    it('passes for exact multiples', () => {
        expectPass(multipleOf(3), 9);
        expectPass(multipleOf(3), 0);
        expectPass(multipleOf(3), -6);
        expectPass(multipleOf(5), 25);
    });

    it('fails for non-multiples', () => {
        expectFail(multipleOf(3), 10, 'must be a multiple of 3');
        expectFail(multipleOf(5), 7);
    });

    it('works with decimal multiples', () => {
        expectPass(multipleOf(0.5), 1.5);
        expectPass(multipleOf(0.5), 2);
    });

    it('fails for non-number types', () => {
        expectFail(multipleOf(3), '9');
        expectFail(multipleOf(3), null);
    });

    it('uses custom error message', () => {
        expectFail(multipleOf(3, 'custom'), 10, 'custom');
    });

    it('fails for NaN', () => {
        expectFail(multipleOf(3), NaN);
    });
});


// ─── BigInt support in min ─────────────────────────────────────────────────


describe('min (bigint)', () => {
    it('passes when bigint >= min', () => {
        let validator = min(5);

        expectPass(validator, 5n);
        expectPass(validator, 10n);
        expectPass(validator, 100n);
    });

    it('fails when bigint < min', () => {
        let validator = min(5);

        expectFail(validator, 3n, 'must be at least 5');
        expectFail(validator, 0n);
        expectFail(validator, -1n);
    });

    it('uses custom error message for bigint', () => {
        let validator = min(5, 'too small');

        expectFail(validator, 3n, 'too small');
    });

    it('existing number validation still works', () => {
        let validator = min(5);

        expectPass(validator, 5);
        expectPass(validator, 10);
        expectFail(validator, 3);
    });

    it('existing string validation still works', () => {
        let validator = min(3);

        expectPass(validator, 'abc');
        expectFail(validator, 'ab');
    });

    it('existing array validation still works', () => {
        let validator = min(2);

        expectPass(validator, [1, 2]);
        expectFail(validator, [1]);
    });
});


// ─── BigInt support in max ─────────────────────────────────────────────────


describe('max (bigint)', () => {
    it('passes when bigint <= max', () => {
        let validator = max(10);

        expectPass(validator, 10n);
        expectPass(validator, 5n);
        expectPass(validator, 0n);
        expectPass(validator, -1n);
    });

    it('fails when bigint > max', () => {
        let validator = max(10);

        expectFail(validator, 11n, 'must be at most 10');
        expectFail(validator, 100n);
    });

    it('uses custom error message for bigint', () => {
        let validator = max(10, 'too big');

        expectFail(validator, 11n, 'too big');
    });

    it('existing number validation still works', () => {
        let validator = max(10);

        expectPass(validator, 10);
        expectPass(validator, 5);
        expectFail(validator, 11);
    });

    it('existing string validation still works', () => {
        let validator = max(3);

        expectPass(validator, 'abc');
        expectFail(validator, 'abcd');
    });

    it('existing array validation still works', () => {
        let validator = max(2);

        expectPass(validator, [1, 2]);
        expectFail(validator, [1, 2, 3]);
    });
});


// ─── BigInt support in range ───────────────────────────────────────────────


describe('range (bigint)', () => {
    it('passes when bigint is within range', () => {
        let validator = range(5, 10);

        expectPass(validator, 5n);
        expectPass(validator, 7n);
        expectPass(validator, 10n);
    });

    it('fails when bigint is below range', () => {
        let validator = range(5, 10);

        expectFail(validator, 4n, 'must be between 5 and 10');
        expectFail(validator, 0n);
    });

    it('fails when bigint is above range', () => {
        let validator = range(5, 10);

        expectFail(validator, 11n, 'must be between 5 and 10');
        expectFail(validator, 100n);
    });

    it('uses custom error message for bigint', () => {
        let validator = range(5, 10, 'out of range');

        expectFail(validator, 4n, 'out of range');
    });

    it('existing number validation still works', () => {
        let validator = range(5, 10);

        expectPass(validator, 5);
        expectPass(validator, 7);
        expectPass(validator, 10);
        expectFail(validator, 4);
        expectFail(validator, 11);
    });

    it('existing string validation still works', () => {
        let validator = range(2, 4);

        expectPass(validator, 'abc');
        expectFail(validator, 'a');
        expectFail(validator, 'abcde');
    });

    it('existing array validation still works', () => {
        let validator = range(1, 3);

        expectPass(validator, [1, 2]);
        expectFail(validator, []);
        expectFail(validator, [1, 2, 3, 4]);
    });
});


// ─── date constraints ──────────────────────────────────────────────────────


describe('date.valid', () => {
    it('passes for valid date', () => {
        expectPass(date.valid(), new Date('2024-01-15'));
        expectPass(date.valid(), new Date());
    });

    it('fails for invalid date', () => {
        expectFail(date.valid(), new Date('invalid'), 'must be a valid date');
    });

    it('fails for non-date', () => {
        expectFail(date.valid(), '2024-01-15');
        expectFail(date.valid(), 1234567890);
        expectFail(date.valid(), null);
        expectFail(date.valid(), undefined);
    });

    it('uses custom error message', () => {
        expectFail(date.valid('Custom error'), new Date('invalid'), 'Custom error');
    });
});


describe('date.min', () => {
    let boundary = new Date('2024-06-01T00:00:00.000Z');

    it('passes for date on or after min', () => {
        expectPass(date.min(boundary), new Date('2024-06-01T00:00:00.000Z'));
        expectPass(date.min(boundary), new Date('2024-12-01'));
    });

    it('fails for date before min', () => {
        expectFail(date.min(boundary), new Date('2024-05-31T23:59:59.999Z'));
        expectFail(date.min(boundary), new Date('2020-01-01'));
    });

    it('fails for invalid date', () => {
        expectFail(date.min(boundary), new Date('invalid'));
    });

    it('fails for non-date', () => {
        expectFail(date.min(boundary), '2024-06-01');
    });

    it('uses custom error message', () => {
        expectFail(date.min(boundary, 'too early'), new Date('2020-01-01'), 'too early');
    });
});


describe('date.max', () => {
    let boundary = new Date('2024-06-01T00:00:00.000Z');

    it('passes for date on or before max', () => {
        expectPass(date.max(boundary), new Date('2024-06-01T00:00:00.000Z'));
        expectPass(date.max(boundary), new Date('2024-01-01'));
    });

    it('fails for date after max', () => {
        expectFail(date.max(boundary), new Date('2024-06-01T00:00:00.001Z'));
        expectFail(date.max(boundary), new Date('2025-01-01'));
    });

    it('fails for invalid date', () => {
        expectFail(date.max(boundary), new Date('invalid'));
    });

    it('fails for non-date', () => {
        expectFail(date.max(boundary), '2024-01-01');
    });

    it('uses custom error message', () => {
        expectFail(date.max(boundary, 'too late'), new Date('2025-01-01'), 'too late');
    });
});


describe('date.past', () => {
    it('passes for past date', () => {
        expectPass(date.past(), new Date('2000-01-01'));
        expectPass(date.past(), new Date(Date.now() - 10000));
    });

    it('fails for future date', () => {
        expectFail(date.past(), new Date(Date.now() + 100000), 'must be a past date');
    });

    it('fails for invalid date', () => {
        expectFail(date.past(), new Date('invalid'));
    });

    it('fails for non-date', () => {
        expectFail(date.past(), '2000-01-01');
        expectFail(date.past(), null);
    });

    it('uses custom error message', () => {
        expectFail(date.past('Custom error'), new Date(Date.now() + 100000), 'Custom error');
    });
});


describe('date.future', () => {
    it('passes for future date', () => {
        expectPass(date.future(), new Date(Date.now() + 100000));
        expectPass(date.future(), new Date('2099-01-01'));
    });

    it('fails for past date', () => {
        expectFail(date.future(), new Date('2000-01-01'), 'must be a future date');
        expectFail(date.future(), new Date(Date.now() - 10000));
    });

    it('fails for invalid date', () => {
        expectFail(date.future(), new Date('invalid'));
    });

    it('fails for non-date', () => {
        expectFail(date.future(), '2099-01-01');
        expectFail(date.future(), null);
    });

    it('uses custom error message', () => {
        expectFail(date.future('Custom error'), new Date('2000-01-01'), 'Custom error');
    });
});


// ─── unique ────────────────────────────────────────────────────────────────


describe('unique', () => {
    it('passes for array with unique items', () => {
        expectPass(unique(), [1, 2, 3]);
        expectPass(unique(), ['a', 'b', 'c']);
        expectPass(unique(), [1, 'a', true, null]);
    });

    it('passes for empty array', () => {
        expectPass(unique(), []);
    });

    it('passes for single-element array', () => {
        expectPass(unique(), [42]);
    });

    it('fails for array with duplicate numbers', () => {
        expectFail(unique(), [1, 2, 3, 2], 'must contain unique items');
    });

    it('fails for array with duplicate strings', () => {
        expectFail(unique(), ['a', 'b', 'a']);
    });

    it('fails for array with duplicate null', () => {
        expectFail(unique(), [null, 1, null]);
    });

    it('fails for array with duplicate undefined', () => {
        expectFail(unique(), [undefined, 1, undefined]);
    });

    it('does not treat objects as duplicates (reference equality)', () => {
        let a = { x: 1 },
            b = { x: 1 };

        expectPass(unique(), [a, b]);
    });

    it('fails for duplicate object references', () => {
        let a = { x: 1 };

        expectFail(unique(), [a, a]);
    });

    it('fails for non-array', () => {
        expectFail(unique(), 'hello', 'must be an array');
        expectFail(unique(), 42);
        expectFail(unique(), null);
        expectFail(unique(), undefined);
        expectFail(unique(), { length: 3 });
    });

    it('uses custom error message', () => {
        expectFail(unique('Custom error'), [1, 1], 'Custom error');
        expectFail(unique('Custom error'), 'not-array', 'Custom error');
    });
});
