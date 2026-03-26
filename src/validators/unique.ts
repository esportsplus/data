import type { ErrorType } from '~/types';


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let arrayMsg = error || 'must be an array',
        uniqueMsg = error || 'must contain unique items';

    return (value, errors) => {
        if (!Array.isArray(value)) {
            errors.push(arrayMsg);
            return;
        }

        let seen = new Set();

        for (let i = 0, n = value.length; i < n; i++) {
            if (seen.has(value[i])) {
                errors.push(uniqueMsg);
                return;
            }

            seen.add(value[i]);
        }
    };
};
