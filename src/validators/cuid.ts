import type { ErrorType } from '~/types';


let RE = /^c[a-z0-9]{24,}$/;


const cuid = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must be a valid CUID');
    }
};


export default cuid;
