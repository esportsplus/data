// Proof-of-fix spec for the compiler findings H5, H6, H7 and M9.
//
// The companion audit file (test/audit/compiler.test.ts) asserts the pre-fix buggy
// behaviour and is expected to fail once these fixes land. This file asserts the
// CORRECTED behaviour: unsupported config forms fail the build loudly, shorthand and
// computed-literal keys work, async validators are awaited, brand bodies stay contained,
// scope/TDZ-breaking hoists are refused, the build dedup cache is keyed on type identity,
// `never`/template-literal/bigint-literal types validate exactly, and plugin detection
// resolves the real package binding rather than duck typing / name coincidence.

import { describe, expect, it } from 'vitest';

import sbcPlugin from '../../../src/compiler/sbc';
import { createValidator, evaluateModule, transformCode, transformRaw, transformWith } from '../../utils';


type Result = { data: unknown; errors?: Array<{ message: string; path: string }>; ok: boolean };

type Validate = (input: unknown) => Result | Promise<Result>;


const BUILD_VALIDATE = 'validate.validate';


describe('H5 — validator config is not silently dropped and async is detected by type', () => {
    it('rejects a non-object-literal config with a clear compile error', () => {
        expect(() => transformCode(`
            type User = { name: string };
            const cfg = { name: (value, errors) => { errors.push('from variable'); } };
            validator.build<User>(cfg);
        `)).toThrow(/inline object literal/);
    });

    it('rejects a spread config entry instead of dropping it', () => {
        expect(() => transformCode(`
            type User = { name: string };
            const extra = { name: (value, errors) => { errors.push('spread ran'); } };
            validator.build<User>({ ...extra });
        `)).toThrow(/spread/i);
    });

    it('runs a shorthand property entry', () => {
        let validate = evaluateModule(`
            type User = { name: string };
            const name = (value, errors) => { errors.push('shorthand ran'); };
            export const validate = validator.build<User>({ name });
        `, {}, BUILD_VALIDATE) as Validate;

        let result = validate({ name: 'x' }) as Result;

        expect(result.ok).toBe(false);
        expect(result.errors).toEqual([{ message: 'shorthand ran', path: 'name' }]);
    });

    it('runs a statically-computed property entry', () => {
        let validate = evaluateModule(`
            type User = { name: string };
            const check = (value, errors) => { errors.push('computed ran'); };
            export const validate = validator.build<User>({ ['name']: check });
        `, {}, BUILD_VALIDATE) as Validate;

        let result = validate({ name: 'x' }) as Result;

        expect(result.ok).toBe(false);
        expect(result.errors).toEqual([{ message: 'computed ran', path: 'name' }]);
    });

    it('rejects a dynamically-computed property key instead of dropping it', () => {
        expect(() => transformCode(`
            type User = { name: string };
            const k = 'name';
            const check = (value, errors) => { errors.push('dynamic ran'); };
            validator.build<User>({ [k]: check });
        `)).toThrow(/computed key/);
    });

    it('detects and awaits an async validator held in an identifier', async () => {
        let source = `
            type User = { name: string };
            async function asyncCheck(value, errors) {
                await Promise.resolve();
                if (value === 'bad') { errors.push('async bad'); }
            }
            export const validate = validator.build<User>({ name: asyncCheck });
        `;

        expect(transformCode(source)).toContain('async (_input)');

        let validate = evaluateModule(source, {}, BUILD_VALIDATE) as Validate,
            pending = validate({ name: 'bad' });

        expect(pending).toBeInstanceOf(Promise);

        let result = await pending;

        expect(result.ok).toBe(false);
        expect(result.errors).toEqual([{ message: 'async bad', path: 'name' }]);
    });
});


describe('H6 — scope/control-flow and dedup safety', () => {
    it('contains a bare return in a brand body (does not escape the validator)', () => {
        let source = `
            type Brand<T, B extends string> = T & { __brand: B };
            type Slug = Brand<string, 'slug'>;
            type ErrorType = { push(message: string): void };
            type Post = { slug: Slug };
            validator.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('too short'); return; } });
            export const validate = validator.build<Post>();
        `,
            validate = evaluateModule(source, {}, BUILD_VALIDATE) as Validate,
            result = validate({ slug: 'ab' }) as Result;

        expect(result).toBeDefined();
        expect(result.ok).toBe(false);
        expect(result.errors).toEqual([{ message: 'too short', path: 'slug' }]);

        expect((validate({ slug: 'abcd' }) as Result).ok).toBe(true);
    });

    it('preserves the value when a brand body returns early without an error', () => {
        let validate = createValidator(`
            type Brand<T, B extends string> = T & { __brand: B };
            type Slug = Brand<string, 'slug'>;
            type ErrorType = { push(message: string): void };
            type Post = { slug: Slug };
            validator.set((value: Slug, errors: ErrorType) => { if (value === 'skip') { return; } if (value.length < 3) { errors.push('too short'); } });
            validator.build<Post>();
        `),
            result = validate({ slug: 'skip' });

        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ slug: 'skip' });
    });

    it('persists a value reassignment made by a brand body', () => {
        let validate = createValidator(`
            type Brand<T, B extends string> = T & { __brand: B };
            type Slug = Brand<string, 'slug'>;
            type ErrorType = { push(message: string): void };
            type Post = { slug: Slug };
            validator.set((value: Slug, errors: ErrorType) => { value = value.trim(); });
            validator.build<Post>();
        `),
            result = validate({ slug: '  padded  ' });

        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ slug: 'padded' });
    });

    it('refuses a config that captures a function-local binding', () => {
        expect(() => transformCode(`
            type User = { name: string };
            const validate = (() => {
                const minLen = 5;
                return validator.build<User>({ name: min(minLen, 'too short') });
            })();
        `)).toThrow(/function-local/);
    });

    it('refuses a config that references a later lexical declaration (TDZ)', () => {
        expect(() => transformCode(`
            type User = { name: string };
            export const built = validator.build<User>({ name: min(LIMIT, 'too short') });
            const LIMIT = 5;
        `)).toThrow(/before its initialization/);
    });

    it('keeps two same-named local aliases of different shapes distinct', () => {
        let built = evaluateModule(`
            function f() {
                type User = { a: string };
                return validator.build<User>();
            }
            function g() {
                type User = { b: number };
                return validator.build<User>();
            }
            export const validateF = f();
            export const validateG = g();
        `, {}, '({ f: validateF.validate, g: validateG.validate })') as { f: Validate; g: Validate };

        expect(built.f).not.toBe(built.g);

        expect((built.g({ b: 1 }) as Result).ok).toBe(true);
        expect((built.g({ a: 'x' }) as Result).ok).toBe(false);
        expect((built.f({ a: 'x' }) as Result).ok).toBe(true);
        expect((built.f({ b: 1 }) as Result).ok).toBe(false);
    });
});


describe('H7 — validators are no wider than the declared type', () => {
    it('rejects any input for a root never type', () => {
        let validate = createValidator('validator.build<never>();');

        expect(validate(123).ok).toBe(false);
        expect(validate(null).ok).toBe(false);
        expect(validate(undefined).ok).toBe(false);
    });

    it('rejects a required never property', () => {
        let validate = createValidator(`
            type Data = { bad: never; name: string };
            validator.build<Data>();
        `);

        expect(validate({ bad: 'anything at all', name: 'x' }).ok).toBe(false);
        expect(validate({ name: 'x' }).ok).toBe(false);
    });

    it('accepts an absent optional never property and rejects a present one', () => {
        let validate = createValidator(`
            type Data = { bad?: never; name: string };
            validator.build<Data>();
        `);

        expect(validate({ name: 'x' }).ok).toBe(true);
        expect(validate({ bad: 'anything', name: 'x' }).ok).toBe(false);
    });

    it('validates a template-literal type against its pattern', () => {
        let validate = createValidator(`
            type T = \`\${number}px\`;
            type Data = { v: T };
            validator.build<Data>();
        `);

        expect(validate({ v: '12px' }).ok).toBe(true);
        expect(validate({ v: 'not-a-px' }).ok).toBe(false);
        expect(validate({ v: 12 }).ok).toBe(false);
    });

    it('validates a template with multiple string spans', () => {
        let validate = createValidator(`
            type Email = \`\${string}@\${string}\`;
            type Data = { email: Email };
            validator.build<Data>();
        `);

        expect(validate({ email: 'a@b.com' }).ok).toBe(true);
        expect(validate({ email: 'no-at-sign' }).ok).toBe(false);
    });

    it('enforces the exact value of a bigint literal', () => {
        let validate = createValidator(`
            type Data = { v: 10n };
            validator.build<Data>();
        `);

        expect(validate({ v: 10n }).ok).toBe(true);
        expect(validate({ v: 40n }).ok).toBe(false);
        expect(validate({ v: 10 }).ok).toBe(false);
    });

    it('enforces each value of a bigint literal union', () => {
        let validate = createValidator(`
            type Data = { v: 10n | 20n };
            validator.build<Data>();
        `);

        expect(validate({ v: 10n }).ok).toBe(true);
        expect(validate({ v: 20n }).ok).toBe(true);
        expect(validate({ v: 30n }).ok).toBe(false);
    });
});


describe('M9 — plugin detection resolves the real package binding', () => {
    it('does not transform an unrelated receiver that merely has defineSchema', () => {
        let transformed = transformWith([sbcPlugin], `
            type NotACodec = {
                defineSchema(fields: { name: string; type: string }[]): number;
                encode<T>(value: T): Uint8Array;
            };
            declare const thing: NotACodec;
            declare const obj: { name: string };
            thing.encode<{ name: string }>(obj);
        `);

        expect(transformed).not.toContain('"schema"');
    });

    it('transforms a receiver derived from the imported codec factory', () => {
        let transformed = transformWith([sbcPlugin], `
            import { codec as codecFactory } from '@esportsplus/data';
            type Data = { name: string };
            const codec = codecFactory();
            declare let d: Data;
            codec.encode<Data>(d);
        `);

        expect(transformed).toContain('"schema"');
    });

    it('does not register a brand from a shadowing local that shares the imported alias', () => {
        // The shadow never registers, so the brand is left without a registration at all
        expect(() => createValidator(`
            type Brand<T, B extends string> = T & { __brand: B };
            type Slug = Brand<string, 'slug'>;
            type ErrorType = { push(message: string): void };
            type Post = { slug: Slug };
            function unrelated() {
                const validator = { set(cb: unknown) { return cb; } };
                validator.set((value: Slug, errors: ErrorType) => { errors.push('shadow brand'); });
            }
            validator.build<Post>();
        `)).toThrow(/brand 'slug' .* has no validator\.set\(\) registration/);
    });

    it('still registers a brand from the real imported alias', () => {
        let transformed = transformRaw(`
            import { validator as v } from '@esportsplus/data';
            type Brand<T, B extends string> = T & { __brand: B };
            type Slug = Brand<string, 'slug'>;
            type ErrorType = { push(message: string): void };
            type Post = { slug: Slug };
            v.set((value: Slug, errors: ErrorType) => { if (value.length < 3) { errors.push('real brand'); } });
            v.build<Post>();
        `);

        expect(transformed).toContain('real brand');
    });
});
