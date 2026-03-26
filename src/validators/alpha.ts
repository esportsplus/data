import type { ValidatorFunction } from '~/types';


let RE = /^[a-zA-Z]+$/;


const alpha = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must contain only letters';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default alpha;
