import { PACKAGE_NAME } from '~/constants';
import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

type PF = (d: Date, error?: string) => ValidatorFunction<unknown>;


function assertBound(label: string, d: Date): void {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
        throw new Error(`${PACKAGE_NAME}: date.${label} bound must be a valid Date`);
    }
}

// Exotic receivers (e.g. Proxy<Date>) inherit Date's prototype but lack the
// internal slot getTime() reads, so the call throws — categorize as invalid.
function dateValue(value: unknown): number | null {
    if (!(value instanceof Date) && !(typeof value === 'object' && value !== null && typeof (value as Date).getTime === 'function')) {
        return null;
    }

    try {
        let time = (value as Date).getTime();

        return typeof time === 'number' && !Number.isNaN(time) ? time : null;
    }
    catch {
        return null;
    }
}


let date: { future: F; max: PF; min: PF; past: F; valid: F } = {
    future: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a future date';

        return (value, errors) => {
            let time = dateValue(value);

            if (time === null || time <= Date.now()) {
                errors.push(msg);
            }
        };
    },

    max: (d: Date, error?: string): ValidatorFunction<unknown> => {
        assertBound('max', d);

        return (value, errors) => {
            let time = dateValue(value);

            if (time === null || time > d.getTime()) {
                errors.push(error || `must be on or before ${d.toISOString()}`);
            }
        };
    },

    min: (d: Date, error?: string): ValidatorFunction<unknown> => {
        assertBound('min', d);

        return (value, errors) => {
            let time = dateValue(value);

            if (time === null || time < d.getTime()) {
                errors.push(error || `must be on or after ${d.toISOString()}`);
            }
        };
    },

    past: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a past date';

        return (value, errors) => {
            let time = dateValue(value);

            if (time === null || time >= Date.now()) {
                errors.push(msg);
            }
        };
    },

    valid: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid date';

        return (value, errors) => {
            if (dateValue(value) === null) {
                errors.push(msg);
            }
        };
    },
};


export default date;
