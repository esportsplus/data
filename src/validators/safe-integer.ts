import type { ErrorType } from '~/types';


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a safe integer';

    return (value, errors) => {
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
            errors.push(msg);
        }
    };
};
