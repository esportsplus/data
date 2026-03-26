import type { ErrorType } from '~/types';


const dateString = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string' || isNaN(new Date(value).getTime())) {
        errors.push('must be a valid date string');
    }
};


export default dateString;
