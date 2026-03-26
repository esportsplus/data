import type { ValidatorFunction } from '~/types';


const safeInteger: ValidatorFunction<unknown> = (value, errors) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        errors.push('must be a safe integer');
    }
};


export default safeInteger;
