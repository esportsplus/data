import type { ValidatorFunction } from '~/types';


const finite: ValidatorFunction<unknown> = (value, errors) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push('must be finite');
    }
};


export default finite;
