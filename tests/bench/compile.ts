import { bench, describe } from 'vitest';
import { transformCode } from '../utils';


describe('Compile - Validator', () => {
    bench('compile: simple type', () => {
        transformCode(`
            type T = { name: string };
            validator.build<T>();
        `);
    });

    bench('compile: complex type (6 fields)', () => {
        transformCode(`
            type T = { active: boolean; age: number; email: string; name: string; score: number; tags: string[] };
            validator.build<T>();
        `);
    });

    bench('compile: nested type', () => {
        transformCode(`
            type T = { address: { city: string; zip: string }; name: string };
            validator.build<T>();
        `);
    });
});
