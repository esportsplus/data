import { describe, expect, it } from 'vitest';
import { createValidator, transformCode } from '../utils';


type Result = { data: any; errors?: Array<{ message: string; path: string }>; ok: boolean };


const DRAFT = 'https://json-schema.org/draft/2020-12/schema';


// Fixture types avoid DOM globals (Node/Document/Range): a scratch file is a script, so those
// names collide with the global type instead of shadowing it.
function build(source: string): (input: unknown) => Result {
    return createValidator(source) as (input: unknown) => Result;
}

// Executes the FULL emitted module (not just createValidator's prelude slice) and injects the
// runtime factories the hoisted config consts call, so config/default/async cases can drive a
// recursive validator whose brand body or config invocation references injected symbols.
function buildModule(source: string, injected: Record<string, unknown> = {}): (input: unknown) => Result | Promise<Result> {
    let code = transformCode(source),
        match = code.match(/const\s+(\w+)\s*=\s*\{\s*toJsonSchema:/);

    if (match === null) {
        throw new Error('recursive-types: no build POJO emitted for source');
    }

    let body = code.replace(/^\s*import\b.*$/gm, '').replace(/^\s*type\b.*$/gm, ''),
        keys = Object.keys(injected);

    return new Function(...keys, `${body}\nreturn ${match[1]}.validate;`)(...keys.map((key) => injected[key]));
}

function schemaOf(source: string): Record<string, unknown> {
    let line = transformCode(source)
        .split('\n')
        .find((l) => /const schema_\w+ =/.test(l));

    if (line === undefined) {
        throw new Error('recursive-types: no schema const emitted for source');
    }

    return JSON.parse(line.replace(/^\s*const schema_\w+ = /, '').replace(/;\s*$/, ''));
}


describe('recursive types recurse through named functions', () => {
    describe('self-recursion via the root # back-edge', () => {
        let validate = build(`
            type Rec = { value: number; next?: Rec };
            validator.build<Rec>();
        `);

        it('preserves a recursive sub-object instead of replacing it with {}', () => {
            let input = { next: { value: 2 }, value: 1 },
                result = validate(input);

            expect(result.ok).toBe(true);
            expect(result.data).toEqual(input);
        });

        it('round-trips three levels deep with every level intact', () => {
            let input = { next: { next: { value: 3 }, value: 2 }, value: 1 },
                result = validate(input);

            expect(result.ok).toBe(true);
            expect(result.data).toEqual(input);
        });

        it('validates the back-edge rather than copying: an invalid leaf reports at next.value', () => {
            let result = validate({ next: { value: 'not-a-number' }, value: 1 });

            expect(result.ok).toBe(false);
            expect(result.errors).toEqual([{ message: 'must be a number', path: 'next.value' }]);
        });
    });

    describe('mutual recursion', () => {
        it('round-trips both directions through the root # path', () => {
            let validate = build(`
                type A = { tag: string; b?: B };
                type B = { id: number; a?: A };
                validator.build<A>();
            `),
                input = { b: { a: { b: { id: 7 }, tag: 'deep' }, id: 5 }, tag: 'root' },
                result = validate(input);

            expect(result.ok).toBe(true);
            expect(result.data).toEqual(input);
        });

        it('round-trips through the $defs path when a non-root type recurses', () => {
            let validate = build(`
                type A = { tag: string; b?: B };
                type B = { id: number; a?: A };
                type Root = { a: A };
                validator.build<Root>();
            `),
                input = { a: { b: { a: { tag: 'leaf' }, id: 5 }, tag: 'top' } },
                result = validate(input);

            expect(result.ok).toBe(true);
            expect(result.data).toEqual(input);
        });

        it('reports an invalid leaf beneath the $defs path', () => {
            let validate = build(`
                type A = { tag: string; b?: B };
                type B = { id: number; a?: A };
                type Root = { a: A };
                validator.build<Root>();
            `),
                result = validate({ a: { b: { id: 'nope' }, tag: 'top' } });

            expect(result.ok).toBe(false);
            expect(result.errors?.[0]?.message).toBe('must be a number');
        });
    });

    describe('cyclic INPUT termination', () => {
        it('stops with a named depth error instead of hanging', () => {
            let validate = build(`
                type Rec = { value: number; next?: Rec };
                validator.build<Rec>();
            `),
                cyclic: any = { value: 1 };

            cyclic.next = cyclic;

            let result = validate(cyclic);

            expect(result.ok).toBe(false);
            expect(result.errors?.some((e) => e.message === 'exceeds maximum validation depth')).toBe(true);
        }, 2000);
    });

    describe('deep error-path fidelity', () => {
        it('renders a depth-2 leaf error as next.next.value, not ["next.next"].value', () => {
            let validate = build(`
                    type Rec = { value: number; next?: Rec };
                    validator.build<Rec>();
                `),
                result = validate({ next: { next: { value: 'x' }, value: 2 }, value: 1 });

            expect(result.ok).toBe(false);
            expect(result.errors).toEqual([{ message: 'must be a number', path: 'next.next.value' }]);
        });
    });

    describe('config validators run at every depth', () => {
        let sentinel = (value: unknown, config: { push(message: string): void }) => {
            if (value === 99) {
                config.push('sentinel');
            }
        };

        it('reports a depth-1 config violation at next.value', () => {
            let validate = buildModule(
                    `type Rec = { value: number; next?: Rec };
                     validator.build<Rec>({ value: sentinel });`,
                    { sentinel }
                ),
                result = validate({ next: { value: 99 }, value: 1 }) as Result;

            expect(result.ok).toBe(false);
            expect(result.errors).toContainEqual({ message: 'sentinel', path: 'next.value' });
        });

        it('reports a depth-0 config violation at value', () => {
            let validate = buildModule(
                    `type Rec = { value: number; next?: Rec };
                     validator.build<Rec>({ value: sentinel });`,
                    { sentinel }
                ),
                result = validate({ value: 99 }) as Result;

            expect(result.ok).toBe(false);
            expect(result.errors).toContainEqual({ message: 'sentinel', path: 'value' });
        });
    });

    describe('defaults fill at every depth', () => {
        it('fills the default on both data and data.next', () => {
            let validate = buildModule(`
                    type Rec = { value: number; tag?: string; next?: Rec };
                    validator.build<Rec>({ tag: ((_v, _e) => {}).default('X') });
                `),
                result = validate({ next: { value: 2 }, value: 1 }) as Result;

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ next: { tag: 'X', value: 2 }, tag: 'X', value: 1 });
        });
    });

    describe('async brand inside a recursive shape', () => {
        let source = `
            type Brand<T, B extends string> = T & { __brand: B };
            type Handle = Brand<string, 'handle'>;
            type ErrorType = { push(message: string): void };
            type Rec = { handle: Handle; next?: Rec };
            validator.set(async (value: Handle, errors: ErrorType) => { await Promise.resolve(); if (value.length === 0) { errors.push('handle required'); } });
            validator.build<Rec>();
        `;

        it('emits an async recursion decl and an awaited recurse call', () => {
            let code = transformCode(source);

            expect(code).toMatch(/async function recurse_/);
            expect(code).toMatch(/await recurse_/);
        });

        it('builds a runnable async validator that resolves ok for valid input', async () => {
            let validate = buildModule(source),
                result = await validate({ handle: 'x' });

            expect(result.ok).toBe(true);
            expect(result.data).toEqual({ handle: 'x' });
        });
    });

    describe('pay-for-what-you-use', () => {
        it('emits no recursion machinery for a non-recursive type', () => {
            let code = transformCode(`
                type Plain = { name: string; value: number };
                validator.build<Plain>();
            `);

            expect(code).not.toMatch(/recurse/);
            expect(code).not.toMatch(/_depth/);
        });
    });

    describe('JSON Schema is untouched by the validator change', () => {
        it('a root self-recursive type still emits $ref "#"', () => {
            expect(schemaOf(`
                type Rec = { value: number; next?: Rec };
                validator.build<Rec>();
            `)).toEqual({
                '$schema': DRAFT,
                additionalProperties: false,
                properties: { next: { '$ref': '#' }, value: { type: 'number' } },
                required: ['value'],
                type: 'object'
            });
        });

        it('a non-root recursive type still emits a $defs anchor', () => {
            let schema = schemaOf(`
                type A = { tag: string; b?: B };
                type B = { id: number; a?: A };
                type Root = { a: A };
                validator.build<Root>();
            `);

            expect(schema['$defs']).toEqual({
                A: {
                    additionalProperties: false,
                    properties: {
                        b: {
                            additionalProperties: false,
                            properties: { a: { '$ref': '#/$defs/A' }, id: { type: 'number' } },
                            required: ['id'],
                            type: 'object'
                        },
                        tag: { type: 'string' }
                    },
                    required: ['tag'],
                    type: 'object'
                }
            });
        });
    });
});
