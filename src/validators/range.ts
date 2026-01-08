import { PACKAGE_NAME } from '~/constants';
import type { ValidatorFunction } from '~/types';


const range = (min: number, max: number, error?: string): ValidatorFunction<unknown> => {
    let arr = error || `must be between ${min} and ${max} items`,
        num = error || `must be between ${min} and ${max}`,
        str = error || `must be between ${min} and ${max} characters`;

    return (value, errors) => {
        if (typeof value === 'number') {
            if (value > max || value < min) {
                errors.push(num);
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
            throw new Error(`${PACKAGE_NAME}: range validator can only be applied to number, string, or array types`);
        }
    };
};


export default range;