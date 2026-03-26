import type { ErrorType } from '~/types';


let RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;


const slug = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must be a valid slug');
    }
};


export default slug;
