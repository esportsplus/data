import type { ValidatorFunction } from '~/types';


let RE = /^[0-9]+$/;


const numeric = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must contain only numbers';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default numeric;
