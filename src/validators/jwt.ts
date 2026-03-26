import type { ValidatorFunction } from '~/types';


let RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;


const jwt = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid JWT';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default jwt;
