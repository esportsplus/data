import type { ValidatorFunction } from '~/types';


const unique: ValidatorFunction<unknown> = (value, errors) => {
    if (!Array.isArray(value)) {
        errors.push('must be an array');
        return;
    }

    let seen = new Set();

    for (let i = 0, n = value.length; i < n; i++) {
        if (seen.has(value[i])) {
            errors.push('must contain unique items');
            return;
        }

        seen.add(value[i]);
    }
};


export default unique;
