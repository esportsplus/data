import type { ValidatorFunction } from '~/types';


let RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;


const bic = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid BIC/SWIFT code';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default bic;
