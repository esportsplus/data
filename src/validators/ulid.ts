import type { ErrorType } from '~/types';


let REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid ULID';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
