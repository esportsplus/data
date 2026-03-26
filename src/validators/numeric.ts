import type { ErrorType } from '~/types';


let REGEX = /^[0-9]+$/;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must contain only numbers';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
