import type { ErrorType } from '~/types';


let RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;


const hostname = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || value.length > 253 || !RE.test(value)) {
        errors.push('must be a valid hostname');
    }
};


export default hostname;
