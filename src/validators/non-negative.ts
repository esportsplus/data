import type { ErrorType } from '~/types';


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be non-negative';

    return (value, errors) => {
        if (typeof value !== 'number' || value < 0) {
            errors.push(msg);
        }
    };
};
