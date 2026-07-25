import type { ErrorType } from '~/types';


let MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a safe integer';

    return (value, errors) => {
        if (typeof value === 'bigint') {
            if (value < -MAX_SAFE || value > MAX_SAFE) {
                errors.push(msg);
            }

            return;
        }

        if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
            errors.push(msg);
        }
    };
};
