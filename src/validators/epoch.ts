import type { ValidatorFunction } from '~/types';


let RE = /^\d+$/;


const epoch = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid epoch timestamp';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default epoch;
