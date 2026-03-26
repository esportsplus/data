import type { ValidatorFunction } from '~/types';


const integer: ValidatorFunction<unknown> = (value, errors) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push('must be an integer');
    }
};


export default integer;
