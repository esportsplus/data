import type { ValidatorFunction } from '~/types';


const multipleOf = (n: number, error?: string): ValidatorFunction<unknown> => {
    let msg = error || `must be a multiple of ${n}`;

    return (value, errors) => {
        if (typeof value !== 'number' || value % n !== 0) {
            errors.push(msg);
        }
    };
};


export default multipleOf;
