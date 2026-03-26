import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

type VF = (d: Date, error?: string) => V;


let date: { future: V; max: VF; min: VF; past: V; valid: V } = {
    future: (value: unknown, errors: ErrorType): void => {
        if (!(value instanceof Date) || isNaN(value.getTime()) || value.getTime() <= Date.now()) {
            errors.push('must be a future date');
        }
    },

    max: (d: Date, error?: string) => {
        let msg = error || `must be on or before ${d.toISOString()}`;

        return (value: unknown, errors: ErrorType): void => {
            if (!(value instanceof Date) || isNaN(value.getTime()) || value.getTime() > d.getTime()) {
                errors.push(msg);
            }
        };
    },

    min: (d: Date, error?: string) => {
        let msg = error || `must be on or after ${d.toISOString()}`;

        return (value: unknown, errors: ErrorType): void => {
            if (!(value instanceof Date) || isNaN(value.getTime()) || value.getTime() < d.getTime()) {
                errors.push(msg);
            }
        };
    },

    past: (value: unknown, errors: ErrorType): void => {
        if (!(value instanceof Date) || isNaN(value.getTime()) || value.getTime() >= Date.now()) {
            errors.push('must be a past date');
        }
    },

    valid: (value: unknown, errors: ErrorType): void => {
        if (!(value instanceof Date) || isNaN(value.getTime())) {
            errors.push('must be a valid date');
        }
    },
};


export default date;
