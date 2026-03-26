import type { ErrorType } from '~/types';


let REGEX = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid BIC/SWIFT code';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
