import type { ErrorType } from '~/types';


let RE = /^\+[1-9]\d{1,14}$/;


const phone = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || !RE.test(value)) {
        errors.push('must be a valid phone number');
    }
};


export default phone;
