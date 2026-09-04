import { describe, expect, it } from 'vitest';
import { email, fn, min, uuid, words } from '../../src/validators';
import { trim } from '../../src/transformers';
import type { ErrorType } from '../../src/types';


function collect(validator: (value: unknown, errors: ErrorType) => void, value: unknown): string[] {
    let errors: string[] = [];

    validator(value, { push: (message) => errors.push(message) });

    return errors;
}


describe('annotate no-op chains', () => {
    it('describe/default/meta return the same function identity', () => {
        let base = min(2, 'msg'),
            described = base.describe('display name'),
            defaulted = described.default('anon'),
            metaed = defaulted.meta({ ui: 'input' });

        expect(described).toBe(base);
        expect(defaulted).toBe(base);
        expect(metaed).toBe(base);
    });

    it('validates identically to the bare builtin (twin-run)', () => {
        let bare = min(2, 'too short'),
            chained = min(2, 'too short').describe('x').default('y').meta({ k: 1 });

        for (let value of ['a', 'ab', 'abc', 5, 1, [1], [1, 2, 3]]) {
            expect(collect(chained, value)).toEqual(collect(bare, value));
        }
    });

    it('chains on property-bag sub-variants', () => {
        let base = email.html5('bad'),
            chained = base.describe('x').default('z'),
            twin = email.html5('bad');

        expect(chained).toBe(base);

        for (let value of ['a@b.com', 'nope', 42]) {
            expect(collect(chained, value)).toEqual(collect(twin, value));
        }
    });

    it('wraps trim/uuid/words sub-variants into chainable no-ops', () => {
        expect(typeof trim.start().describe('x')).toBe('function');
        expect(typeof uuid.v4().default('id')).toBe('function');
        expect(typeof words.min(2).meta({ n: 1 })).toBe('function');
    });

    it('fn wraps a user arrow into a chainable no-op', () => {
        let validator = fn((_value, _errors) => {}).describe('x').default('anon');

        expect(collect(validator, 'anything')).toEqual([]);
    });
});


describe('annotate type-level assertions', () => {
    it('rejects a bare arrow chain and a mistyped default at compile time', () => {
        if (false as boolean) {
            // @ts-expect-error — a bare arrow has no chain methods (TS2339)
            ((_value: unknown, _errors: ErrorType) => {}).describe('x');

            // @ts-expect-error — default must match the validator's type
            fn<string>((_value, _errors) => {}).default(123);
        }

        expect(true).toBe(true);
    });
});
