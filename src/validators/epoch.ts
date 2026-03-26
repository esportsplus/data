import type { ErrorType } from '~/types';


let RE = /^\d+$/;


const epoch = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must be a valid epoch timestamp');
    }
};


export default epoch;
