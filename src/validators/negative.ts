import type { ValidatorFunction } from '~/types';


const negative = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be negative';

    return (value, errors) => {
        if (typeof value !== 'number' || value >= 0) {
            errors.push(msg);
        }
    };
};


export default negative;
