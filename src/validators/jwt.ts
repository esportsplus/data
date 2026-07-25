import type { ErrorType } from '~/types';


let REGEX = /^[\w-]+\.[\w-]+\.[\w-]*$/;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid JWT';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
