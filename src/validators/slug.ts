import type { ValidatorFunction } from '~/types';


let RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;


const slug = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid slug';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default slug;
