import { describe, expect, it } from 'vitest';

import max from '../../src/validators/max';
import min from '../../src/validators/min';
import range from '../../src/validators/range';
import { evaluateModule } from '../utils';


type Result = { data: unknown; errors?: Array<{ message: string; path: string }>; ok: boolean };

type Row = {
    expression?: string;
    fail: { errors: Array<{ message: string; path: string }>; input: unknown };
    injected?: Record<string, unknown>;
    name: string;
    pass: { data?: unknown; input: unknown };
    source: string;
};


// End-to-end coverage of the BUILD PIPELINE: source text -> transform -> EXECUTE the emitted
// module -> assert behavior. Every P0 in this package shipped behind a green suite because the
// tests asserted units in isolation (validators called by hand, never through validator.build)
// or asserted emitted TEXT rather than emitted behavior. Each row here runs a pass vector and a
// fail vector against the real generated code, so a regression in the pipeline fails a row by
// name. Add a pipeline feature as ONE row.
const ROWS: Row[] = [
    {
        fail: { errors: [{ message: 'too short', path: 'name' }], input: { name: 'ab' } },
        injected: { min },
        name: 'builtin config validator runs (the dead-config P0)',
        pass: { data: { name: 'abcdef' }, input: { name: 'abcdef' } },
        source: 'type U = { name: string };\nexport const validate = validator.build<U>({ name: min(5, \'too short\') });'
    },
    {
        fail: { errors: [{ message: 'no at sign', path: 'email' }], input: { email: 'nope' } },
        name: 'inline arrow config runs',
        pass: { data: { email: 'a@b.c' }, input: { email: 'a@b.c' } },
        source: 'type U = { email: string };\nexport const validate = validator.build<U>({ email: (value, errors) => { if (!String(value).includes(\'@\')) { errors.push(\'no at sign\'); } } });'
    },
    {
        fail: { errors: [{ message: 'too long', path: 'name' }], input: { name: 'abcdefghij' } },
        injected: { max, min },
        name: 'array config runs every validator in order',
        pass: { data: { name: 'abcd' }, input: { name: 'abcd' } },
        source: 'type U = { name: string };\nexport const validate = validator.build<U>({ name: [min(2, \'too short\'), max(6, \'too long\')] });'
    },
    {
        fail: { errors: [{ message: 'out of range', path: 'age' }], input: { age: 5 } },
        injected: { range },
        name: 'annotation chain is stripped and the base validator still runs',
        pass: { data: { age: 30 }, input: { age: 30 } },
        source: 'type U = { age: number };\nexport const validate = validator.build<U>({ age: range(18, 120, \'out of range\').describe(\'the age\') });'
    },
    {
        fail: { errors: [{ message: 'must be a string', path: 'nickname' }], input: { name: 'a', nickname: 5 } },
        name: 'optional and nullable properties',
        pass: { data: { name: 'a' }, input: { name: 'a' } },
        source: 'type U = { name: string; nickname?: string | null };\nexport const validate = validator.build<U>();'
    },
    {
        fail: { errors: [{ message: 'invalid union type', path: 'id' }], input: { id: true } },
        name: 'union type',
        pass: { data: { id: 7 }, input: { id: 7 } },
        source: 'type U = { id: string | number };\nexport const validate = validator.build<U>();'
    },
    {
        fail: { errors: [{ message: 'must be a string', path: 'users[1].id' }], input: { users: [{ id: 'a' }, { id: 5 }] } },
        name: 'array of objects reports the element index in the path',
        pass: { data: { users: [{ id: 'a' }] }, input: { users: [{ id: 'a' }] } },
        source: 'type U = { users: { id: string }[] };\nexport const validate = validator.build<U>();'
    },
    {
        fail: { errors: [{ message: 'must be a number', path: 'scores.b' }], input: { scores: { a: 1, b: 'x' } } },
        name: 'record reports the runtime key in the path',
        pass: { data: { scores: { a: 1 } }, input: { scores: { a: 1 } } },
        source: 'type U = { scores: Record<string, number> };\nexport const validate = validator.build<U>();'
    },
    {
        fail: { errors: [{ message: 'invalid tuple type', path: 'point' }], input: { point: [1] } },
        name: 'tuple arity and element paths',
        pass: { data: { point: [1, 2] }, input: { point: [1, 2] } },
        source: 'type U = { point: [number, number] };\nexport const validate = validator.build<U>();'
    },
    {
        fail: { errors: [{ message: 'must be a string', path: '[1]' }], input: ['a', 5] },
        name: 'non-object root type validates instead of accepting anything',
        pass: { data: ['a', 'b'], input: ['a', 'b'] },
        source: 'type U = string[];\nexport const validate = validator.build<U>();'
    },
    {
        expression: 'validate',
        fail: { errors: [{ message: 'must be an object', path: '' }], input: null },
        name: 'a null input reports an error instead of throwing',
        pass: { data: { name: 'a' }, input: { name: 'a' } },
        source: 'type U = { name: string };\nexport const validate = validator.build<U>();'
    },
    {
        expression: 'aliased',
        fail: { errors: [{ message: 'must be a string', path: 'name' }], input: { name: 5 } },
        name: 'aliased import form is transformed',
        pass: { data: { name: 'a' }, input: { name: 'a' } },
        source: 'type U = { name: string };\nexport const aliased = validator.build<U>();'
    }
];


describe('build pipeline end-to-end', () => {
    for (let i = 0, n = ROWS.length; i < n; i++) {
        let row = ROWS[i];

        describe(row.name, () => {
            it('accepts its pass vector', () => {
                let built = evaluateModule(row.source, row.injected, `${row.expression ?? 'validate'}.validate`) as (input: unknown) => Result,
                    result = built(row.pass.input);

                expect(result.ok).toBe(true);

                if (row.pass.data !== undefined) {
                    expect(result.data).toEqual(row.pass.data);
                }
            });

            it('rejects its fail vector with the exact path and message', () => {
                let built = evaluateModule(row.source, row.injected, `${row.expression ?? 'validate'}.validate`) as (input: unknown) => Result,
                    result = built(row.fail.input);

                expect(result.ok).toBe(false);
                expect(result.errors).toEqual(row.fail.errors);
            });
        });
    }

    describe('toJsonSchema alongside build in one file', () => {
        it('emits both and shares the hoisted schema', () => {
            let source = 'type U = { name: string };\nexport const validate = validator.build<U>();\nexport const schema = validator.toJsonSchema<U>();',
                schema = evaluateModule(source, {}, 'schema') as Record<string, unknown>,
                built = evaluateModule(source, {}, 'validate.toJsonSchema()') as Record<string, unknown>;

            expect(schema).toEqual(built);
            expect(schema.type).toBe('object');
        });
    });
});
