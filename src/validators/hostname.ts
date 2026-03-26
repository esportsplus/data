import type { ValidatorFunction } from '~/types';


let RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;


const hostname = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid hostname';

    return (value, errors) => {
        if (typeof value !== 'string' || value.length > 253 || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default hostname;
