import type { ValidatorFunction } from '~/types';


let RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;


const ulid = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid ULID';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default ulid;
