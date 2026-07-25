import { describe, expect, it } from 'vitest';
import { max, min } from '../../src/validators';
import { transformCode } from '../utils';


type Result = { data: unknown; errors?: Array<{ message: string; path: string }>; ok: boolean };

type Validator = (input: unknown) => Result | Promise<Result>;


// The generated validator references module-level hoisted consts (`const v_… = min(…)`)
// that `createValidator` in test/utils.ts strips away, so config suites execute the FULL
// emitted module: drop the TS-only import/type lines, inject the config factories the
// hoisted consts call, and return the assigned `validate` binding.
function build(source: string, injected: Record<string, unknown> = {}): Validator {
    let body = transformCode(source)
            .split('\n')
            .filter((line) => !/^\s*import\b/.test(line) && !/^\s*type\b/.test(line))
            .join('\n'),
        keys = Object.keys(injected);

    // eslint-disable-next-line no-new-func
    return new Function(...keys, `${body}\nreturn validate.validate;`)(...keys.map((key) => injected[key])) as Validator;
}

function messages(result: Result): string[] {
    return (result.errors ?? []).map((error) => error.message);
}


describe('validator.build config pipeline', () => {
    describe('single-fn config', () => {
        it('rejects short input with the custom message (the dead-config repro now fails)', () => {
            let validate = build(
                `type User = { name: string };
                 const validate = validator.build<User>({ name: min(5, 'too short') });`,
                { min }
            );

            let invalid = validate({ name: 'ab' }) as Result;

            expect(invalid.ok).toBe(false);
            expect(invalid.errors).toEqual([{ message: 'too short', path: 'name' }]);
        });

        it('accepts input that satisfies the configured validator', () => {
            let validate = build(
                `type User = { name: string };
                 const validate = validator.build<User>({ name: min(5, 'too short') });`,
                { min }
            );

            let valid = validate({ name: 'abcdef' }) as Result;

            expect(valid.ok).toBe(true);
            expect(valid.data).toEqual({ name: 'abcdef' });
        });

        it('does not run the config validator when the structural check already failed', () => {
            let validate = build(
                `type User = { name: string };
                 const validate = validator.build<User>({ name: min(5, 'too short') });`,
                { min }
            );

            let invalid = validate({ name: 123 }) as Result;

            expect(invalid.ok).toBe(false);
            expect(messages(invalid)).toEqual(['must be a string']);
        });
    });

    describe('array config', () => {
        it('runs the factory validators and reports the one that fails', () => {
            let validate = build(
                `type User = { name: string };
                 const validate = validator.build<User>({ name: [min(2, 'too short'), max(4, 'too long')] });`,
                { max, min }
            );

            expect(messages(validate({ name: 'a' }) as Result)).toEqual(['too short']);
            expect(messages(validate({ name: 'abcdef' }) as Result)).toEqual(['too long']);
            expect((validate({ name: 'abc' }) as Result).ok).toBe(true);
        });

        it('invokes every validator in declaration order', () => {
            let validate = build(
                `type User = { name: string };
                 const validate = validator.build<User>({ name: [(value, errors) => errors.push('first'), (value, errors) => errors.push('second')] });`
            );

            let result = validate({ name: 'x' }) as Result;

            expect(result.ok).toBe(false);
            expect(messages(result)).toEqual(['first', 'second']);
        });
    });

    describe('inline arrow config', () => {
        it('pushes its error attributed to the property path', () => {
            let validate = build(
                `type User = { email: string };
                 const validate = validator.build<User>({ email: (value, errors) => { if (!value.includes('@')) errors.push('bad email'); } });`
            );

            let invalid = validate({ email: 'nope' }) as Result;

            expect(invalid.ok).toBe(false);
            expect(invalid.errors).toEqual([{ message: 'bad email', path: 'email' }]);
            expect((validate({ email: 'a@b.com' }) as Result).ok).toBe(true);
        });
    });

    describe('async arrow config', () => {
        it('yields an async validator that awaits and fails', async () => {
            let source = `type User = { email: string };
                 const validate = validator.build<User>({ email: async (value, errors) => { let taken = await check(value); if (taken) errors.push('taken'); } });`,
                validate = build(source, { check: async (value: unknown) => value === 'dup@x.com' });

            expect(transformCode(source)).toContain('async (_input)');

            let pending = validate({ email: 'dup@x.com' });

            expect(pending).toBeInstanceOf(Promise);

            let invalid = await pending;

            expect(invalid.ok).toBe(false);
            expect(invalid.errors).toEqual([{ message: 'taken', path: 'email' }]);

            let valid = await validate({ email: 'new@x.com' });

            expect(valid.ok).toBe(true);
        });
    });

    describe('module-eval semantics', () => {
        it('calls each config factory exactly once, at module eval and never per validation', () => {
            let calls = 0,
                counted = (...args: unknown[]) => {
                    calls++;

                    return (min as (...a: unknown[]) => unknown)(...args);
                };

            let validate = build(
                `type User = { name: string };
                 const validate = validator.build<User>({ name: counted(3, 'short') });`,
                { counted }
            );

            expect(calls).toBe(1);

            validate({ name: 'ab' });
            validate({ name: 'abcd' });

            expect(calls).toBe(1);
        });
    });

    describe('async derivation from config AST, not regex', () => {
        it('emits a NON-async validator when config text merely mentions await', () => {
            let code = transformCode(
                `type User = { name: string };
                 const validate = validator.build<User>({ name: min(5, 'await your turn') });`
            );

            expect(code).not.toContain('async (_input)');
        });

        it('emits a NON-async validator for a config-free build', () => {
            let code = transformCode(
                `type User = { name: string };
                 validator.build<User>();`
            );

            expect(code).not.toContain('async');
        });
    });
});
