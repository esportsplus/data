import { bench, describe } from 'vitest';
import { createValidator } from '../tests/utils';


// Setup: create validators outside bench functions (setup cost not measured)

let arrayValidator = createValidator(`
    type T = { items: number[] };
    validator.build<T>();
`);

let complexValidator = createValidator(`
    type T = { address: { city: string }; name: string };
    validator.build<T>();
`);

let multiFieldValidator = createValidator(`
    type T = { active: boolean; age: number; name: string };
    validator.build<T>();
`);

let simpleValidator = createValidator(`
    type T = { name: string };
    validator.build<T>();
`);

let unionValidator = createValidator(`
    type T = { status: 'active' | 'inactive' };
    validator.build<T>();
`);


// Test data

let arrayDataInvalid = { items: 'not-an-array' },
    arrayDataValid = { items: [1, 2, 3, 4, 5] },
    complexDataValid = { address: { city: 'NYC' }, name: 'John' },
    multiFieldDataInvalid = { active: 'yes', age: 'thirty', name: 42 },
    multiFieldDataValid = { active: true, age: 30, name: 'John' },
    simpleDataValid = { name: 'John' },
    unionDataValid = { status: 'active' };


describe('Validator - Valid Data', () => {
    bench('validate: simple type', () => {
        simpleValidator(simpleDataValid);
    });

    bench('validate: multi-field', () => {
        multiFieldValidator(multiFieldDataValid);
    });

    bench('validate: complex nested', () => {
        complexValidator(complexDataValid);
    });

    bench('validate: array field', () => {
        arrayValidator(arrayDataValid);
    });

    bench('validate: union type', () => {
        unionValidator(unionDataValid);
    });
});


describe('Validator - Invalid Data (Error Path)', () => {
    bench('validate: multi-field (all invalid)', () => {
        multiFieldValidator(multiFieldDataInvalid);
    });

    bench('validate: array (invalid type)', () => {
        arrayValidator(arrayDataInvalid);
    });
});
