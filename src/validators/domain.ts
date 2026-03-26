import type { ValidatorFunction } from '~/types';


let RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;


const domain = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid domain';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default domain;
