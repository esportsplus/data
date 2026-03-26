import type { ValidatorFunction } from '~/types';


let RE = /^[0-7]+$/;


const octal = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid octal number';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default octal;
