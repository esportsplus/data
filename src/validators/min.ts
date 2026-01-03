import type { ValidatorFunction } from '~/types';


const min = (number: number, error?: string): ValidatorFunction<unknown> => {
    // Pre-compute error messages to avoid template literal allocation in hot path
    let arrayError = error || `must be at least ${number} items`,
        numberError = error || `must be at least ${number}`,
        stringError = error || `must be at least ${number} characters`;

    return (value, errors) => {
        if (typeof value === 'number') {
            if (value < number) {
                errors.push(numberError);
            }
        }
        else if (typeof value === 'string') {
            if (value.length < number) {
                errors.push(stringError);
            }
        }
        else if (Array.isArray(value)) {
            if (value.length < number) {
                errors.push(arrayError);
            }
        }
        else {
            throw new Error('@esportsplus/data: min validator can only be applied to number, string, or array types');
        }
    };
};


export default min;