import type { ValidatorFunction } from '~/types';


const max = (number: number, error?: string): ValidatorFunction<unknown> => {
    let arr = error || `must be at most ${number} items`,
        num = error || `must be at most ${number}`,
        str = error || `must be at most ${number} characters`;

    return (value, errors) => {
        if (typeof value === 'number') {
            if (value > number) {
                errors.push(num);
            }
        }
        else if (typeof value === 'string') {
            if (value.length > number) {
                errors.push(str);
            }
        }
        else if (Array.isArray(value)) {
            if (value.length > number) {
                errors.push(arr);
            }
        }
        else {
            throw new Error('@esportsplus/data: max validator can only be applied to number, string, or array types');
        }
    };
};


export default max;