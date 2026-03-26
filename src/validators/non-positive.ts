import type { ValidatorFunction } from '~/types';


const nonPositive: ValidatorFunction<unknown> = (value, errors) => {
    if (typeof value !== 'number' || value > 0) {
        errors.push('must be non-positive');
    }
};


export default nonPositive;
