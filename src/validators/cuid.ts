import type { ValidatorFunction } from '~/types';


let RE = /^c[a-z0-9]{24,}$/;


const cuid = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid CUID';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default cuid;
