import type { ErrorType } from '~/types';


let REGEX = /^[a-zA-Z0-9_-]{21}$/;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid NanoID';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
