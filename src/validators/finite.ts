import type { ErrorType } from '~/types';


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be finite';

    return (value, errors) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            errors.push(msg);
        }
    };
};
