import type { ErrorType } from '~/types';


let REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid hostname';

    return (value, errors) => {
        if (typeof value !== 'string' || value.length > 253 || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
