import type { ValidatorFunction } from '~/types';


const safeInteger = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a safe integer';

    return (value, errors) => {
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
            errors.push(msg);
        }
    };
};


export default safeInteger;
