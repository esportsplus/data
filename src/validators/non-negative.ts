import type { ValidatorFunction } from '~/types';


const nonNegative: ValidatorFunction<unknown> = (value, errors) => {
    if (typeof value !== 'number' || value < 0) {
        errors.push('must be non-negative');
    }
};


export default nonNegative;
