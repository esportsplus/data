import type { ValidatorFunction } from '~/types';


const nonNegative = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be non-negative';

    return (value, errors) => {
        if (typeof value !== 'number' || value < 0) {
            errors.push(msg);
        }
    };
};


export default nonNegative;
