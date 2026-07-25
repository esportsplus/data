import { PACKAGE_NAME } from '~/constants';
import type { ErrorType } from '~/types';


export default (n: number, error?: string): (value: unknown, errors: ErrorType) => void => {
    if (Number.isNaN(n) || n < 0) {
        throw new Error(`${PACKAGE_NAME}: length count must be a non-negative number`);
    }

    let msg = error || `must be exactly ${n} code units`;

    return (value, errors) => {
        if ((typeof value !== 'string' && !Array.isArray(value)) || value.length !== n) {
            errors.push(msg);
        }
    };
};
