import type { ValidatorFunction } from '~/types';


export default (min: number, max: number, error?: string): ValidatorFunction<unknown> => {
    return (value, errors) => {
        if (typeof value === 'number') {
            if (value > max || value < min) {
                errors.push(error || `must be between ${min} and ${max}`);
            }
        }
        else if (typeof value === 'string') {
            if (value.length < min || value.length > max) {
                errors.push(error || `must be between ${min} and ${max} characters`);
            }
        }
        else if (Array.isArray(value)) {
            if (value.length < min || value.length > max) {
                errors.push(error || `must be between ${min} and ${max} items`);
            }
        }
        else {
            throw new Error('@esportsplus/data: range validator can only be applied to number, string, or array types');
        }
    };
};