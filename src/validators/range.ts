import type { ValidatorFunction } from '~/types';


const range = (min: number, max: number, error?: string): ValidatorFunction<unknown> => {
    // Pre-compute error messages to avoid template literal allocation in hot path
    let arrayError = error || `must be between ${min} and ${max} items`,
        numberError = error || `must be between ${min} and ${max}`,
        stringError = error || `must be between ${min} and ${max} characters`;

    return (value, errors) => {
        if (typeof value === 'number') {
            if (value > max || value < min) {
                errors.push(numberError);
            }
        }
        else if (typeof value === 'string') {
            if (value.length < min || value.length > max) {
                errors.push(stringError);
            }
        }
        else if (Array.isArray(value)) {
            if (value.length < min || value.length > max) {
                errors.push(arrayError);
            }
        }
        else {
            throw new Error('@esportsplus/data: range validator can only be applied to number, string, or array types');
        }
    };
};


export default range;