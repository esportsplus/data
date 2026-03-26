import type { ValidatorFunction } from '~/types';


let RE = /^[a-z][a-z0-9]{24,}$/;


const cuid2 = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid CUID2';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default cuid2;
