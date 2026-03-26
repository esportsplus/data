import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

type PF = (d: Date, error?: string) => ValidatorFunction<unknown>;


let date: { future: F; max: PF; min: PF; past: F; valid: F } = {
    future: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a future date';

        return (value, errors) => {
            if (!(value instanceof Date) || isNaN(value.getTime()) || value.getTime() <= Date.now()) {
                errors.push(msg);
            }
        };
    },

    max: (d: Date, error?: string): ValidatorFunction<unknown> => {
        let msg = error || `must be on or before ${d.toISOString()}`;

        return (value, errors) => {
            if (!(value instanceof Date) || isNaN(value.getTime()) || value.getTime() > d.getTime()) {
                errors.push(msg);
            }
        };
    },

    min: (d: Date, error?: string): ValidatorFunction<unknown> => {
        let msg = error || `must be on or after ${d.toISOString()}`;

        return (value, errors) => {
            if (!(value instanceof Date) || isNaN(value.getTime()) || value.getTime() < d.getTime()) {
                errors.push(msg);
            }
        };
    },

    past: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a past date';

        return (value, errors) => {
            if (!(value instanceof Date) || isNaN(value.getTime()) || value.getTime() >= Date.now()) {
                errors.push(msg);
            }
        };
    },

    valid: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid date';

        return (value, errors) => {
            if (!(value instanceof Date) || isNaN(value.getTime())) {
                errors.push(msg);
            }
        };
    },
};


export default date;
