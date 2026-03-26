import type { ErrorType } from '~/types';


let RE = /^[a-z][a-z0-9]{24,}$/;


const cuid2 = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must be a valid CUID2');
    }
};


export default cuid2;
