import type { ErrorType } from '~/types';


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be an integer';

    return (value, errors) => {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
            errors.push(msg);
        }
    };
};
