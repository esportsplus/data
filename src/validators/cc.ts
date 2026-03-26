import type { ErrorType } from '~/types';


let DIGITS_REGEX = /^[0-9]+$/,
    STRIP_REGEX = /[\s-]/g;


function luhn(digits: string): boolean {
    let n = digits.length,
        sum = 0;

    for (let i = 0; i < n; i++) {
        let digit = +digits[n - 1 - i];

        if (i % 2 === 1) {
            digit *= 2;

            if (digit > 9) {
                digit -= 9;
            }
        }

        sum += digit;
    }

    return sum % 10 === 0;
}


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be a valid credit card number';

    return (value, errors) => {
        if (typeof value !== 'string') {
            errors.push(msg);
            return;
        }

        let stripped = value.replace(STRIP_REGEX, '');

        if (stripped.length < 12 || stripped.length > 19 || !DIGITS_REGEX.test(stripped) || !luhn(stripped)) {
            errors.push(msg);
        }
    };
};
