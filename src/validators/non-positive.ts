import type { ValidatorFunction } from '~/types';


const nonPositive = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be non-positive';

    return (value, errors) => {
        if (typeof value !== 'number' || value > 0) {
            errors.push(msg);
        }
    };
};


export default nonPositive;
