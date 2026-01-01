import type { ValidatorFunction } from '~/types';


export default (number: number, error?: string): ValidatorFunction<unknown> => {
    return (value, errors) => {
        if (typeof value === 'number') {
            if (value < number) {
                errors.push(error || `must be at least ${number}`);
            }
        }
        else if (typeof value === 'string') {
            if (value.length < number) {
                errors.push(error || `must be at least ${number} characters`);
            }
        }
        else if (Array.isArray(value)) {
            if (value.length < number) {
                errors.push(error || `must be at least ${number} items`);
            }
        }
        else {
            throw new Error('@esportsplus/data: min validator can only be applied to number, string, or array types');
        }
    };
};