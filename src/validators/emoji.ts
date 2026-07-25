import type { ErrorType } from '~/types';


let REGEX = /^[\p{RGI_Emoji}]+$/v;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be an emoji';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
