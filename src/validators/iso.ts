import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/,
    DATE_TIME_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/,
    DURATION_RE = /^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/,
    TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/,
    TIMESTAMP_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
    WEEK_RE = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(msg);
    }
}

function isDurationValid(value: string): boolean {
    if (!DURATION_RE.test(value)) {
        return false;
    }

    // Must have at least one component after P
    return value !== 'P' && value !== 'PT';
}


const iso: { date: F; dateTime: F; duration: F; time: F; timestamp: F; week: F } = {
    date: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO date';

        return (value, errors) => check(value, errors, DATE_RE, msg);
    },
    dateTime: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO date-time';

        return (value, errors) => check(value, errors, DATE_TIME_RE, msg);
    },
    duration: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO duration';

        return (value, errors) => {
            if (typeof value !== 'string' || !isDurationValid(value)) {
                errors.push(msg);
            }
        };
    },
    time: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO time';

        return (value, errors) => check(value, errors, TIME_RE, msg);
    },
    timestamp: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO timestamp';

        return (value, errors) => check(value, errors, TIMESTAMP_RE, msg);
    },
    week: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO week';

        return (value, errors) => check(value, errors, WEEK_RE, msg);
    },
};


export default iso;
