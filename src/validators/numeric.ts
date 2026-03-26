import type { ErrorType } from '~/types';


let RE = /^[0-9]+$/;


const numeric = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must contain only numbers');
    }
};


export default numeric;
