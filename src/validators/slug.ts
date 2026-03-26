import type { ErrorType } from '~/types';


let REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid slug';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
