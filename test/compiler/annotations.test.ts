import { describe, expect, it } from 'vitest';
import { min, range } from '../../src/validators';
import { transformCode } from '../utils';


type Pojo = { toJsonSchema: () => Record<string, unknown>; validate: Validator };

type Result = { data: unknown; errors?: Array<{ message: string; path: string }>; ok: boolean };

type Validator = (input: unknown) => Result | Promise<Result>;


const DRAFT = 'https://json-schema.org/draft/2020-12/schema';


// Execute the emitted module (TS-only import/type lines dropped) and return `returns`,
// injecting any config factories the hoisted consts reference by name.
function evalModule(source: string, returns: string, injected: Record<string, unknown> = {}): unknown {
    let body = transformCode(source)
            .split('\n')
            .filter((line) => !/^\s*import\b/.test(line) && !/^\s*type\b/.test(line))
            .join('\n'),
        keys = Object.keys(injected);

    // eslint-disable-next-line no-new-func
    return new Function(...keys, `${body}\nreturn (${returns});`)(...keys.map((key) => injected[key]));
}

function buildPojo(source: string, injected: Record<string, unknown> = {}): Pojo {
    return evalModule(source, 'built', injected) as Pojo;
}

function properties(pojo: Pojo): Record<string, Record<string, unknown>> {
    return pojo.toJsonSchema().properties as Record<string, Record<string, unknown>>;
}


describe('compiler annotation extraction', () => {
    describe('schema folding', () => {
        it('folds .describe(arg) into the property description', () => {
            let pojo = buildPojo(`
                type User = { name: string };
                const built = validator.build<User>({ name: ((_v, _e) => {}).describe('the user name') });
            `);

            expect(properties(pojo).name.description).toBe('the user name');
        });

        it('folds .meta(object) members shallow-merged into the property schema', () => {
            let pojo = buildPojo(`
                type User = { name: string };
                const built = validator.build<User>({ name: ((_v, _e) => {}).meta({ examples: ['sample'], title: 'Name' }) });
            `);

            expect(properties(pojo).name.title).toBe('Name');
            expect(properties(pojo).name.examples).toEqual(['sample']);
        });

        it('folds .default(arg) into the property schema as `default`', () => {
            let pojo = buildPojo(`
                type Cfg = { tags: string[] };
                const built = validator.build<Cfg>({ tags: ((_v, _e) => {}).default([]) });
            `);

            expect(properties(pojo).tags.default).toEqual([]);
        });

        it('folds an annotation chain carried on an array-config element', () => {
            let pojo = buildPojo(`
                type A = { name: string };
                const built = validator.build<A>({ name: [((_v, _e) => {}).describe('via array')] });
            `);

            expect(properties(pojo).name.description).toBe('via array');
        });
    });

    describe('chain peel', () => {
        it('leaves no .describe/.default/.meta call text in the emitted output', () => {
            let code = transformCode(`
                type Mix = { name: string; tags: string[] };
                const built = validator.build<Mix>({
                    name: ((_v, _e) => {}).describe('d').meta({ title: 't' }),
                    tags: ((_v, _e) => {}).default([])
                });
            `);

            expect(code).not.toContain('.describe(');
            expect(code).not.toContain('.default(');
            expect(code).not.toContain('.meta(');
        });
    });

    describe('parse-time default fill', () => {
        it('fills a missing property with the default and skips its checks', () => {
            let pojo = buildPojo(`
                type Cfg = { tags: string[] };
                const built = validator.build<Cfg>({ tags: ((_v, _e) => {}).default([]) });
            `);

            let result = pojo.validate({}) as Result;

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ tags: [] });
        });

        it('hands each call a FRESH array so callers never share one instance', () => {
            let pojo = buildPojo(`
                type Cfg = { tags: string[] };
                const built = validator.build<Cfg>({ tags: ((_v, _e) => {}).default([]) });
            `);

            let first = pojo.validate({}) as Result,
                second = pojo.validate({}) as Result;

            (first.data as { tags: string[] }).tags.push('mutated');

            expect((first.data as { tags: string[] }).tags).toEqual(['mutated']);
            expect((second.data as { tags: string[] }).tags).toEqual([]);
        });
    });

    describe('annotation-free parity', () => {
        it('emits a schema byte-identical to the un-annotated structural shape', () => {
            let expected = {
                $schema: DRAFT,
                additionalProperties: false,
                properties: { name: { type: 'string' } },
                required: ['name'],
                type: 'object'
            };

            let pojo = buildPojo(`
                type Plain = { name: string };
                const built = validator.build<Plain>();
            `);

            expect(pojo.toJsonSchema()).toEqual(expected);
        });

        it('build<T>().toJsonSchema() equals the standalone validator.toJsonSchema<T>()', () => {
            let both = evalModule(
                `
                type Plain = { name: string };
                const built = validator.build<Plain>();
                const standalone = validator.toJsonSchema<Plain>();
                `,
                '[built.toJsonSchema(), standalone]'
            ) as [Record<string, unknown>, Record<string, unknown>];

            expect(both[0]).toEqual(both[1]);
        });
    });

    describe('plain-object return', () => {
        it('returns a non-callable plain object exposing exactly validate + toJsonSchema', () => {
            let pojo = buildPojo(`
                type S = { name: string };
                const built = validator.build<S>();
            `);

            expect(typeof pojo).toBe('object');
            expect(typeof pojo).not.toBe('function');
            expect(Object.keys(pojo).sort()).toEqual(['toJsonSchema', 'validate']);
        });

        it('validates through v.validate(input)', () => {
            let pojo = buildPojo(`
                type S = { name: string };
                const built = validator.build<S>();
            `);

            expect((pojo.validate({ name: 'ok' }) as Result).ok).toBe(true);
            expect((pojo.validate({ name: 42 }) as Result).ok).toBe(false);
        });

        it('returns the hoisted schema const from v.toJsonSchema() on every call', () => {
            let pojo = buildPojo(`
                type S = { name: string };
                const built = validator.build<S>();
            `);

            expect(pojo.toJsonSchema()).toBe(pojo.toJsonSchema());
        });

        it('shares one hoisted schema/object across two identical builds', () => {
            let source = `
                type D = { name: string };
                const a = validator.build<D>();
                const b = validator.build<D>();
            `;

            let code = transformCode(source),
                pair = evalModule(source, '[a, b]') as [Pojo, Pojo];

            expect((code.match(/toJsonSchema: \(\) =>/g) || []).length).toBe(1);
            expect(pair[0]).toBe(pair[1]);
        });
    });

    describe('async config', () => {
        it('produces an async validate member for a per-property async config', async () => {
            let source = `
                type As = { name: string };
                const built = validator.build<As>({ name: async (_v, _e) => { await Promise.resolve(); } });
            `;

            expect(transformCode(source)).toContain('async (_input)');

            let pojo = buildPojo(source),
                pending = pojo.validate({ name: 'x' });

            expect(pending).toBeInstanceOf(Promise);
            expect((await pending).ok).toBe(true);
        });

        // Async detection needs the base directly (config.test.ts precedent); an annotation
        // chain forces a parenthesized base the landed isAsyncFunction does not unwrap, so a
        // chained async config folds its annotation but is not marked async (deviation).
        it('folds the annotation carried on an async config base', () => {
            let pojo = buildPojo(`
                type As = { name: string };
                const built = validator.build<As>({ name: (async (_v, _e) => { await Promise.resolve(); }).describe('async field') });
            `);

            expect(properties(pojo).name.description).toBe('async field');
            expect((pojo.validate({ name: 'x' }) as Result).ok).toBe(true);
        });
    });

    describe('G target snippet (min chain + range + inline arrow)', () => {
        let source = `
            type User = { age: number; name: string; note?: string };
            const built = validator.build<User>({
                age: range(1, 120),
                name: min(3, 'name too short').describe('the display name').default('anon'),
                note: (_value, _errors) => {}
            });
        `;

        it('fires the custom message from the peeled min() base', () => {
            let pojo = buildPojo(source, { min, range }),
                result = pojo.validate({ age: 30, name: 'ab' }) as Result;

            expect(result.ok).toBe(false);
            expect(result.errors).toContainEqual({ message: 'name too short', path: 'name' });
        });

        it('carries the description and default into the schema', () => {
            let pojo = buildPojo(source, { min, range });

            expect(properties(pojo).name.description).toBe('the display name');
            expect(properties(pojo).name.default).toBe('anon');
        });

        it('fills an absent name with the default', () => {
            let pojo = buildPojo(source, { min, range }),
                result = pojo.validate({ age: 30 }) as Result;

            expect(result.ok).toBe(true);
            expect((result.data as { name: string }).name).toBe('anon');
        });
    });
});
