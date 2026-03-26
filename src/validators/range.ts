import { PACKAGE_NAME } from '~/constants';
import type { ErrorType } from '~/types';


export default (min: number, max: number, error?: string): (value: unknown, errors: ErrorType) => void => {
    let arr = error || `must be between ${min} and ${max} items`,
        big = error || `must be between ${min} and ${max}`,
        num = error || `must be between ${min} and ${max}`,
        str = error || `must be between ${min} and ${max} characters`;

    return (value, errors) => {
        if (typeof value === 'number') {
            if (value > max || value < min) {
                errors.push(num);
            }
        }
        else if (typeof value === 'bigint') {
            if (value < BigInt(min) || value > BigInt(max)) {
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
            throw new Error(`${PACKAGE_NAME}: range validator can only be applied to number, bigint, string, or array types`);
        }
    };
};
