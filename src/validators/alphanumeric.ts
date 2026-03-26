import type { ValidatorFunction } from '~/types';


let RE = /^[a-zA-Z0-9]+$/;


const alphanumeric = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must contain only letters and numbers';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default alphanumeric;
