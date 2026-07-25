import { PACKAGE_NAME } from '~/constants';
import type { ErrorType } from '~/types';


export default (number: number, error?: string): (value: unknown, errors: ErrorType) => void => {
    if (!Number.isFinite(number)) {
        throw new Error(`${PACKAGE_NAME}: min bound must be a finite number`);
    }

    let arr = error || `must be at least ${number} items`,
        big = error || `must be at least ${number}`,
        num = error || `must be at least ${number}`,
        str = error || `must be at least ${number} characters`,
        type = error || 'must be a number, bigint, string, or array';

    return (value, errors) => {
        if (typeof value === 'number') {
            if (Number.isNaN(value) || value < number) {
                errors.push(num);
            }
        }
        else if (typeof value === 'bigint') {
            if (value < number) {
                errors.push(big);
            }
        }
        else if (typeof value === 'string') {
            if (value.length < number) {
                errors.push(str);
            }
        }
        else if (Array.isArray(value)) {
            if (value.length < number) {
                errors.push(arr);
            }
        }
        else {
            errors.push(type);
        }
    };
};
