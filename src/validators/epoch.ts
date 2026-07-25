import type { ErrorType } from '~/types';


let REGEX = /^\d{1,13}$/;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid epoch timestamp';

    return (value, errors) => {
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 0) {
                errors.push(msg);
            }
        }
        else if (typeof value === 'string') {
            if (!REGEX.test(value)) {
                errors.push(msg);
            }
        }
        else {
            errors.push(msg);
        }
    };
};
