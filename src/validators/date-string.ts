import type { ErrorType } from '~/types';


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid date string';

    return (value, errors) => {
        if (typeof value !== 'string' || isNaN(new Date(value).getTime())) {
            errors.push(msg);
        }
    };
};
