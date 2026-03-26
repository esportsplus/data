import type { ErrorType } from '~/types';


export default (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || `must be a multiple of ${n}`;

    return (value, errors) => {
        if (typeof value !== 'number' || value % n !== 0) {
            errors.push(msg);
        }
    };
};
