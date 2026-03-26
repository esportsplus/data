import type { ValidatorFunction } from '~/types';


let RE = /^[a-zA-Z0-9_-]{21}$/;


const nanoid = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid NanoID';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default nanoid;
