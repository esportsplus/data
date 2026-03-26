import type { ValidatorFunction } from '~/types';


const negative: ValidatorFunction<unknown> = (value, errors) => {
    if (typeof value !== 'number' || value >= 0) {
        errors.push('must be negative');
    }
};


export default negative;
