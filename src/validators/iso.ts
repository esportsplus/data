import type { ValidatorFunction } from '~/types';


type F = (error?: string) => ValidatorFunction<unknown>;

let DATE_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/,
    DATE_TIME_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/,
    DURATION_REGEX = /^P(?:\d+W|(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?)$/,
    TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?$/,
    TIMESTAMP_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i,
    WEEK_REGEX = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;


function check(value: unknown, errors: { push(message: string): void }, re: RegExp, msg: string): void {
    if (typeof value !== 'string' || !re.test(value)) {
        errors.push(msg);
    }
}

function daysInMonth(year: number, month: number): number {
    if (month === 2) {
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
    }

    return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isDateValid(value: string): boolean {
    if (!DATE_REGEX.test(value)) {
        return false;
    }

    let day = +value.slice(8, 10),
        month = +value.slice(5, 7),
        year = +value.slice(0, 4);

    return day <= daysInMonth(year, month);
}

function isDurationValid(value: string): boolean {
    if (!DURATION_REGEX.test(value)) {
        return false;
    }

    // Must have at least one component after P
    return value !== 'P' && value !== 'PT';
}


const iso: { date: F; dateTime: F; duration: F; time: F; timestamp: F; week: F } = {
    date: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO date';

        return (value, errors) => {
            if (typeof value !== 'string' || !isDateValid(value)) {
                errors.push(msg);
            }
        };
    },
    dateTime: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO date-time';

        return (value, errors) => check(value, errors, DATE_TIME_REGEX, msg);
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

        return (value, errors) => check(value, errors, TIME_REGEX, msg);
    },
    timestamp: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO timestamp';

        return (value, errors) => check(value, errors, TIMESTAMP_REGEX, msg);
    },
    week: (error?: string): ValidatorFunction<unknown> => {
        let msg = error || 'must be a valid ISO week';

        return (value, errors) => check(value, errors, WEEK_REGEX, msg);
    },
};


export default iso;
