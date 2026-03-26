import type { ErrorType } from '~/types';


let RE = /^[a-zA-Z0-9_-]{21}$/;


const nanoid = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must be a valid NanoID');
    }
};


export default nanoid;
