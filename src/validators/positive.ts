import type { ValidatorFunction } from '~/types';


const positive = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be positive';

    return (value, errors) => {
        if (typeof value !== 'number' || value <= 0) {
            errors.push(msg);
        }
    };
};


export default positive;
