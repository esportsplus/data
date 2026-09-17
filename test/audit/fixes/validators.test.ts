/**
 * Proof-of-fix for audit findings M6a-d (src/validators/*).
 *
 * Unlike test/audit/validators-jsonschema.test.ts (which asserts the pre-fix,
 * buggy behavior and is expected to fail now), these tests assert the CORRECTED
 * behavior introduced in:
 *   M6a src/validators/multiple-of.ts
 *   M6b src/validators/iso.ts
 *   M6c src/validators/url.ts
 *   M6d src/validators/date-string.ts
 */
import { describe, expect, it } from 'vitest';

import { dateString, iso, multipleOf, url } from '../../../src/validators';


type Errors = { push(message: string): void };
type Validator = (value: unknown, errors: Errors) => unknown;

function run(validator: Validator, value: unknown): string[] {
    let errors: string[] = [];

    validator(value, { push: (m) => errors.push(m) });

    return errors;
}


// ─── M6a — multipleOf exponential-notation steps ────────────────────────────

describe('M6a fix — multipleOf handles exponent-notation steps', () => {
    it('accepts 2e-7 as a multiple of 1e-7', () => {
        expect(run(multipleOf(1e-7), 2e-7)).toEqual([]);
    });

    it('accepts other exact multiples of an exponent-notation step', () => {
        expect(run(multipleOf(1e-7), 3e-7)).toEqual([]);
        expect(run(multipleOf(1e-7), 1e-6)).toEqual([]);
        expect(run(multipleOf(1e-7), 0)).toEqual([]);
        expect(run(multipleOf(1.5e-7), 3e-7)).toEqual([]);
    });

    it('still rejects genuine non-multiples of an exponent-notation step', () => {
        expect(run(multipleOf(1e-7), 2.5e-7)).toEqual(['must be a multiple of 1e-7']);
        expect(run(multipleOf(1e-7), 1.5e-7)).toEqual(['must be a multiple of 1e-7']);
    });

    it('does not regress plain decimal steps (float-precision false-negatives)', () => {
        expect(run(multipleOf(0.1), 0.3)).toEqual([]);
        expect(run(multipleOf(0.1), 0.7)).toEqual([]);
        expect(run(multipleOf(0.1), 0.35)).toEqual(['must be a multiple of 0.1']);
        expect(run(multipleOf(0.5), 1.5)).toEqual([]);
        expect(run(multipleOf(0.5), 2)).toEqual([]);
    });
});


// ─── M6b — iso.dateTime calendar validation ─────────────────────────────────

describe('M6b fix — iso.dateTime rejects impossible calendar dates', () => {
    it('rejects February 31', () => {
        expect(run(iso.dateTime(), '2024-02-31T12:00:00')).toEqual(['must be a valid ISO date-time']);
    });

    it('rejects Feb 29 in a non-leap year', () => {
        expect(run(iso.dateTime(), '2023-02-29T00:00:00')).toEqual(['must be a valid ISO date-time']);
    });

    it('rejects a 31st in a 30-day month', () => {
        expect(run(iso.dateTime(), '2024-04-31T00:00:00')).toEqual(['must be a valid ISO date-time']);
        expect(run(iso.dateTime(), '2024-06-31T23:59:59.999')).toEqual(['must be a valid ISO date-time']);
    });

    it('keeps valid date-times passing', () => {
        expect(run(iso.dateTime(), '2024-01-15T14:30:00')).toEqual([]);
        expect(run(iso.dateTime(), '2024-01-15T14:30:00.123')).toEqual([]);
        expect(run(iso.dateTime(), '2024-02-29T12:00:00')).toEqual([]);
        expect(run(iso.dateTime(), '2023-02-28T23:59:59')).toEqual([]);
    });

    it('still rejects malformed date-times and non-strings', () => {
        expect(run(iso.dateTime(), '2024-01-15 14:30:00')).toEqual(['must be a valid ISO date-time']);
        expect(run(iso.dateTime(), 123)).toEqual(['must be a valid ISO date-time']);
    });
});


// ─── M6c — url.https requires a host ────────────────────────────────────────

describe('M6c fix — url.https requires a real host', () => {
    it('rejects host-less https URLs', () => {
        expect(run(url.https(), 'https://?')).toEqual(['must be a valid HTTPS URL']);
        expect(run(url.https(), 'https:///')).toEqual(['must be a valid HTTPS URL']);
        expect(run(url.https(), 'https://')).toEqual(['must be a valid HTTPS URL']);
    });

    it('keeps valid https URLs passing', () => {
        expect(run(url.https(), 'https://example.com')).toEqual([]);
        expect(run(url.https(), 'https://example.com/')).toEqual([]);
        expect(run(url.https(), 'https://sub.example.com/path?q=1#frag')).toEqual([]);
        expect(run(url.https(), 'https://user:pass@example.com:8443/x')).toEqual([]);
        expect(run(url.https(), 'https://[2001:db8::1]:443/')).toEqual([]);
    });

    it('still rejects http, malformed values, and non-strings', () => {
        expect(run(url.https(), 'http://example.com')).toEqual(['must be a valid HTTPS URL']);
        expect(run(url.https(), 'https://example.com/a b')).toEqual(['must be a valid HTTPS URL']);
        expect(run(url.https(), 123)).toEqual(['must be a valid HTTPS URL']);
    });
});


// ─── M6d — dateString small years ───────────────────────────────────────────

describe('M6d fix — dateString accepts four-digit small years', () => {
    it('accepts 0099-01-01', () => {
        expect(run(dateString(), '0099-01-01')).toEqual([]);
    });

    it('accepts other small years and the year 0000', () => {
        expect(run(dateString(), '0000-01-01')).toEqual([]);
        expect(run(dateString(), '0001-12-31')).toEqual([]);
        expect(run(dateString(), '0099-01-01T10:30:00Z')).toEqual([]);
    });

    it('keeps ordinary years passing', () => {
        expect(run(dateString(), '1999-01-01')).toEqual([]);
        expect(run(dateString(), '2024-02-29')).toEqual([]);
    });

    it('still rejects genuinely invalid date strings', () => {
        expect(run(dateString(), '2024-02-30')).toEqual(['must be a valid date string']);
        expect(run(dateString(), '2024-04-31')).toEqual(['must be a valid date string']);
        expect(run(dateString(), '0099-02-30')).toEqual(['must be a valid date string']);
        expect(run(dateString(), '2023-02-29')).toEqual(['must be a valid date string']);
        expect(run(dateString(), '2024-13-01')).toEqual(['must be a valid date string']);
        expect(run(dateString(), 'not-a-date')).toEqual(['must be a valid date string']);
        expect(run(dateString(), 123)).toEqual(['must be a valid date string']);
    });
});
