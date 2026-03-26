import type { ValidatorFunction } from '~/types';


const finite = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be finite';

    return (value, errors) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            errors.push(msg);
        }
    };
};


export default finite;
