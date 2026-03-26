import type { ValidatorFunction } from '~/types';


const integer = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be an integer';

    return (value, errors) => {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
            errors.push(msg);
        }
    };
};


export default integer;
