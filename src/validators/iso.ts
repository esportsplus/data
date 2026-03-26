import type { ErrorType } from '~/types';


type V = (value: unknown, errors: ErrorType) => void;

let DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/,
    DATE_TIME_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/,
    DURATION_RE = /^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/,
    TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/,
    TIMESTAMP_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
    WEEK_RE = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;


function validate(value: unknown, errors: ErrorType, re: RegExp, error: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(error);
    }
}


function isDurationValid(value: string): boolean {
    if (!DURATION_RE.test(value)) {
        return false;
    }

    // Must have at least one component after P
    return value !== 'P' && value !== 'PT';
}


const iso: { date: V; dateTime: V; duration: V; time: V; timestamp: V; week: V } = {
    date: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, DATE_RE, 'must be a valid ISO date');
    },
    dateTime: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, DATE_TIME_RE, 'must be a valid ISO date-time');
    },
    duration: (value: unknown, errors: ErrorType): void => {
        if (typeof value !== 'string' || !isDurationValid(value)) {
            errors.push('must be a valid ISO duration');
        }
    },
    time: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, TIME_RE, 'must be a valid ISO time');
    },
    timestamp: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, TIMESTAMP_RE, 'must be a valid ISO timestamp');
    },
    week: (value: unknown, errors: ErrorType): void => {
        validate(value, errors, WEEK_RE, 'must be a valid ISO week');
    },
};


export default iso;
