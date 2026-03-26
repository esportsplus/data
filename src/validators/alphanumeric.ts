import type { ErrorType } from '~/types';


let RE = /^[a-zA-Z0-9]+$/;


const alphanumeric = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must contain only letters and numbers');
    }
};


export default alphanumeric;
