import type { ErrorType } from '~/types';


let RE = /^[0-7]+$/;


const octal = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must be a valid octal number');
    }
};


export default octal;
