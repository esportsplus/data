import type { ErrorType } from '~/types';


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be negative';

    return (value, errors) => {
        if (typeof value === 'bigint') {
            if (value >= 0n) {
                errors.push(msg);
            }
        }
        else if (typeof value !== 'number' || Number.isNaN(value) || value >= 0) {
            errors.push(msg);
        }
    };
};
