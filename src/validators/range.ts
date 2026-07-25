import { PACKAGE_NAME } from '~/constants';
import type { ErrorType } from '~/types';


export default (min: number, max: number, error?: string): (value: unknown, errors: ErrorType) => void => {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new Error(`${PACKAGE_NAME}: range bounds must be finite numbers`);
    }

    if (min > max) {
        throw new Error(`${PACKAGE_NAME}: range bounds inverted (min ${min} > max ${max})`);
    }

    let arr = error || `must be between ${min} and ${max} items`,
        big = error || `must be between ${min} and ${max}`,
        num = error || `must be between ${min} and ${max}`,
        str = error || `must be between ${min} and ${max} characters`,
        type = error || 'must be a number, bigint, string, or array';

    return (value, errors) => {
        if (typeof value === 'number') {
            if (Number.isNaN(value) || value < min || value > max) {
                errors.push(num);
            }
        }
        else if (typeof value === 'bigint') {
            if (value < min || value > max) {
                errors.push(big);
            }
        }
        else if (typeof value === 'string') {
            if (value.length < min || value.length > max) {
                errors.push(str);
            }
        }
        else if (Array.isArray(value)) {
            if (value.length < min || value.length > max) {
                errors.push(arr);
            }
        }
        else {
            errors.push(type);
        }
    };
};
