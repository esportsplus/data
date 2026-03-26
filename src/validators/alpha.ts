import type { ErrorType } from '~/types';


let RE = /^[a-zA-Z]+$/;


const alpha = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must contain only letters');
    }
};


export default alpha;
