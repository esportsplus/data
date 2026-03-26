import type { ErrorType } from '~/types';


export default (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || `must be exactly ${n} characters`;

    return (value, errors) => {
        if (typeof value !== 'string' || value.length !== n) {
            errors.push(msg);
        }
    };
};
