import type { ValidatorFunction } from '~/types';


const dateString = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be a valid date string';

    return (value, errors) => {
        if (typeof value !== 'string' || isNaN(new Date(value).getTime())) {
            errors.push(msg);
        }
    };
};


export default dateString;
