import type { ValidatorFunction } from '~/types';


let RE = /^\+[1-9]\d{1,14}$/;


const phone = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid phone number';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default phone;
