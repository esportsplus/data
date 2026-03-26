import type { ValidatorFunction } from '~/types';


const jsonString = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid JSON string';

    return (value, errors) => {
        if (typeof value !== 'string') {
            errors.push(msg);
            return;
        }

        try {
            JSON.parse(value);
        }
        catch {
            errors.push(msg);
        }
    };
};


export default jsonString;
