import type { ValidatorFunction } from '~/types';


const positive: ValidatorFunction<unknown> = (value, errors) => {
    if (typeof value !== 'number' || value <= 0) {
        errors.push('must be positive');
    }
};


export default positive;
