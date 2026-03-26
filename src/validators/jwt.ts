import type { ErrorType } from '~/types';


let RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;


const jwt = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must be a valid JWT');
    }
};


export default jwt;
