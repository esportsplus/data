import { PACKAGE_NAME } from '~/constants';
import type { ErrorType } from '~/types';


function floatSafeRemainder(value: number, step: number): number {
    let valDecimals = (value.toString().split('.')[1] || '').length,
        stepDecimals = (step.toString().split('.')[1] || '').length,
        decimals = valDecimals > stepDecimals ? valDecimals : stepDecimals,
        scale = Math.pow(10, decimals),
        valInt = Math.round(value * scale),
        stepInt = Math.round(step * scale);

    return (valInt % stepInt) / scale;
}


export default (n: number | bigint, error?: string): (value: unknown, errors: ErrorType) => void => {
    if (typeof n === 'bigint') {
        if (n === 0n) {
            throw new Error(`${PACKAGE_NAME}: multipleOf step must not be zero`);
        }
    }
    else if (Number.isNaN(n) || n === 0 || !Number.isFinite(n)) {
        throw new Error(`${PACKAGE_NAME}: multipleOf step must be a non-zero finite number`);
    }

    let msg = error || `must be a multiple of ${n}`;

    return (value, errors) => {
        if (typeof value === 'bigint') {
            let step = typeof n === 'bigint' ? n : (Number.isInteger(n) ? BigInt(n) : 0n);

            if (step === 0n || value % step !== 0n) {
                errors.push(msg);
            }

            return;
        }

        if (typeof value !== 'number' || Number.isNaN(value)) {
            errors.push(msg);

            return;
        }

        let step = typeof n === 'bigint' ? Number(n) : n;

        if (floatSafeRemainder(value, step) !== 0) {
            errors.push(msg);
        }
    };
};
