import type { ErrorType } from '~/types';


let RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;


const ulid = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must be a valid ULID');
    }
};


export default ulid;
