import type { ErrorType } from '~/types';


let REGEX = /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid MIME type';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
