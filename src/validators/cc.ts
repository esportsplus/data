import type { ErrorType } from '~/types';


let DIGITS_RE = /^[0-9]+$/,
    STRIP_RE = /[\s-]/g;


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


const cc = (value: unknown, errors: ErrorType): void => {
    if (typeof value !== 'string') {
        errors.push('must be a valid credit card number');
        return;
    }

    let stripped = value.replace(STRIP_RE, '');

    if (stripped.length < 12 || stripped.length > 19 || !DIGITS_RE.test(stripped) || !luhn(stripped)) {
        errors.push('must be a valid credit card number');
    }
};


export default cc;
