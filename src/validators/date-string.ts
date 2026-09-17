import type { ErrorType } from '~/types';


let REGEX = /^\d{4}-\d{2}-\d{2}([T ].+)?$/;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid date string';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value) || isNaN(new Date(value).getTime())) {
            errors.push(msg);
            return;
        }

        let day = +value.slice(8, 10),
            month = +value.slice(5, 7),
            year = +value.slice(0, 4),
            roundtrip = new Date(0);

        // Date.UTC maps years 0-99 onto 1900-1999, so build the date via
        // setUTCFullYear to preserve four-digit years such as 0099.
        roundtrip.setUTCFullYear(year, month - 1, day);

        if (roundtrip.getUTCFullYear() !== year || roundtrip.getUTCMonth() !== month - 1 || roundtrip.getUTCDate() !== day) {
            errors.push(msg);
        }
    };
};
